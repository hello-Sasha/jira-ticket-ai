import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { TemplateCacheService } from './template-cache.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: S3Client,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new S3Client({ region: config.get<string>('aws.region') }),
    },
    TemplateCacheService,
  ],
  exports: [TemplateCacheService, S3Client],
})
export class TemplatesModule {}
