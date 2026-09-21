import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { ConversionJob, JobPriority, JobStatus } from '../jobs/entities/conversion-job.entity';
import { JobsService } from '../jobs/jobs.service';
import { chunk, DispatcherService } from './dispatcher.service';
import { outputKey, RenderMessage } from './render-message';

const makeJob = (id: string): ConversionJob =>
  ({
    id,
    batchId: 'batch-1',
    orgId: 'org-1',
    mongoId: '507f1f77bcf86cd799439011',
    templateId: 'invoice',
    templateVersion: 3,
    priority: JobPriority.BATCH,
    status: JobStatus.CLAIMED,
    attempts: 1,
  }) as ConversionJob;

describe('DispatcherService', () => {
  let service: DispatcherService;
  let sqs: { send: jest.Mock };
  let jobs: { claimBatch: jest.Mock; markFailed: jest.Mock };

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        'dispatcher.claimChunkSize': 1000,
        'queues.batchUrl': 'https://sqs.test/batch',
        'queues.urgentUrl': 'https://sqs.test/urgent',
      };
      return values[key];
    }),
  };

  beforeEach(async () => {
    sqs = { send: jest.fn().mockResolvedValue({ Successful: [], Failed: [] }) };
    jobs = {
      claimBatch: jest.fn().mockResolvedValue([]),
      markFailed: jest.fn().mockResolvedValue(JobStatus.READY),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatcherService,
        { provide: SQSClient, useValue: sqs },
        { provide: JobsService, useValue: jobs },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<DispatcherService>(DispatcherService);
  });

  it('does nothing when there is nothing ready', async () => {
    const result = await service.dispatch('w1');

    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(sqs.send).not.toHaveBeenCalled();
  });

  it('sends in groups of 10, the SQS limit', async () => {
    const claimed = Array.from({ length: 25 }, (_, i) => makeJob(String(i)));
    jobs.claimBatch.mockResolvedValueOnce(claimed).mockResolvedValueOnce([]);
    sqs.send.mockImplementation((cmd: SendMessageBatchCommand) =>
      Promise.resolve({ Successful: cmd.input.Entries, Failed: [] }),
    );

    const result = await service.dispatch('w1');

    // 25 jobs => 10 + 10 + 5
    expect(sqs.send).toHaveBeenCalledTimes(3);
    expect(sqs.send.mock.calls[0][0].input.Entries).toHaveLength(10);
    expect(sqs.send.mock.calls[2][0].input.Entries).toHaveLength(5);
    expect(result.sent).toBe(25);
  });

  it('keeps claiming until a claim comes back empty', async () => {
    jobs.claimBatch
      .mockResolvedValueOnce([makeJob('1')])
      .mockResolvedValueOnce([makeJob('2')])
      .mockResolvedValueOnce([]);
    sqs.send.mockImplementation((cmd: SendMessageBatchCommand) =>
      Promise.resolve({ Successful: cmd.input.Entries, Failed: [] }),
    );

    const result = await service.dispatch('w1');

    expect(jobs.claimBatch).toHaveBeenCalledTimes(3);
    expect(result.claimed).toBe(2);
  });

  it('finishes sending a chunk before claiming the next one', async () => {
    const order: string[] = [];
    jobs.claimBatch.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve(order.filter((o) => o === 'claim').length === 1 ? [makeJob('1')] : []);
    });
    sqs.send.mockImplementation((cmd: SendMessageBatchCommand) => {
      order.push('send');
      return Promise.resolve({ Successful: cmd.input.Entries, Failed: [] });
    });

    await service.dispatch('w1');

    // Backpressure: claim, send, claim - never claim, claim, send.
    expect(order).toEqual(['claim', 'send', 'claim']);
  });

  it('carries only ids in the message, never the document payload', async () => {
    jobs.claimBatch.mockResolvedValueOnce([makeJob('42')]).mockResolvedValueOnce([]);
    sqs.send.mockImplementation((cmd: SendMessageBatchCommand) =>
      Promise.resolve({ Successful: cmd.input.Entries, Failed: [] }),
    );

    await service.dispatch('w1');

    const body = JSON.parse(sqs.send.mock.calls[0][0].input.Entries[0].MessageBody) as RenderMessage;
    expect(body).toEqual({
      jobId: '42',
      batchId: 'batch-1',
      orgId: 'org-1',
      mongoId: '507f1f77bcf86cd799439011',
      templateId: 'invoice',
      templateVersion: 3,
      priority: JobPriority.BATCH,
    });
  });

  it('routes urgent jobs to the urgent queue', async () => {
    jobs.claimBatch.mockResolvedValueOnce([makeJob('1')]).mockResolvedValueOnce([]);
    sqs.send.mockImplementation((cmd: SendMessageBatchCommand) =>
      Promise.resolve({ Successful: cmd.input.Entries, Failed: [] }),
    );

    await service.dispatch('w1', JobPriority.URGENT);

    expect(sqs.send.mock.calls[0][0].input.QueueUrl).toBe('https://sqs.test/urgent');
  });

  it('releases the jobs SQS rejected, keeping the ones it accepted', async () => {
    jobs.claimBatch
      .mockResolvedValueOnce([makeJob('1'), makeJob('2'), makeJob('3')])
      .mockResolvedValueOnce([]);
    sqs.send.mockResolvedValue({
      Successful: [{ Id: '1' }, { Id: '3' }],
      Failed: [{ Id: '2', Message: 'throttled' }],
    });

    const result = await service.dispatch('w1');

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(jobs.markFailed).toHaveBeenCalledWith('2', expect.stringContaining('throttled'), false);
  });

  it('releases the whole group when the queue is unreachable, and keeps going', async () => {
    jobs.claimBatch
      .mockResolvedValueOnce([makeJob('1'), makeJob('2')])
      .mockResolvedValueOnce([]);
    sqs.send.mockRejectedValue(new Error('connection reset'));

    const result = await service.dispatch('w1');

    expect(result.failed).toBe(2);
    expect(jobs.markFailed).toHaveBeenCalledTimes(2);
    // Not permanent - the queue being down says nothing about the job.
    expect(jobs.markFailed).toHaveBeenCalledWith('1', expect.any(String), false);
  });

  it('refuses to dispatch when no queue is configured for the priority', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'dispatcher.claimChunkSize' ? 1000 : '',
    );
    jobs.claimBatch.mockResolvedValueOnce([makeJob('1')]);

    await expect(service.dispatch('w1')).rejects.toThrow('No queue URL configured');
  });
});

describe('outputKey', () => {
  const message: RenderMessage = {
    jobId: '42',
    batchId: 'batch-1',
    orgId: 'org-1',
    mongoId: '507f1f77bcf86cd799439011',
    templateId: 'invoice',
    templateVersion: 3,
    priority: JobPriority.BATCH,
  };

  it('is stable across calls, so a redelivered message overwrites its own object', () => {
    expect(outputKey(message)).toBe(outputKey(message));
    expect(outputKey(message)).toBe('org-1/batch-1/42-v3.pdf');
  });

  it('changes when the template version changes', () => {
    expect(outputKey({ ...message, templateVersion: 4 })).not.toBe(outputKey(message));
  });

  it('namespaces by org so one org cannot reach another org keys', () => {
    expect(outputKey({ ...message, orgId: 'org-2' })).toMatch(/^org-2\//);
  });
});

describe('chunk', () => {
  it('splits evenly and keeps the remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunk([], 10)).toEqual([]);
  });
});
