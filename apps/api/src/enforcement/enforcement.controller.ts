import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  enforcementActionRequestSchema,
  enforcementPauseResponseSchema,
  enforcementStateSchema,
  type EnforcementPauseResponse,
  type EnforcementState,
} from '@sentinel/contracts';
import { Roles, SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { ContainmentService } from '../containment/containment.service.js';
import { EnforcementService } from './enforcement.service.js';

/**
 * The emergency stop — pause and resume enforcement at runtime.
 *
 * Pausing is fast and needs one admin, because stopping Sentinel from blocking people is the
 * customer-protective direction and every second of a wrong block is a real harm. Resuming
 * re-enables blocking, which is the direction that warrants care.
 */
@Controller('enforcement')
@UseGuards(SessionGuard)
export class EnforcementController {
  constructor(
    private readonly enforcement: EnforcementService,
    private readonly containment: ContainmentService,
  ) {}

  /** Current state, for the console banner. Any signed-in user may read it. */
  @Get()
  async state(): Promise<EnforcementState> {
    return enforcementStateSchema.parse(await this.enforcement.state());
  }

  /**
   * Pauses enforcement AND releases every live block, at once, on one admin's word. The pause is set
   * first — so no new block can form in the gap — then the active containments are released.
   */
  @Post('pause')
  @HttpCode(200)
  @Roles('admin')
  async pause(@Body() body: unknown, @Req() req: AuthedRequest): Promise<EnforcementPauseResponse> {
    const { reason } = enforcementActionRequestSchema.parse(body ?? {});
    const state = await this.enforcement.pause(req.user!.id, reason);
    const released = await this.containment.releaseAllActive(
      req.user!.id,
      'released by emergency enforcement pause',
    );
    return enforcementPauseResponseSchema.parse({ state, released });
  }

  @Post('resume')
  @HttpCode(200)
  @Roles('admin')
  async resume(@Body() body: unknown, @Req() req: AuthedRequest): Promise<EnforcementState> {
    const { reason } = enforcementActionRequestSchema.parse(body ?? {});
    return enforcementStateSchema.parse(await this.enforcement.resume(req.user!.id, reason));
  }
}
