import { STSClient } from '@aws-sdk/client-sts';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { TemplatesModule } from '../templates/templates.module';
import { DocumentStoreService } from './document-store.service';

@Module({
  imports: [ConfigModule, TemplatesModule],
  providers: [
    {
      provide: STSClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new STSClient({ region: config.get<string>('aws.region') }),
    },
    DocumentStoreService,
  ],
  exports: [DocumentStoreService],
})
export class StorageModule {}
