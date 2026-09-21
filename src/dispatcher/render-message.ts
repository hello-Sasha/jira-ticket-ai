import { JobPriority } from '../jobs/entities/conversion-job.entity';

/**
 * What travels on the queue. The ids, never the payload - the worker fetches
 * the document itself. Keeping this small is what bounds dispatcher memory.
 */
export interface RenderMessage {
  jobId: string;
  batchId: string;
  orgId: string;
  mongoId: string;
  templateId: string;
  templateVersion: number;
  priority: JobPriority;
}

/**
 * Deterministic, derived entirely from the job. A redelivered message or a
 * replayed record overwrites the same object rather than creating a second
 * one, which is what makes the whole pipeline idempotent without
 * exactly-once delivery.
 */
export function outputKey(message: RenderMessage): string {
  return `${message.orgId}/${message.batchId}/${message.jobId}-v${message.templateVersion}.pdf`;
}
