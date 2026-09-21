import { DeleteMessageCommand, Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OrdersService } from '../modules/orders/orders.service';

interface OrderPaidEvent {
  type: 'order.paid';
  externalRef: string;
}

@Injectable()
export class OrderEventsConsumer {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  constructor(
    private readonly sqs: SQSClient,
    private readonly config: ConfigService,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Polls once and handles whatever is on the queue. Called on a schedule by the
   * runtime (Lambda event source, or a cron in the container).
   *
   * Handlers must be idempotent - SQS guarantees at-least-once delivery.
   */
  async pollOnce(): Promise<number> {
    const queueUrl = this.config.get<string>('sqs.orderEventsQueueUrl');
    if (!queueUrl) {
      this.logger.warn('ORDER_EVENTS_QUEUE_URL is not configured; skipping poll');
      return 0;
    }

    const response = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
      }),
    );

    const messages = response.Messages ?? [];
    let handled = 0;

    for (const message of messages) {
      try {
        await this.handleMessage(message);
        await this.sqs.send(
          new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
        handled += 1;
      } catch (error) {
        // Leave the message on the queue so it is retried, then dead-lettered.
        this.logger.error(
          `Failed to handle message ${message.MessageId}: ${(error as Error).message}`,
        );
      }
    }

    return handled;
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.Body) {
      throw new Error('Message has no body');
    }

    const event = JSON.parse(message.Body) as OrderPaidEvent;

    switch (event.type) {
      case 'order.paid':
        await this.ordersService.markPaid(event.externalRef);
        break;
      default:
        throw new Error(`Unknown event type: ${String(event.type)}`);
    }
  }
}
