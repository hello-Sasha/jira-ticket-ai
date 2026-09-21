import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AuditEvent } from './schemas/audit-event.schema';

export interface RecordEventInput {
  merchantId: string;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditEvent.name)
    private readonly auditEvents: Model<AuditEvent>,
  ) {}

  /**
   * Audit writes must never fail the operation being audited - a lost audit line
   * is bad, a failed order because of one is worse. Logged, not thrown.
   */
  async record(input: RecordEventInput): Promise<void> {
    try {
      await this.auditEvents.create({
        merchantId: input.merchantId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        metadata: input.metadata ?? {},
        occurredAt: new Date(),
      });
    } catch (error) {
      this.logger.error(
        `Failed to record audit event ${input.action} for ${input.entityType}:${input.entityId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  async findRecentForMerchant(merchantId: string, limit = 50): Promise<AuditEvent[]> {
    return this.auditEvents
      .find({ merchantId })
      .sort({ occurredAt: -1 })
      .limit(Math.min(limit, 200))
      .lean()
      .exec();
  }
}
