import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ConversionJob, JobPriority, JobStatus } from './entities/conversion-job.entity';
import { JobsService } from './jobs.service';

interface FakeQueryBuilder {
  update: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  limit: jest.Mock;
  execute: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  groupBy: jest.Mock;
  getRawMany: jest.Mock;
}

const makeQb = (): FakeQueryBuilder => {
  const qb: Partial<FakeQueryBuilder> = {};
  qb.update = jest.fn().mockReturnValue(qb);
  qb.set = jest.fn().mockReturnValue(qb);
  qb.where = jest.fn().mockReturnValue(qb);
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.limit = jest.fn().mockReturnValue(qb);
  qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
  qb.select = jest.fn().mockReturnValue(qb);
  qb.addSelect = jest.fn().mockReturnValue(qb);
  qb.groupBy = jest.fn().mockReturnValue(qb);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  return qb as FakeQueryBuilder;
};

const config = {
  get: jest.fn((key: string) => {
    const values: Record<string, number> = {
      'dispatcher.leaseMinutes': 15,
      'dispatcher.maxAttempts': 3,
    };
    return values[key];
  }),
};

describe('JobsService', () => {
  let service: JobsService;
  let repo: {
    createQueryBuilder: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let qb: FakeQueryBuilder;

  beforeEach(async () => {
    qb = makeQb();
    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: getRepositoryToken(ConversionJob), useValue: repo },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
  });

  describe('claimBatch', () => {
    it('updates before selecting, so two dispatchers cannot claim the same rows', async () => {
      qb.execute.mockResolvedValue({ affected: 3 });
      repo.find.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);

      const claimed = await service.claimBatch('worker-a', 1000);

      expect(qb.update).toHaveBeenCalled();
      expect(qb.execute).toHaveBeenCalled();
      expect(repo.find).toHaveBeenCalled();
      // The UPDATE must have run before the read-back.
      expect(qb.execute.mock.invocationCallOrder[0]).toBeLessThan(
        repo.find.mock.invocationCallOrder[0],
      );
      expect(claimed).toHaveLength(3);
    });

    it('claims only READY rows of the requested priority', async () => {
      qb.execute.mockResolvedValue({ affected: 1 });

      await service.claimBatch('worker-a', 500, JobPriority.URGENT);

      expect(qb.where).toHaveBeenCalledWith('status = :status', { status: JobStatus.READY });
      expect(qb.andWhere).toHaveBeenCalledWith('priority = :priority', {
        priority: JobPriority.URGENT,
      });
      expect(qb.limit).toHaveBeenCalledWith(500);
    });

    it('increments attempts as part of the claim', async () => {
      qb.execute.mockResolvedValue({ affected: 1 });

      await service.claimBatch('worker-a', 10);

      const setArg = qb.set.mock.calls[0][0];
      expect(typeof setArg.attempts).toBe('function');
      expect(setArg.attempts()).toBe('attempts + 1');
      expect(setArg.status).toBe(JobStatus.CLAIMED);
      expect(setArg.workerId).toBe('worker-a');
    });

    it('skips the read-back entirely when nothing was claimed', async () => {
      qb.execute.mockResolvedValue({ affected: 0 });

      const claimed = await service.claimBatch('worker-a', 1000);

      expect(claimed).toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('reapExpired', () => {
    it('fails jobs past the attempt cap and requeues the rest', async () => {
      qb.execute
        .mockResolvedValueOnce({ affected: 2 }) // exhausted
        .mockResolvedValueOnce({ affected: 7 }); // requeued

      const result = await service.reapExpired();

      expect(result).toEqual({ exhausted: 2, requeued: 7 });
    });

    it('only touches rows whose lease has actually expired', async () => {
      await service.reapExpired();

      expect(qb.andWhere).toHaveBeenCalledWith('leaseExpiresAt < NOW()');
    });

    it('reaps both CLAIMED and RENDERING, since either can hold a dead worker', async () => {
      await service.reapExpired();

      expect(qb.where).toHaveBeenCalledWith('status IN (:...stuck)', {
        stuck: [JobStatus.CLAIMED, JobStatus.RENDERING],
      });
    });
  });

  describe('markFailed', () => {
    it('fails permanently when the error is permanent, even on the first attempt', async () => {
      repo.findOne.mockResolvedValue({ id: '1', attempts: 1, workerId: 'w' });

      const status = await service.markFailed('1', 'template missing field', true);

      expect(status).toBe(JobStatus.FAILED);
      expect(repo.update).toHaveBeenCalledWith(
        { id: '1' },
        expect.objectContaining({ status: JobStatus.FAILED }),
      );
    });

    it('returns a retryable failure to READY while attempts remain', async () => {
      repo.findOne.mockResolvedValue({ id: '1', attempts: 1, workerId: 'w' });

      const status = await service.markFailed('1', 'S3 throttled', false);

      expect(status).toBe(JobStatus.READY);
    });

    it('gives up on a retryable failure once attempts are exhausted', async () => {
      repo.findOne.mockResolvedValue({ id: '1', attempts: 3, workerId: 'w' });

      const status = await service.markFailed('1', 'S3 throttled', false);

      expect(status).toBe(JobStatus.FAILED);
    });

    it('truncates a huge error rather than blowing up the column', async () => {
      repo.findOne.mockResolvedValue({ id: '1', attempts: 0, workerId: 'w' });

      await service.markFailed('1', 'x'.repeat(5000), true);

      const payload = repo.update.mock.calls[0][1];
      expect(payload.lastError).toHaveLength(2000);
    });

    it('does not throw when the job no longer exists', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.markFailed('gone', 'err', false)).resolves.toBe(JobStatus.FAILED);
    });
  });

  describe('batchProgress', () => {
    it('reports complete only when nothing is outstanding', async () => {
      qb.getRawMany.mockResolvedValue([
        { status: JobStatus.DONE, count: '98' },
        { status: JobStatus.FAILED, count: '2' },
      ]);

      const progress = await service.batchProgress('batch-1');

      expect(progress).toEqual({
        total: 100,
        done: 98,
        failed: 2,
        outstanding: 0,
        complete: true,
      });
    });

    it('is incomplete while jobs are still in flight', async () => {
      qb.getRawMany.mockResolvedValue([
        { status: JobStatus.DONE, count: '40' },
        { status: JobStatus.RENDERING, count: '10' },
      ]);

      const progress = await service.batchProgress('batch-1');

      expect(progress.outstanding).toBe(10);
      expect(progress.complete).toBe(false);
    });

    it('an unknown batch is not reported as complete', async () => {
      qb.getRawMany.mockResolvedValue([]);

      const progress = await service.batchProgress('nope');

      expect(progress.total).toBe(0);
      expect(progress.complete).toBe(false);
    });
  });
});
