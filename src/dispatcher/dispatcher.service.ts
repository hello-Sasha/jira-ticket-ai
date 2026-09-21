import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConversionJob, JobPriority, JobStatus } from '../jobs/entities/conversion-job.entity';
import { JobsService } from '../jobs/jobs.service';
import { RenderMessage } from './render-message';

/** SQS hard limit. */
const SQS_BATCH_SIZE = 10;

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
}

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);

  constructor(
    private readonly sqs: SQSClient,
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Claim and fan out until nothing is left.
   *
   * Memory is bounded by the chunk size, not by the batch size: one chunk of
   * job rows is held at a time, whether the batch holds ten thousand documents
   * or ten million. Each chunk is fully sent before the next is claimed - that
   * await is the backpressure, and removing it silently reintroduces the
   * unbounded-memory problem this design exists to avoid.
   */
  async dispatch(
    workerId: string,
    priority: JobPriority = JobPriority.BATCH,
  ): Promise<DispatchResult> {
    const chunkSize = this.config.get<number>('dispatcher.claimChunkSize') ?? 1000;
    const total: DispatchResult = { claimed: 0, sent: 0, failed: 0 };

    for (;;) {
      const claimed = await this.jobs.claimBatch(workerId, chunkSize, priority);
      if (claimed.length === 0) {
        break;
      }

      total.claimed += claimed.length;
      const { sent, failed } = await this.sendChunk(claimed, priority);
      total.sent += sent;
      total.failed += failed;
    }

    if (total.claimed > 0) {
      this.logger.log(
        `Dispatched ${total.sent}/${total.claimed} ${priority} jobs (${total.failed} failed to enqueue)`,
      );
    }

    return total;
  }

  private async sendChunk(
    jobs: ConversionJob[],
    priority: JobPriority,
  ): Promise<{ sent: number; failed: number }> {
    const queueUrl = this.queueUrlFor(priority);
    let sent = 0;
    let failed = 0;

    for (const group of chunk(jobs, SQS_BATCH_SIZE)) {
      try {
        const response = await this.sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: group.map((job) => ({
              Id: job.id,
              MessageBody: JSON.stringify(toMessage(job)),
            })),
          }),
        );

        sent += response.Successful?.length ?? 0;

        // A partial batch failure is normal and must not lose the rest.
        // Release the ones that did not make it so the reaper does not have
        // to wait out their lease.
        for (const entry of response.Failed ?? []) {
          failed += 1;
          await this.releaseFailedSend(entry.Id, entry.Message ?? 'SQS rejected the message');
        }
      } catch (error) {
        // Whole-batch failure: the queue is unreachable or throttled. Release
        // every job in the group rather than leaving them claimed.
        failed += group.length;
        const reason = (error as Error).message;
        this.logger.error(`SendMessageBatch failed for ${group.length} jobs: ${reason}`);
        for (const job of group) {
          await this.releaseFailedSend(job.id, reason);
        }
      }
    }

    return { sent, failed };
  }

  private async releaseFailedSend(jobId: string | undefined, reason: string): Promise<void> {
    if (!jobId) {
      return;
    }
    // Not permanent: the queue being unavailable says nothing about the job.
    const status = await this.jobs.markFailed(jobId, `enqueue failed: ${reason}`, false);
    if (status === JobStatus.FAILED) {
      this.logger.warn(`Job ${jobId} exhausted its attempts while being enqueued`);
    }
  }

  private queueUrlFor(priority: JobPriority): string {
    const key = priority === JobPriority.URGENT ? 'queues.urgentUrl' : 'queues.batchUrl';
    const url = this.config.get<string>(key);
    if (!url) {
      throw new Error(`No queue URL configured for priority ${priority}`);
    }
    return url;
  }
}

function toMessage(job: ConversionJob): RenderMessage {
  return {
    jobId: job.id,
    batchId: job.batchId,
    orgId: job.orgId,
    mongoId: job.mongoId,
    templateId: job.templateId,
    templateVersion: job.templateVersion,
    priority: job.priority,
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
