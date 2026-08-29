import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { overviewResponseSchema, type OverviewResponse } from '@sentinel/contracts';
import { SessionGuard } from '../auth/session.guard.js';
import { OverviewService } from './overview.service.js';

@Controller('overview')
@UseGuards(SessionGuard)
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get()
  async get(
    @Query('window') window?: string,
    @Query('source') source?: string,
  ): Promise<OverviewResponse> {
    const selected =
      window === '30d' ? '30d' : window === '7d' ? '7d' : window === '24h' ? '24h' : 'today';
    const scope = source === 'replay' || source === 'all' ? source : 'razorpay';
    return overviewResponseSchema.parse(await this.overview.get(selected, scope));
  }
}
