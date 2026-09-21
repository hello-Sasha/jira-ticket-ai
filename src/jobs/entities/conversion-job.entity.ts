import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum JobStatus {
  /** Waiting to be claimed by a dispatcher. */
  READY = 'ready',
  /** Claimed and sent to the queue; a worker has not started it yet. */
  CLAIMED = 'claimed',
  /** A worker is actively rendering it. */
  RENDERING = 'rendering',
  /** PDF rendered and stored. */
  DONE = 'done',
  /** Permanently failed - will not be retried. */
  FAILED = 'failed',
}

export enum JobPriority {
  /** Scheduled bulk work. Deep queue, cheapest compute. */
  BATCH = 'batch',
  /** Someone is waiting. Routed to a separate queue. */
  URGENT = 'urgent',
}

@Entity('conversion_jobs')
// The dispatcher's claim query. Leading column is status because that is the
// equality predicate; id orders the claim so it is stable across runs.
@Index('idx_claim', ['status', 'priority', 'id'])
// Batch completion counting.
@Index('idx_batch', ['batchId', 'status'])
// The reaper's scan for expired leases.
@Index('idx_reap', ['status', 'leaseExpiresAt'])
export class ConversionJob {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'char', length: 36 })
  batchId: string;

  @Column({ type: 'varchar', length: 64 })
  orgId: string;

  /** ObjectId of the source document in Mongo. */
  @Column({ type: 'char', length: 24 })
  mongoId: string;

  @Column({ type: 'varchar', length: 64 })
  templateId: string;

  /** Part of the output key, so a template change produces a new object. */
  @Column({ type: 'int' })
  templateVersion: number;

  @Column({ type: 'enum', enum: JobStatus, default: JobStatus.READY })
  status: JobStatus;

  @Column({ type: 'enum', enum: JobPriority, default: JobPriority.BATCH })
  priority: JobPriority;

  @Column({ type: 'tinyint', default: 0 })
  attempts: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  workerId: string | null;

  /**
   * When this claim goes stale. A row still CLAIMED or RENDERING past this
   * point had its worker die, and the reaper returns it to READY.
   */
  @Column({ type: 'datetime', nullable: true })
  leaseExpiresAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  pickedUpAt: Date | null;

  /** PDF bytes produced. Separate from savedAt so a render failure and a
   * storage failure are distinguishable. */
  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  /** Written to S3. */
  @Column({ type: 'datetime', nullable: true })
  savedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
