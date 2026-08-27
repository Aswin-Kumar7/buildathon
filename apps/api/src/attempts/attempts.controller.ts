import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
  async list(
    @Query('limit') limit?: string,
    @Query('entityKind') entityKind?: string,
    @Query('entityKey') entityKey?: string,
    @Query('source') source?: string,
  ): Promise<OrdersResponse> {
    const parsed = Number(limit);
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
    const validKind =
      entityKind === 'session' || entityKind === 'device' || entityKind === 'network';
    const validSource = source === undefined || source === 'razorpay' || source === 'replay';
    if (
      (entityKind !== undefined && !validKind) ||
      (entityKey !== undefined && entityKind === undefined) ||
      !validSource
    ) {
      throw new BadRequestException('entityKind, entityKey and source are invalid or incomplete');
    }
    return this.attempts.listOrders(bounded, {
      source: (source ?? 'razorpay') as 'razorpay' | 'replay',
      ...(entityKey !== undefined && entityKind !== undefined
        ? {
            entityKind: entityKind as 'session' | 'device' | 'network',
            entityKey,
          }
        : {}),
    });
  }

  @Get(':orderId')
  async detail(@Param('orderId') orderId: string): Promise<OrderDetailResponse> {
    return { order: await this.attempts.getOrder(orderId) };
  }
}
