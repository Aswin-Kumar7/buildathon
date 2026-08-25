import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import type { IngestionMetrics, WebhookAck } from '@sentinel/contracts';
import { IngestService } from './ingest.service.js';
import { WebhookMetricsService } from './metrics.service.js';
import { EVENT_ID_HEADER, SIGNATURE_HEADER } from './signature.js';
import { SessionGuard } from '../auth/session.guard.js';

@Controller()
export class WebhooksController {
  constructor(
    private readonly ingest: IngestService,
    private readonly metrics: WebhookMetricsService,
  ) {}

  /**
   * Razorpay's delivery endpoint. Unauthenticated by necessity — Razorpay has no session
   * with us — and authenticated in the only way that matters here, by the HMAC over the
   * body.
   *
   * Returns 200 only after the event is committed. Any failure before that point must be
   * a non-2xx, because a 2xx is a promise we will never need this event again: Razorpay
   * retries for 24 hours and then stops forever.
   */
  @Post('webhooks/razorpay')
  @HttpCode(200)
  async receive(@Req() request: RawBodyRequest<Request>): Promise<WebhookAck> {
    const rawBody = request.rawBody;
    if (rawBody === undefined || rawBody.length === 0) {
      // Without the exact bytes there is nothing to verify a signature against, and
      // verifying a re-serialised body would accept a forgery.
      throw new BadRequestException('Empty request body');
    }

    const result = await this.ingest.ingest(rawBody, {
      signature: request.header(SIGNATURE_HEADER),
      eventId: request.header(EVENT_ID_HEADER),
    });

    return { received: true, stored: result.stored, late: result.late };
  }

  /** Read by the system health page. Behind the session guard: it describes our internals. */
  @Get('ingestion/metrics')
  @UseGuards(SessionGuard)
  async ingestionMetrics(): Promise<IngestionMetrics> {
    return this.metrics.collect();
  }
}
