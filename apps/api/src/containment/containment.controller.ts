import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  approvalRequestSchema,
  containmentListResponseSchema,
  containmentResponseSchema,
  policyResponseSchema,
  proposeRequestSchema,
  simulateRequestSchema,
  simulationResponseSchema,
  type ContainmentListResponse,
  type ContainmentResponse,
  type PolicyResponse,
  type SimulationResponse,
} from '@sentinel/contracts';
import { policyHash } from '@sentinel/policy';
import { ContainmentService } from './containment.service.js';
import { SimulationService } from './simulation.service.js';
import { PolicyService } from '../policy/policy.service.js';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';

@Controller()
@UseGuards(SessionGuard)
export class ContainmentController {
  constructor(
    private readonly containment: ContainmentService,
    private readonly simulation: SimulationService,
    private readonly policy: PolicyService,
  ) {}

  /**
   * The policy as loaded, for the console to show.
   *
   * The allowlist is reported as counts rather than contents. Its entries are pseudonyms of real
   * sessions and networks, and there is no reason for a page to hand them out when the only
   * thing a reader needs to know is that they exist.
   */
  @Get('policy')
  current(): PolicyResponse {
    const { allowlist, ...rest } = this.policy.policy;

    return policyResponseSchema.parse({
      ...rest,
      hash: policyHash(this.policy.policy),
      allowlisted: {
        sessions: allowlist.sessions.length,
        devices: allowlist.devices.length,
        networks: allowlist.networks.length,
      },
    });
  }

  /** Changes nothing. A simulator with a side effect is a deploy with extra steps. */
  @Post('policy/simulate')
  async simulate(@Body() body: unknown): Promise<SimulationResponse> {
    const { policy, limit } = simulateRequestSchema.parse(body);
    return simulationResponseSchema.parse(await this.simulation.simulate(policy, limit ?? 50));
  }

  @Get('containments')
  async list(@Query('incidentId') incidentId?: string): Promise<ContainmentListResponse> {
    return containmentListResponseSchema.parse({
      containments: await this.containment.list(incidentId),
    });
  }

  @Post('incidents/:id/propose')
  async propose(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ): Promise<ContainmentResponse> {
    const { note } = proposeRequestSchema.parse(body ?? {});
    return containmentResponseSchema.parse({
      containment: await this.containment.propose(id, request.user!.id, note),
    });
  }

  @Post('containments/:id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ): Promise<ContainmentResponse> {
    const { note } = approvalRequestSchema.parse(body ?? {});
    return containmentResponseSchema.parse({
      containment: await this.containment.approve(id, request.user!.id, note),
    });
  }

  @Post('containments/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ): Promise<ContainmentResponse> {
    const { note } = approvalRequestSchema.parse(body ?? {});
    return containmentResponseSchema.parse({
      containment: await this.containment.reject(id, request.user!.id, note),
    });
  }

  @Post('containments/:id/extend')
  async extend(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ): Promise<ContainmentResponse> {
    const { note, minutes } = approvalRequestSchema.parse(body ?? {});
    return containmentResponseSchema.parse({
      containment: await this.containment.extend(id, request.user!.id, minutes ?? 15, note),
    });
  }

  @Post('containments/:id/release')
  async release(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ): Promise<ContainmentResponse> {
    const { note } = approvalRequestSchema.parse(body ?? {});
    return containmentResponseSchema.parse({
      containment: await this.containment.release(id, request.user!.id, note),
    });
  }
}
