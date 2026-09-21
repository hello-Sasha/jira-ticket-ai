import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PresignedUpload {
  url: string;
  key: string;
  expiresInSeconds: number;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly defaultExpirySeconds = 900;

  constructor(
    private readonly s3: S3Client,
    private readonly config: ConfigService,
  ) {}

  private bucket(): string {
    const bucket = this.config.get<string>('s3.documentsBucket');
    if (!bucket) {
      throw new InternalServerErrorException('DOCUMENTS_BUCKET is not configured');
    }
    return bucket;
  }

  /**
   * Presigned PUT so the client uploads straight to S3 - the document never
   * passes through this service.
   */
  async createUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = this.defaultExpirySeconds,
  ): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket(),
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
    return { url, key, expiresInSeconds };
  }

  async createDownloadUrl(
    key: string,
    expiresInSeconds = this.defaultExpirySeconds,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket(), Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
  }

  async putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    this.logger.log(`Stored s3://${this.bucket()}/${key}`);
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
  }
}
