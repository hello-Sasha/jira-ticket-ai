import { DeleteMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { OrdersService } from '../modules/orders/orders.service';
import { OrderEventsConsumer } from './order-events.consumer';

describe('OrderEventsConsumer', () => {
  let consumer: OrderEventsConsumer;
  let sqs: { send: jest.Mock };
  let ordersService: { markPaid: jest.Mock };

  const QUEUE_URL = 'https://sqs.us-west-2.amazonaws.com/123456789012/order-events';

  beforeEach(async () => {
    sqs = { send: jest.fn() };
    ordersService = { markPaid: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderEventsConsumer,
        { provide: SQSClient, useValue: sqs },
        { provide: OrdersService, useValue: ordersService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(QUEUE_URL) },
        },
      ],
    }).compile();

    consumer = module.get<OrderEventsConsumer>(OrderEventsConsumer);
  });

  it('handles an order.paid event and deletes the message', async () => {
    sqs.send
      .mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'm1',
            ReceiptHandle: 'rh1',
            Body: JSON.stringify({ type: 'order.paid', externalRef: 'ext-1' }),
          },
        ],
      })
      .mockResolvedValueOnce({});

    const handled = await consumer.pollOnce();

    expect(handled).toBe(1);
    expect(ordersService.markPaid).toHaveBeenCalledWith('ext-1');
    expect(sqs.send.mock.calls[1][0]).toBeInstanceOf(DeleteMessageCommand);
  });

  it('leaves the message on the queue when the handler throws', async () => {
    sqs.send.mockResolvedValueOnce({
      Messages: [
        {
          MessageId: 'm1',
          ReceiptHandle: 'rh1',
          Body: JSON.stringify({ type: 'order.paid', externalRef: 'ext-1' }),
        },
      ],
    });
    ordersService.markPaid.mockRejectedValue(new Error('db down'));

    const handled = await consumer.pollOnce();

    expect(handled).toBe(0);
    // Only the receive call - no delete.
    expect(sqs.send).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown event type without deleting the message', async () => {
    sqs.send.mockResolvedValueOnce({
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'rh1', Body: JSON.stringify({ type: 'order.exploded' }) },
      ],
    });

    const handled = await consumer.pollOnce();

    expect(handled).toBe(0);
    expect(ordersService.markPaid).not.toHaveBeenCalled();
  });

  it('returns 0 and does not call SQS when the queue URL is not configured', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderEventsConsumer,
        { provide: SQSClient, useValue: sqs },
        { provide: OrdersService, useValue: ordersService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
      ],
    }).compile();

    const unconfigured = module.get<OrderEventsConsumer>(OrderEventsConsumer);

    await expect(unconfigured.pollOnce()).resolves.toBe(0);
    expect(sqs.send).not.toHaveBeenCalled();
  });

  it('returns 0 when the queue is empty', async () => {
    sqs.send.mockResolvedValueOnce({});

    await expect(consumer.pollOnce()).resolves.toBe(0);
  });
});
