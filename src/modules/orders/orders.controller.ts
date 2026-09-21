import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import { PresignedUpload } from '../../storage/s3.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ReceiptUploadDto } from './dto/receipt-upload.dto';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.ordersService.create(dto);
  }

  @Get()
  findByMerchant(@Query('merchantId') merchantId: string): Promise<Order[]> {
    return this.ordersService.findByMerchant(merchantId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Order> {
    return this.ordersService.findOne(id);
  }

  @Post(':id/receipt-upload-url')
  createReceiptUploadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiptUploadDto,
  ): Promise<PresignedUpload> {
    return this.ordersService.createReceiptUploadUrl(id, dto.contentType ?? 'application/pdf');
  }

  @Get(':id/receipt-url')
  async getReceiptUrl(@Param('id', ParseUUIDPipe) id: string): Promise<{ url: string }> {
    return { url: await this.ordersService.getReceiptDownloadUrl(id) };
  }
}
