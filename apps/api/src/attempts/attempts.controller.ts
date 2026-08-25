import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { OrderDetailResponse, OrdersResponse } from '@sentinel/contracts';
import { AttemptsService } from './attempts.service.js';
import { SessionGuard } from '../auth/session.guard.js';

/**
 * Analyst-facing, so behind the session guard. Attempt history describes shoppers — even
 * pseudonymised, it is not something to serve to anyone who asks.
 */
@Controller('attempts')
@UseGuards(SessionGuard)
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get()
  async list(@Query('limit') limit?: string): Promise<OrdersResponse> {
    const parsed = Number(limit);
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
    return this.attempts.listOrders(bounded);
  }

  @Get(':orderId')
  async detail(@Param('orderId') orderId: string): Promise<OrderDetailResponse> {
    return { order: await this.attempts.getOrder(orderId) };
  }
}
