import { Injectable, Logger } from '@nestjs/common';

import { outputKey, RenderMessage } from '../dispatcher/render-message';
import { JobsService } from '../jobs/jobs.service';
import { PayloadService } from '../payload/payload.service';
import { PdfRendererService } from '../render/pdf-renderer.service';
import { DocumentStoreService } from '../storage/document-store.service';
import { TemplateCacheService } from '../templates/template-cache.service';
import { OrgConfigService } from './org-config.service';
import { PermanentJobError } from './permanent-job.error';

export interface HandleResult {
  jobId: string;
  key: string;
  bytes: number;
  degraded: boolean;
}

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly payloads: PayloadService,
    private readonly templates: TemplateCacheService,
    private readonly renderer: PdfRendererService,
    private readonly store: DocumentStoreService,
    private readonly orgs: OrgConfigService,
  ) {}

  /**
   * Render and store one document.
   *
   * Throws on failure so the caller can decide whether to delete the SQS
   * message. A message is only deleted after this resolves - leaving a failed
   * message on the queue is what gets it retried and eventually
   * dead-lettered.
   */
  async handle(message: RenderMessage): Promise<HandleResult> {
    await this.jobs.markRendering(message.jobId);

    try {
      const [data, template, destination] = await Promise.all([
        this.payloads.fetch(message.mongoId),
        this.templates.get(message.templateId, message.templateVersion),
        this.orgs.destinationFor(message.orgId),
      ]);

      const html = template(data);
      const pdf = await this.renderer.render(html);
      await this.jobs.markRendered(message.jobId);

      // Derived from the job, never generated here: a redelivered message
      // overwrites the same object instead of creating a duplicate.
      const key = outputKey(message);
      const stored = await this.store.store(destination, key, pdf);

      await this.jobs.markDone(message.jobId);

      if (stored.degraded) {
        this.logger.warn(
          `Job ${message.jobId} written to the fallback bucket - org ${message.orgId} ` +
            `destination is not working`,
        );
      }

      return {
        jobId: message.jobId,
        key: stored.key,
        bytes: pdf.length,
        degraded: stored.degraded,
      };
    } catch (error) {
      const permanent = error instanceof PermanentJobError;
      const reason = (error as Error).message;

      await this.jobs.markFailed(message.jobId, reason, permanent);
      this.logger.error(
        `Job ${message.jobId} failed (${permanent ? 'permanent' : 'retryable'}): ${reason}`,
      );

      throw error;
    }
  }
}
