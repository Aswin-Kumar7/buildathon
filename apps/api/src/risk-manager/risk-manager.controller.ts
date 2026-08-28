import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  policyPreviewResponseSchema,
  riskAcceptRequestSchema,
  riskAcceptResponseSchema,
  riskRecommendationResponseSchema,
  riskRejectRequestSchema,
  type PolicyPreviewResponse,
  type RiskAcceptResponse,
  type RiskRecommendationResponse,
} from '@sentinel/contracts';
import { RiskManagerService } from './risk-manager.service.js';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';

/**
 * The AI Risk Manager's request surface. Advisory reads (the recommendation, the policy preview) and
 * the two writes a merchant makes on it (accept, reject). Accept dispatches through the existing
 * rails — it never executes anything itself — and the service re-validates the recommendation
 * server-side, so a client cannot smuggle in an action the backend would not currently support.
 */
@Controller('incidents')
@UseGuards(SessionGuard)
export class RiskManagerController {
  constructor(private readonly risk: RiskManagerService) {}

  @Get(':id/recommendation')
  async recommendation(@Param('id') id: string): Promise<RiskRecommendationResponse> {
    return riskRecommendationResponseSchema.parse({
      recommendation: await this.risk.recommend(id),
    });
  }

  @Get(':id/policy-preview')
  async policyPreview(@Param('id') id: string): Promise<PolicyPreviewResponse> {
    return policyPreviewResponseSchema.parse({ decision: await this.risk.policyPreview(id) });
  }

  @Post(':id/recommendation/accept')
  async accept(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ): Promise<RiskAcceptResponse> {
    const { groundingHash, note } = riskAcceptRequestSchema.parse(body ?? {});
    return riskAcceptResponseSchema.parse(
      await this.risk.accept(id, request.user!.id, groundingHash, note),
    );
  }

  @Post(':id/recommendation/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ): Promise<{ ok: true }> {
    const { note } = riskRejectRequestSchema.parse(body ?? {});
    await this.risk.reject(id, request.user!.id, note);
    return { ok: true };
  }
}
