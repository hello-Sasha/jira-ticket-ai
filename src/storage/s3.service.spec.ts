import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { S3Service } from './s3.service';

jest.mock('@aws-sdk/s3-request-presigner');

const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;

describe('S3Service', () => {
  let service: S3Service;
  let s3: { send: jest.Mock };

  const build = async (bucket: string): Promise<S3Service> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        { provide: S3Client, useValue: s3 },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(bucket) } },
      ],
    }).compile();
    return module.get<S3Service>(S3Service);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue('https://s3.example/signed');
    s3 = { send: jest.fn().mockResolvedValue({}) };
    service = await build('documents-bucket');
  });

  describe('createUploadUrl', () => {
    it('returns a signed url with the key and a default 15 minute expiry', async () => {
      const result = await service.createUploadUrl('receipts/m1/o1.pdf', 'application/pdf');

      expect(result).toEqual({
        url: 'https://s3.example/signed',
        key: 'receipts/m1/o1.pdf',
        expiresInSeconds: 900,
      });
    });

    it('honours an explicit expiry', async () => {
      await service.createUploadUrl('k', 'application/pdf', 60);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        expiresIn: 60,
      });
    });

    it('fails loudly when the bucket is not configured', async () => {
      const unconfigured = await build('');

      await expect(unconfigured.createUploadUrl('k', 'application/pdf')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('putObject', () => {
    it('sends a PutObjectCommand to the configured bucket', async () => {
      await service.putObject('k', Buffer.from('hello'), 'text/plain');

      expect(s3.send).toHaveBeenCalledTimes(1);
      expect(s3.send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    });

    it('propagates an S3 failure rather than swallowing it', async () => {
      s3.send.mockRejectedValue(new Error('AccessDenied'));

      await expect(service.putObject('k', 'body', 'text/plain')).rejects.toThrow('AccessDenied');
    });
  });

  describe('deleteObject', () => {
    it('sends a DeleteObjectCommand', async () => {
      await service.deleteObject('k');

      expect(s3.send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
    });
  });
});
