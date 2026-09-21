import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Handlebars from 'handlebars';

export type CompiledTemplate = (data: Record<string, unknown>) => string;

/**
 * Templates change rarely and render constantly, so fetching and compiling per
 * document would turn a 100,000-document batch into 100,000 S3 GETs. The cache
 * is keyed by id AND version, so publishing a new version invalidates cleanly
 * instead of serving stale output until a restart.
 */
@Injectable()
export class TemplateCacheService {
  private readonly logger = new Logger(TemplateCacheService.name);
  private readonly cache = new Map<string, CompiledTemplate>();
  /** In-flight fetches, so N concurrent misses cause one GET, not N. */
  private readonly inFlight = new Map<string, Promise<CompiledTemplate>>();

  constructor(
    private readonly s3: S3Client,
    private readonly config: ConfigService,
  ) {}

  async get(templateId: string, version: number): Promise<CompiledTemplate> {
    const key = `${templateId}@${version}`;

    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    const load = this.load(templateId, version, key);
    this.inFlight.set(key, load);

    try {
      return await load;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async load(
    templateId: string,
    version: number,
    key: string,
  ): Promise<CompiledTemplate> {
    const bucket = this.config.get<string>('s3.defaultBucket');
    if (!bucket) {
      throw new Error('DEFAULT_BUCKET is not configured');
    }

    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `templates/${templateId}/v${version}.html`,
      }),
    );

    const source = await response.Body?.transformToString();
    if (!source) {
      throw new Error(`Template ${key} is empty`);
    }

    const compiled = Handlebars.compile(source, { strict: false });
    const fn: CompiledTemplate = (data) => compiled(data);

    this.cache.set(key, fn);
    this.logger.log(`Compiled template ${key} (${this.cache.size} cached)`);
    return fn;
  }

  /** Test seam and operational escape hatch. */
  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
