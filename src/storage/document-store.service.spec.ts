import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { STSClient } from '@aws-sdk/client-sts';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { DocumentStoreService } from './document-store.service';
import { OrgDestination } from './org-destination';

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    // Assumed-role clients are constructed inside the service; this captures them.
    S3Client: jest.fn().mockImplementation(() => ({ send: assumedSend })),
  };
});

const assumedSend = jest.fn();

const defaultOrg: OrgDestination = { orgId: 'org-1' };

const customOrg: OrgDestination = {
  orgId: 'org-2',
  customBucket: {
    bucket: 'their-bucket',
    roleArn: 'arn:aws:iam::999:role/PdfWriter',
    externalId: 'ext-123',
    region: 'us-east-1',
  },
};

const credentials = (expiresInMs: number) => ({
  Credentials: {
    AccessKeyId: 'AK',
    SecretAccessKey: 'SK',
    SessionToken: 'ST',
    Expiration: new Date(Date.now() + expiresInMs),
  },
});

describe('DocumentStoreService', () => {
  let service: DocumentStoreService;
  let defaultS3: { send: jest.Mock };
  let sts: { send: jest.Mock };

  const pdf = Buffer.from('%PDF');

  beforeEach(async () => {
    jest.clearAllMocks();
    assumedSend.mockResolvedValue({});
    defaultS3 = { send: jest.fn().mockResolvedValue({}) };
    sts = { send: jest.fn().mockResolvedValue(credentials(3600_000)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentStoreService,
        { provide: S3Client, useValue: defaultS3 },
        { provide: STSClient, useValue: sts },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('our-bucket') },
        },
      ],
    }).compile();

    service = module.get<DocumentStoreService>(DocumentStoreService);
  });

  describe('default bucket', () => {
    it('writes to our bucket and does not assume any role', async () => {
      const result = await service.store(defaultOrg, 'org-1/b/1-v1.pdf', pdf);

      expect(result).toEqual({ bucket: 'our-bucket', key: 'org-1/b/1-v1.pdf', degraded: false });
      expect(sts.send).not.toHaveBeenCalled();
      const command = defaultS3.send.mock.calls[0][0] as PutObjectCommand;
      expect(command.input.ContentType).toBe('application/pdf');
    });

    it('fails loudly when no default bucket is configured', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DocumentStoreService,
          { provide: S3Client, useValue: defaultS3 },
          { provide: STSClient, useValue: sts },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        ],
      }).compile();

      await expect(
        module.get<DocumentStoreService>(DocumentStoreService).store(defaultOrg, 'k', pdf),
      ).rejects.toThrow('DEFAULT_BUCKET');
    });
  });

  describe('customer bucket', () => {
    it('assumes the role and writes to their bucket', async () => {
      const result = await service.store(customOrg, 'org-2/b/1-v1.pdf', pdf);

      expect(sts.send).toHaveBeenCalledTimes(1);
      expect(assumedSend).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        bucket: 'their-bucket',
        key: 'org-2/b/1-v1.pdf',
        degraded: false,
      });
      expect(defaultS3.send).not.toHaveBeenCalled();
    });

    it('caches credentials, so a second document does not assume again', async () => {
      await service.store(customOrg, 'k1', pdf);
      await service.store(customOrg, 'k2', pdf);
      await service.store(customOrg, 'k3', pdf);

      expect(sts.send).toHaveBeenCalledTimes(1);
      expect(assumedSend).toHaveBeenCalledTimes(3);
    });

    it('re-assumes when the cached credentials are near expiry', async () => {
      sts.send.mockResolvedValue(credentials(60_000)); // inside the skew window

      await service.store(customOrg, 'k1', pdf);
      await service.store(customOrg, 'k2', pdf);

      expect(sts.send).toHaveBeenCalledTimes(2);
    });

    it('rejects an AssumeRole that returns no credentials', async () => {
      sts.send.mockResolvedValue({});

      // Falls back rather than throwing - the document still gets written.
      const result = await service.store(customOrg, 'k', pdf);

      expect(result.degraded).toBe(true);
      expect(result.bucket).toBe('our-bucket');
    });
  });

  describe('fallback', () => {
    it('writes to our bucket and flags degraded when their bucket rejects it', async () => {
      assumedSend.mockRejectedValue(new Error('AccessDenied'));

      const result = await service.store(customOrg, 'org-2/b/1-v1.pdf', pdf);

      expect(result).toEqual({
        bucket: 'our-bucket',
        key: 'org-2/b/1-v1.pdf',
        degraded: true,
      });
      expect(defaultS3.send).toHaveBeenCalledTimes(1);
    });

    it('drops the cached client after a failure, so a stale credential is not reused', async () => {
      assumedSend.mockRejectedValueOnce(new Error('ExpiredToken'));
      await service.store(customOrg, 'k1', pdf);

      assumedSend.mockResolvedValue({});
      await service.store(customOrg, 'k2', pdf);

      expect(sts.send).toHaveBeenCalledTimes(2);
    });

    it('propagates a failure when even our own bucket rejects the write', async () => {
      assumedSend.mockRejectedValue(new Error('AccessDenied'));
      defaultS3.send.mockRejectedValue(new Error('ServiceUnavailable'));

      await expect(service.store(customOrg, 'k', pdf)).rejects.toThrow('ServiceUnavailable');
    });
  });

  describe('validateDestination', () => {
    it('does nothing for an org on the default bucket', async () => {
      await service.validateDestination(defaultOrg);

      expect(sts.send).not.toHaveBeenCalled();
    });

    it('writes a probe object to prove the role works', async () => {
      await service.validateDestination(customOrg);

      expect(assumedSend).toHaveBeenCalledTimes(1);
      const command = assumedSend.mock.calls[0][0] as PutObjectCommand;
      expect(command.input.Key).toContain('.pdf-converter-access-check/');
    });

    it('surfaces a broken role at configuration time instead of falling back', async () => {
      assumedSend.mockRejectedValue(new Error('AccessDenied'));

      await expect(service.validateDestination(customOrg)).rejects.toThrow('AccessDenied');
    });
  });
});
