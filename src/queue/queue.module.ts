import { SQSClient } from '@aws-sdk/client-sqs';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { OrdersModule } from '../modules/orders/orders.module';
import { OrderEventsConsumer } from './order-events.consumer';

@Module({
  imports: [ConfigModule, OrdersModule],
  providers: [
    {
      provide: SQSClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SQSClient({ region: config.get<string>('sqs.region') }),
    },
    OrderEventsConsumer,
  ],
  exports: [OrderEventsConsumer],
})
export class QueueModule {}
