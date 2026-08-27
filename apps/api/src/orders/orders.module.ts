import { Module } from '@nestjs/common';
import { ContainmentModule } from '../containment/containment.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { RazorpayClient } from './razorpay.client.js';
import { TransactionRiskService } from './risk.service.js';

@Module({
  imports: [ContainmentModule],
  controllers: [OrdersController],
  providers: [OrdersService, RazorpayClient, TransactionRiskService],
  exports: [OrdersService],
})
export class OrdersModule {}
