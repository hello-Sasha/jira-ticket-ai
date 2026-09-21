import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { S3Service } from '../../storage/s3.service';
import { AuditService } from '../audit/audit.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';

type MockRepo = Pick<Repository<Order>, 'findOne' | 'find' | 'create' | 'save'>;

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    merchantId: 'merchant-1',
    externalRef: 'ext-1',
    totalCents: 1000,
    currency: 'USD',
    status: OrderStatus.PENDING,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }) as Order;

describe('OrdersService', () => {
  let service: OrdersService;
  let repo: jest.Mocked<MockRepo>;
  let s3: { createUploadUrl: jest.Mock; createDownloadUrl: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<MockRepo>;

    s3 = {
      createUploadUrl: jest.fn(),
      createDownloadUrl: jest.fn(),
    };

    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: repo },
        { provide: S3Service, useValue: s3 },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('create', () => {
    it('persists a new order and defaults the currency to USD', async () => {
      const dto = { merchantId: 'merchant-1', externalRef: 'ext-1', totalCents: 1000 };
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue(makeOrder());
      repo.save.mockResolvedValue(makeOrder());

      const result = await service.create(dto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD', status: OrderStatus.PENDING }),
      );
      expect(result.externalRef).toBe('ext-1');
    });

    it('writes an audit event for the created order', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue(makeOrder());
      repo.save.mockResolvedValue(makeOrder());

      await service.create({ merchantId: 'merchant-1', externalRef: 'ext-1', totalCents: 1000 });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'order.created', entityType: 'order' }),
      );
    });

    it('rejects a duplicate externalRef', async () => {
      repo.findOne.mockResolvedValue(makeOrder());

      await expect(
        service.create({ merchantId: 'merchant-1', externalRef: 'ext-1', totalCents: 1000 }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFound when the order does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findByMerchant', () => {
    it('returns an empty array when the merchant has no orders', async () => {
      repo.find.mockResolvedValue([]);

      await expect(service.findByMerchant('merchant-x')).resolves.toEqual([]);
    });
  });

  describe('markPaid', () => {
    it('moves a pending order to paid', async () => {
      const order = makeOrder({ status: OrderStatus.PENDING });
      repo.findOne.mockResolvedValue(order);
      repo.save.mockImplementation(async (o) => o as Order);

      const result = await service.markPaid('ext-1');

      expect(result.status).toBe(OrderStatus.PAID);
    });

    it('is idempotent - marking an already-paid order paid does not write again', async () => {
      repo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.PAID }));

      const result = await service.markPaid('ext-1');

      expect(result.status).toBe(OrderStatus.PAID);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('refuses to mark a cancelled order paid', async () => {
      repo.findOne.mockResolvedValue(makeOrder({ status: OrderStatus.CANCELLED }));

      await expect(service.markPaid('ext-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFound for an unknown externalRef', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.markPaid('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createReceiptUploadUrl', () => {
    it('namespaces the S3 key by merchant and order id', async () => {
      const order = makeOrder();
      repo.findOne.mockResolvedValue(order);
      s3.createUploadUrl.mockResolvedValue({
        url: 'https://s3.example/put',
        key: `receipts/${order.merchantId}/${order.id}.pdf`,
        expiresInSeconds: 900,
      });

      const result = await service.createReceiptUploadUrl(order.id, 'application/pdf');

      expect(s3.createUploadUrl).toHaveBeenCalledWith(
        `receipts/${order.merchantId}/${order.id}.pdf`,
        'application/pdf',
      );
      expect(result.url).toBe('https://s3.example/put');
    });

    it('does not hand out a URL for an order that does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.createReceiptUploadUrl('missing-id', 'application/pdf'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(s3.createUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe('getReceiptDownloadUrl', () => {
    it('returns a presigned GET url for an existing order', async () => {
      const order = makeOrder();
      repo.findOne.mockResolvedValue(order);
      s3.createDownloadUrl.mockResolvedValue('https://s3.example/get');

      await expect(service.getReceiptDownloadUrl(order.id)).resolves.toBe(
        'https://s3.example/get',
      );
    });

    it('throws NotFound rather than signing a URL for a missing order', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.getReceiptDownloadUrl('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(s3.createDownloadUrl).not.toHaveBeenCalled();
    });
  });
});
