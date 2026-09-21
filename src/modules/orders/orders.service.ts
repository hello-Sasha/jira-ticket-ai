import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PresignedUpload, S3Service } from '../../storage/s3.service';
import { AuditService } from '../audit/audit.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order, OrderStatus } from './entities/order.entity';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly s3: S3Service,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    const existing = await this.orders.findOne({ where: { externalRef: dto.externalRef } });
    if (existing) {
      throw new ConflictException(`Order with externalRef ${dto.externalRef} already exists`);
    }

    const order = this.orders.create({
      merchantId: dto.merchantId,
      externalRef: dto.externalRef,
      totalCents: dto.totalCents,
      currency: dto.currency ?? 'USD',
      status: OrderStatus.PENDING,
    });

    const saved = await this.orders.save(order);
    this.logger.log(`Created order ${saved.id} for merchant ${saved.merchantId}`);

    await this.audit.record({
      merchantId: saved.merchantId,
      entityType: 'order',
      entityId: saved.id,
      action: 'order.created',
      metadata: { totalCents: saved.totalCents, currency: saved.currency },
    });

    return saved;
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  async findByMerchant(merchantId: string): Promise<Order[]> {
    return this.orders.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Idempotent: marking an already-paid order paid again is a no-op, not an error.
   * SQS may deliver the same message more than once.
   */
  async markPaid(externalRef: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { externalRef } });
    if (!order) {
      throw new NotFoundException(`Order with externalRef ${externalRef} not found`);
    }

    if (order.status === OrderStatus.PAID) {
      return order;
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new ConflictException(`Order ${order.id} is cancelled and cannot be marked paid`);
    }

    order.status = OrderStatus.PAID;
    const saved = await this.orders.save(order);

    await this.audit.record({
      merchantId: saved.merchantId,
      entityType: 'order',
      entityId: saved.id,
      action: 'order.paid',
    });

    return saved;
  }

  /**
   * Presigned PUT so the merchant uploads the receipt straight to S3.
   * Throws NotFound rather than handing out a URL for an order that does not exist.
   */
  async createReceiptUploadUrl(id: string, contentType: string): Promise<PresignedUpload> {
    const order = await this.findOne(id);
    const key = `receipts/${order.merchantId}/${order.id}.pdf`;
    return this.s3.createUploadUrl(key, contentType);
  }

  async getReceiptDownloadUrl(id: string): Promise<string> {
    const order = await this.findOne(id);
    return this.s3.createDownloadUrl(`receipts/${order.merchantId}/${order.id}.pdf`);
  }
}
