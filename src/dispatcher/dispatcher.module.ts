import { SQSClient } from '@aws-sdk/client-sqs';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { JobsModule } from '../jobs/jobs.module';
import { DispatcherService } from './dispatcher.service';

@Module({
  imports: [ConfigModule, JobsModule],
  providers: [
    {
      provide: SQSClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SQSClient({ region: config.get<string>('aws.region') }),
    },
    DispatcherService,
  ],
  exports: [DispatcherService],
})
export class DispatcherModule {}
