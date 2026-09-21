import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { S3Service } from './s3.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: S3Client,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new S3Client({ region: config.get<string>('s3.region') }),
    },
    S3Service,
  ],
  exports: [S3Service],
})
export class StorageModule {}
