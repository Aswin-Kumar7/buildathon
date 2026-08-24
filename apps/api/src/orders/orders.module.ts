import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { RazorpayClient } from './razorpay.client.js';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, RazorpayClient],
  exports: [OrdersService],
})
export class OrdersModule {}
