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

/** Mirrors the local union in AttemptsService; contracts exports the schema, not the type. */
type Severity = 'low' | 'medium' | 'high';

/** `none` is a real choice here — the attempts that belong to no incident at all. */
const ROW_SEVERITIES = new Set<Severity | 'none'>(['low', 'medium', 'high', 'none']);

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
    @Query('q') q?: string,
    @Query('severity') severity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<AttemptRowsResponse> {
    const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
    const size = Math.min(Math.max(Math.trunc(Number(pageSize)) || 10, 1), 100);
    return this.attempts.listAttemptRows({
      source: source === 'replay' || source === 'all' ? source : 'razorpay',
      status: ROW_STATUSES.has(status as AttemptRowStatus) ? (status as AttemptRowStatus) : 'all',
      method: method !== undefined && method !== '' ? method : 'all',
      // Trimmed and lower-cased here so the matcher never has to think about casing, which is
      // exactly where the client-side version of this went wrong.
      q: (q ?? '').trim().toLowerCase(),
      severity: ROW_SEVERITIES.has(severity as Severity | 'none')
        ? (severity as Severity | 'none')
        : 'all',
      from: AttemptsController.boundary(from, 'start'),
      to: AttemptsController.boundary(to, 'end'),
      page: pageNum,
      pageSize: size,
    });
  }

  /** A `YYYY-MM-DD` query bound as an epoch, or null when absent or unparseable. */
  private static boundary(day: string | undefined, edge: 'start' | 'end'): number | null {
    if (day === undefined || day === '') return null;
    const parsed = Date.parse(`${day}T${edge === 'start' ? '00:00:00' : '23:59:59'}Z`);
    return Number.isNaN(parsed) ? null : parsed;
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
