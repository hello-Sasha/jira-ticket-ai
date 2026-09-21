import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConversionJob, JobPriority, JobStatus } from './entities/conversion-job.entity';

export interface BatchProgress {
  total: number;
  done: number;
  failed: number;
  outstanding: number;
  complete: boolean;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(ConversionJob)
    private readonly jobs: Repository<ConversionJob>,
    private readonly config: ConfigService,
  ) {}

  private get leaseMinutes(): number {
    return this.config.get<number>('dispatcher.leaseMinutes') ?? 15;
  }

  private get maxAttempts(): number {
    return this.config.get<number>('dispatcher.maxAttempts') ?? 3;
  }

  /**
   * Atomically claim up to `limit` ready jobs for this worker.
   *
   * The UPDATE comes first and the SELECT reads back what it claimed. Doing it
   * the other way round - SELECT ready rows, then UPDATE them - lets two
   * concurrent dispatchers claim the same rows, because nothing stops the
   * second SELECT seeing rows the first has not marked yet.
   */
  async claimBatch(
    workerId: string,
    limit: number,
    priority: JobPriority = JobPriority.BATCH,
  ): Promise<ConversionJob[]> {
    const leaseExpiresAt = new Date(Date.now() + this.leaseMinutes * 60_000);

    const result = await this.jobs
      .createQueryBuilder()
      .update(ConversionJob)
      .set({
        status: JobStatus.CLAIMED,
        workerId,
        pickedUpAt: () => 'NOW()',
        leaseExpiresAt,
        attempts: () => 'attempts + 1',
      })
      .where('status = :status', { status: JobStatus.READY })
      .andWhere('priority = :priority', { priority })
      .limit(limit)
      .execute();

    if (!result.affected) {
      return [];
    }

    return this.jobs.find({
      where: { workerId, status: JobStatus.CLAIMED },
      order: { id: 'ASC' },
      take: limit,
    });
  }

  /**
   * Return expired claims to READY so another worker picks them up.
   *
   * A row whose worker died sits in CLAIMED or RENDERING forever otherwise -
   * timestamps alone cannot distinguish "still working" from "crashed".
   * Jobs past maxAttempts are failed rather than recycled, so one poison
   * record cannot occupy a worker indefinitely.
   */
  async reapExpired(): Promise<{ requeued: number; exhausted: number }> {
    const stuck: JobStatus[] = [JobStatus.CLAIMED, JobStatus.RENDERING];

    const exhausted = await this.jobs
      .createQueryBuilder()
      .update(ConversionJob)
      .set({
        status: JobStatus.FAILED,
        lastError: 'Lease expired and attempt limit reached',
        workerId: null,
        leaseExpiresAt: null,
      })
      .where('status IN (:...stuck)', { stuck })
      .andWhere('leaseExpiresAt < NOW()')
      .andWhere('attempts >= :max', { max: this.maxAttempts })
      .execute();

    const requeued = await this.jobs
      .createQueryBuilder()
      .update(ConversionJob)
      .set({
        status: JobStatus.READY,
        workerId: null,
        leaseExpiresAt: null,
      })
      .where('status IN (:...stuck)', { stuck })
      .andWhere('leaseExpiresAt < NOW()')
      .andWhere('attempts < :max', { max: this.maxAttempts })
      .execute();

    if (requeued.affected || exhausted.affected) {
      this.logger.warn(
        `Reaped expired leases: ${requeued.affected ?? 0} requeued, ${exhausted.affected ?? 0} exhausted`,
      );
    }

    return { requeued: requeued.affected ?? 0, exhausted: exhausted.affected ?? 0 };
  }

  async markRendering(id: string): Promise<void> {
    await this.jobs.update({ id }, { status: JobStatus.RENDERING });
  }

  async markRendered(id: string): Promise<void> {
    await this.jobs.update({ id }, { finishedAt: new Date() });
  }

  async markDone(id: string): Promise<void> {
    await this.jobs.update(
      { id },
      {
        status: JobStatus.DONE,
        savedAt: new Date(),
        lastError: null,
        leaseExpiresAt: null,
      },
    );
  }

  /**
   * A permanent failure stops here. A retryable one goes back to READY unless
   * it has exhausted its attempts - the worker decides which by throwing a
   * PermanentJobError or not.
   */
  async markFailed(id: string, error: string, permanent: boolean): Promise<JobStatus> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) {
      this.logger.warn(`markFailed called for unknown job ${id}`);
      return JobStatus.FAILED;
    }

    const giveUp = permanent || job.attempts >= this.maxAttempts;
    const status = giveUp ? JobStatus.FAILED : JobStatus.READY;

    await this.jobs.update(
      { id },
      {
        status,
        lastError: error.slice(0, 2000),
        workerId: giveUp ? job.workerId : null,
        leaseExpiresAt: null,
      },
    );

    return status;
  }

  /**
   * Batch completion comes from the jobs table itself - no separate counter
   * store to drift out of sync with reality.
   */
  async batchProgress(batchId: string): Promise<BatchProgress> {
    const rows = await this.jobs
      .createQueryBuilder('j')
      .select('j.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('j.batchId = :batchId', { batchId })
      .groupBy('j.status')
      .getRawMany<{ status: JobStatus; count: string }>();

    const counts = new Map(rows.map((r) => [r.status, parseInt(r.count, 10)]));
    const done = counts.get(JobStatus.DONE) ?? 0;
    const failed = counts.get(JobStatus.FAILED) ?? 0;
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const outstanding = total - done - failed;

    return {
      total,
      done,
      failed,
      outstanding,
      complete: total > 0 && outstanding === 0,
    };
  }
}
