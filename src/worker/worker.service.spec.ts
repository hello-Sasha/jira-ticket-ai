import { Test, TestingModule } from '@nestjs/testing';

import { RenderMessage } from '../dispatcher/render-message';
import { JobPriority } from '../jobs/entities/conversion-job.entity';
import { JobsService } from '../jobs/jobs.service';
import { PayloadService } from '../payload/payload.service';
import { PdfRendererService } from '../render/pdf-renderer.service';
import { DocumentStoreService } from '../storage/document-store.service';
import { TemplateCacheService } from '../templates/template-cache.service';
import { OrgConfigService } from './org-config.service';
import { PermanentJobError } from './permanent-job.error';
import { WorkerService } from './worker.service';

const message: RenderMessage = {
  jobId: '42',
  batchId: 'batch-1',
  orgId: 'org-1',
  mongoId: '507f1f77bcf86cd799439011',
  templateId: 'invoice',
  templateVersion: 3,
  priority: JobPriority.BATCH,
};

describe('WorkerService', () => {
  let service: WorkerService;
  let jobs: {
    markRendering: jest.Mock;
    markRendered: jest.Mock;
    markDone: jest.Mock;
    markFailed: jest.Mock;
  };
  let payloads: { fetch: jest.Mock };
  let templates: { get: jest.Mock };
  let renderer: { render: jest.Mock };
  let store: { store: jest.Mock };
  let orgs: { destinationFor: jest.Mock };

  beforeEach(async () => {
    jobs = {
      markRendering: jest.fn().mockResolvedValue(undefined),
      markRendered: jest.fn().mockResolvedValue(undefined),
      markDone: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    payloads = { fetch: jest.fn().mockResolvedValue({ name: 'Acme' }) };
    templates = { get: jest.fn().mockResolvedValue(() => '<p>Acme</p>') };
    renderer = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
    store = {
      store: jest
        .fn()
        .mockResolvedValue({ bucket: 'our-bucket', key: 'k', degraded: false }),
    };
    orgs = { destinationFor: jest.fn().mockResolvedValue({ orgId: 'org-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerService,
        { provide: JobsService, useValue: jobs },
        { provide: PayloadService, useValue: payloads },
        { provide: TemplateCacheService, useValue: templates },
        { provide: PdfRendererService, useValue: renderer },
        { provide: DocumentStoreService, useValue: store },
        { provide: OrgConfigService, useValue: orgs },
      ],
    }).compile();

    service = module.get<WorkerService>(WorkerService);
  });

  describe('happy path', () => {
    it('renders, stores, and marks the job done', async () => {
      const result = await service.handle(message);

      expect(jobs.markRendering).toHaveBeenCalledWith('42');
      expect(jobs.markRendered).toHaveBeenCalledWith('42');
      expect(jobs.markDone).toHaveBeenCalledWith('42');
      expect(result.bytes).toBe(8);
      expect(result.degraded).toBe(false);
    });

    it('uses the deterministic key, not a generated one', async () => {
      await service.handle(message);

      expect(store.store).toHaveBeenCalledWith(
        expect.anything(),
        'org-1/batch-1/42-v3.pdf',
        expect.any(Buffer),
      );
    });

    it('produces the same key on a redelivery, so the object is overwritten', async () => {
      await service.handle(message);
      await service.handle(message);

      expect(store.store.mock.calls[0][1]).toBe(store.store.mock.calls[1][1]);
    });

    it('renders the template with the fetched data', async () => {
      const template = jest.fn().mockReturnValue('<p>rendered</p>');
      templates.get.mockResolvedValue(template);

      await service.handle(message);

      expect(template).toHaveBeenCalledWith({ name: 'Acme' });
      expect(renderer.render).toHaveBeenCalledWith('<p>rendered</p>');
    });

    it('requests the exact template version the job names', async () => {
      await service.handle(message);

      expect(templates.get).toHaveBeenCalledWith('invoice', 3);
    });

    it('reports a degraded write without failing the job', async () => {
      store.store.mockResolvedValue({ bucket: 'our-bucket', key: 'k', degraded: true });

      const result = await service.handle(message);

      expect(result.degraded).toBe(true);
      expect(jobs.markDone).toHaveBeenCalledWith('42');
    });
  });

  describe('failures', () => {
    it('marks a missing document as permanent, so it is not retried', async () => {
      payloads.fetch.mockRejectedValue(new PermanentJobError('Document not found'));

      await expect(service.handle(message)).rejects.toThrow('Document not found');
      expect(jobs.markFailed).toHaveBeenCalledWith('42', 'Document not found', true);
    });

    it('marks a render timeout as retryable', async () => {
      renderer.render.mockRejectedValue(new Error('navigation timeout'));

      await expect(service.handle(message)).rejects.toThrow('navigation timeout');
      expect(jobs.markFailed).toHaveBeenCalledWith('42', 'navigation timeout', false);
    });

    it('marks an S3 failure as retryable', async () => {
      store.store.mockRejectedValue(new Error('ServiceUnavailable'));

      await expect(service.handle(message)).rejects.toThrow('ServiceUnavailable');
      expect(jobs.markFailed).toHaveBeenCalledWith('42', 'ServiceUnavailable', false);
    });

    it('rethrows so the caller leaves the message on the queue', async () => {
      renderer.render.mockRejectedValue(new Error('boom'));

      await expect(service.handle(message)).rejects.toThrow('boom');
      expect(jobs.markDone).not.toHaveBeenCalled();
    });

    it('does not mark a job done when storage failed after a successful render', async () => {
      store.store.mockRejectedValue(new Error('AccessDenied'));

      await expect(service.handle(message)).rejects.toThrow();
      // Rendered, but never saved - the two timestamps tell them apart.
      expect(jobs.markRendered).toHaveBeenCalledWith('42');
      expect(jobs.markDone).not.toHaveBeenCalled();
    });

    it('does not store anything when the template is missing', async () => {
      templates.get.mockRejectedValue(new PermanentJobError('Template invoice@3 is empty'));

      await expect(service.handle(message)).rejects.toThrow();
      expect(renderer.render).not.toHaveBeenCalled();
      expect(store.store).not.toHaveBeenCalled();
    });
  });
});
