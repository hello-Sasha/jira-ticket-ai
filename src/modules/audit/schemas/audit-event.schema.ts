import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuditEventDocument = HydratedDocument<AuditEvent>;

@Schema({ collection: 'audit_events', timestamps: true })
export class AuditEvent {
  @Prop({ required: true, index: true })
  merchantId: string;

  @Prop({ required: true, index: true })
  entityType: string;

  @Prop({ required: true, index: true })
  entityId: string;

  @Prop({ required: true })
  action: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ index: true })
  occurredAt: Date;
}

export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);

// Queried as "recent activity for this merchant" on every dashboard load.
AuditEventSchema.index({ merchantId: 1, occurredAt: -1 });
