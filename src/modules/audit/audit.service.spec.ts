import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';

import { AuditService } from './audit.service';
import { AuditEvent } from './schemas/audit-event.schema';

describe('AuditService', () => {
  let service: AuditService;
  let model: { create: jest.Mock; find: jest.Mock };
  let chain: {
    sort: jest.Mock;
    limit: jest.Mock;
    lean: jest.Mock;
    exec: jest.Mock;
  };

  beforeEach(async () => {
    chain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    model = {
      create: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue(chain),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: getModelToken(AuditEvent.name), useValue: model }],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  describe('record', () => {
    it('persists the event with an occurredAt timestamp', async () => {
      await service.record({
        merchantId: 'm1',
        entityType: 'order',
        entityId: 'o1',
        action: 'order.created',
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId: 'm1',
          action: 'order.created',
          occurredAt: expect.any(Date),
        }),
      );
    });

    it('defaults metadata to an empty object', async () => {
      await service.record({
        merchantId: 'm1',
        entityType: 'order',
        entityId: 'o1',
        action: 'order.created',
      });

      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }));
    });

    it('swallows a write failure so auditing never breaks the audited operation', async () => {
      model.create.mockRejectedValue(new Error('mongo down'));

      await expect(
        service.record({
          merchantId: 'm1',
          entityType: 'order',
          entityId: 'o1',
          action: 'order.created',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('findRecentForMerchant', () => {
    it('sorts newest first and applies the default limit', async () => {
      await service.findRecentForMerchant('m1');

      expect(model.find).toHaveBeenCalledWith({ merchantId: 'm1' });
      expect(chain.sort).toHaveBeenCalledWith({ occurredAt: -1 });
      expect(chain.limit).toHaveBeenCalledWith(50);
    });

    it('caps the limit at 200 so a caller cannot ask for the whole collection', async () => {
      await service.findRecentForMerchant('m1', 10000);

      expect(chain.limit).toHaveBeenCalledWith(200);
    });
  });
});
