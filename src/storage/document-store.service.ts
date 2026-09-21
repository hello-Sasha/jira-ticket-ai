import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OrgDestination, StoreResult } from './org-destination';

interface CachedClient {
  client: S3Client;
  expiresAt: number;
}

/** Refresh a little before expiry rather than on it. */
const CREDENTIAL_SKEW_MS = 5 * 60_000;

@Injectable()
export class DocumentStoreService {
  private readonly logger = new Logger(DocumentStoreService.name);
  /** Assumed-role clients, cached per org. Without this, every document
   * costs an extra AssumeRole call. */
  private readonly assumed = new Map<string, CachedClient>();

  constructor(
    private readonly defaultS3: S3Client,
    private readonly sts: STSClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Write the PDF where the org asked for it.
   *
   * A customer bucket that rejects the write - revoked role, changed policy,
   * a KMS key we cannot use - must not become an infinite retry or a lost
   * document. We fall back to our own bucket and report the write as degraded
   * so the org can be alerted. They still have their PDF, just not where they
   * asked.
   */
  async store(
    destination: OrgDestination,
    key: string,
    pdf: Buffer,
  ): Promise<StoreResult> {
    if (destination.customBucket) {
      try {
        const client = await this.clientForOrg(destination);
        await client.send(
          new PutObjectCommand({
            Bucket: destination.customBucket.bucket,
            Key: key,
            Body: pdf,
            ContentType: 'application/pdf',
          }),
        );
        return { bucket: destination.customBucket.bucket, key, degraded: false };
      } catch (error) {
        // Drop the cached client: a stale or revoked credential must not be
        // reused on the next document.
        this.assumed.delete(destination.orgId);
        this.logger.error(
          `Write to customer bucket ${destination.customBucket.bucket} failed for org ` +
            `${destination.orgId}, falling back: ${(error as Error).message}`,
        );
      }
    }

    const bucket = this.defaultBucket();
    await this.defaultS3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: pdf,
        ContentType: 'application/pdf',
      }),
    );

    return { bucket, key, degraded: Boolean(destination.customBucket) };
  }

  /**
   * Validate an org's cross-account setup at configuration time, so a broken
   * role is found when they set it up rather than during their first batch.
   */
  async validateDestination(destination: OrgDestination): Promise<void> {
    if (!destination.customBucket) {
      return;
    }
    const client = await this.clientForOrg(destination);
    await client.send(
      new PutObjectCommand({
        Bucket: destination.customBucket.bucket,
        Key: `.pdf-converter-access-check/${Date.now()}`,
        Body: Buffer.from('ok'),
        ContentType: 'text/plain',
      }),
    );
  }

  private async clientForOrg(destination: OrgDestination): Promise<S3Client> {
    const custom = destination.customBucket;
    if (!custom) {
      throw new Error(`Org ${destination.orgId} has no custom bucket configured`);
    }

    const cached = this.assumed.get(destination.orgId);
    if (cached && cached.expiresAt > Date.now() + CREDENTIAL_SKEW_MS) {
      return cached.client;
    }

    const assumed = await this.sts.send(
      new AssumeRoleCommand({
        RoleArn: custom.roleArn,
        ExternalId: custom.externalId,
        RoleSessionName: `pdf-converter-${destination.orgId}`.slice(0, 64),
        DurationSeconds: 3600,
      }),
    );

    const credentials = assumed.Credentials;
    if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
      throw new Error(`AssumeRole for org ${destination.orgId} returned no credentials`);
    }

    const client = new S3Client({
      region: custom.region,
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
      },
    });

    this.assumed.set(destination.orgId, {
      client,
      expiresAt: credentials.Expiration?.getTime() ?? Date.now() + 3600_000,
    });

    return client;
  }

  private defaultBucket(): string {
    const bucket = this.config.get<string>('s3.defaultBucket');
    if (!bucket) {
      throw new Error('DEFAULT_BUCKET is not configured');
    }
    return bucket;
  }
}
