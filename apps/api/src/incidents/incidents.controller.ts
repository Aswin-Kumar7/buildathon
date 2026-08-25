import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  evaluateResponseSchema,
  incidentDetailResponseSchema,
  incidentListResponseSchema,
  transitionRequestSchema,
  type EvaluateResponse,
  type IncidentDetailResponse,
  type IncidentListResponse,
} from '@sentinel/contracts';
import { thresholdHash, type IncidentStatus } from '@sentinel/detect';
import { IncidentsService } from './incidents.service.js';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';

const STATUSES: readonly IncidentStatus[] = [
  'open',
  'under_review',
  'contained',
  'resolved',
  'expired',
];

@Controller('incidents')
@UseGuards(SessionGuard)
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('source') source?: string,
  ): Promise<IncidentListResponse> {
    const filter = STATUSES.includes(status as IncidentStatus)
      ? (status as IncidentStatus)
      : undefined;
    const scope = source === 'replay' || source === 'razorpay' ? source : undefined;

    const { incidents, counts } = await this.incidents.list(filter, scope);
    return incidentListResponseSchema.parse({
      incidents,
      counts,
      // Sent with every list so a reader can tell which threshold set produced these. A score
      // means nothing without what it was compared against.
      thresholdHash: thresholdHash(),
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<IncidentDetailResponse> {
    return incidentDetailResponseSchema.parse({ incident: await this.incidents.detail(id) });
  }

  /**
   * Runs a detection pass.
   *
   * A POST because it writes. Exposed at all so a reviewer can watch detection happen on a
   * replayed scenario rather than wait for a timer — the same reason replay exists.
   */
  @Post('evaluate')
  async evaluate(@Query('source') source?: string): Promise<EvaluateResponse> {
    const scope = source === 'replay' || source === 'razorpay' ? source : 'all';
    return evaluateResponseSchema.parse(await this.incidents.evaluate(scope));
  }

  @Post(':id/transition')
  async transition(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ): Promise<IncidentDetailResponse> {
    const { to, note } = transitionRequestSchema.parse(body);
    const incident = await this.incidents.transition(id, to, request.user!.id, note);

    return incidentDetailResponseSchema.parse({ incident });
  }
}
