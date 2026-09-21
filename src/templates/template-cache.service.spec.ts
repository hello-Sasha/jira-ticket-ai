import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { TemplateCacheService } from './template-cache.service';

const body = (text: string) => ({
  Body: { transformToString: jest.fn().mockResolvedValue(text) },
});

describe('TemplateCacheService', () => {
  let service: TemplateCacheService;
  let s3: { send: jest.Mock };

  const build = async (bucket: string): Promise<TemplateCacheService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateCacheService,
        { provide: S3Client, useValue: s3 },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(bucket) } },
      ],
    }).compile();
    return module.get<TemplateCacheService>(TemplateCacheService);
  };

  beforeEach(async () => {
    s3 = { send: jest.fn().mockResolvedValue(body('<p>Hello {{name}}</p>')) };
    service = await build('templates-bucket');
  });

  it('compiles a template and renders data into it', async () => {
    const template = await service.get('invoice', 1);

    expect(template({ name: 'Acme' })).toBe('<p>Hello Acme</p>');
  });

  it('fetches once and serves the rest from cache', async () => {
    await service.get('invoice', 1);
    await service.get('invoice', 1);
    await service.get('invoice', 1);

    expect(s3.send).toHaveBeenCalledTimes(1);
  });

  it('treats a new version as a different template', async () => {
    await service.get('invoice', 1);
    await service.get('invoice', 2);

    expect(s3.send).toHaveBeenCalledTimes(2);
    expect(service.size).toBe(2);
  });

  it('reads the versioned key from S3', async () => {
    await service.get('invoice', 7);

    const command = s3.send.mock.calls[0][0] as GetObjectCommand;
    expect(command.input.Key).toBe('templates/invoice/v7.html');
  });

  it('collapses concurrent misses into one fetch', async () => {
    let release: (value: unknown) => void = () => undefined;
    s3.send.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const all = Promise.all([
      service.get('invoice', 1),
      service.get('invoice', 1),
      service.get('invoice', 1),
    ]);

    release(body('<p>{{name}}</p>'));
    await all;

    expect(s3.send).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed fetch', async () => {
    s3.send.mockRejectedValueOnce(new Error('NoSuchKey'));

    await expect(service.get('missing', 1)).rejects.toThrow('NoSuchKey');

    s3.send.mockResolvedValue(body('<p>ok</p>'));
    await expect(service.get('missing', 1)).resolves.toBeDefined();
    expect(s3.send).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty template rather than rendering a blank PDF', async () => {
    s3.send.mockResolvedValue({ Body: { transformToString: jest.fn().mockResolvedValue('') } });

    await expect(service.get('blank', 1)).rejects.toThrow('empty');
  });

  it('fails loudly when no bucket is configured', async () => {
    service = await build('');

    await expect(service.get('invoice', 1)).rejects.toThrow('DEFAULT_BUCKET');
  });
});
