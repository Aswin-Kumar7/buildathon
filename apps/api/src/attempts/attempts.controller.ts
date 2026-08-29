import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type {
  AttemptDetailResponse,
  AttemptRowsResponse,
  AttemptRowStatus,
  OrderDetailResponse,
  OrdersResponse,
} from '@sentinel/contracts';
import { AttemptsService } from './attempts.service.js';
import { SessionGuard } from '../auth/session.guard.js';

const ROW_STATUSES = new Set<AttemptRowStatus>([
  'captured',
  'failed',
  'recovered',
  'authorized',
  'refunded',
  'pending',
]);

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
    const validSource =
      source === undefined || source === 'razorpay' || source === 'replay' || source === 'all';
    if (
      (entityKind !== undefined && !validKind) ||
      (entityKey !== undefined && entityKind === undefined) ||
      !validSource
    ) {
      throw new BadRequestException('entityKind, entityKey and source are invalid or incomplete');
    }
    return this.attempts.listOrders(bounded, {
      source: (source ?? 'razorpay') as 'razorpay' | 'replay' | 'all',
      ...(entityKey !== undefined && entityKind !== undefined
        ? {
            entityKind: entityKind as 'session' | 'device' | 'network',
            entityKey,
          }
        : {}),
    });
  }

  /** The flat attempts table the console renders: one row per attempt, paged and filtered. */
  @Get('rows')
  async rows(
    @Query('source') source?: string,
    @Query('status') status?: string,
    @Query('method') method?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<AttemptRowsResponse> {
    const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
    const size = Math.min(Math.max(Math.trunc(Number(pageSize)) || 10, 1), 100);
    return this.attempts.listAttemptRows({
      source: source === 'replay' || source === 'all' ? source : 'razorpay',
      status: ROW_STATUSES.has(status as AttemptRowStatus) ? (status as AttemptRowStatus) : 'all',
      method: method !== undefined && method !== '' ? method : 'all',
      page: pageNum,
      pageSize: size,
    });
  }

  /**
   * One payment attempt in full: what happened to it, what was observed around it, and the incident
   * it belongs to if any. Declared before `:orderId` so the static `payment` segment is not read as
   * an order id.
   */
  @Get('payment/:paymentId')
  async attempt(@Param('paymentId') paymentId: string): Promise<AttemptDetailResponse> {
    return { attempt: await this.attempts.getAttemptDetail(paymentId) };
  }

  @Get(':orderId')
  async detail(@Param('orderId') orderId: string): Promise<OrderDetailResponse> {
    return { order: await this.attempts.getOrder(orderId) };
  }
}
