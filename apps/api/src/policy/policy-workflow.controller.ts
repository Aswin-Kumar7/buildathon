import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  policySaveRequestSchema,
  policyVersionListResponseSchema,
  policyVersionSchema,
} from '@sentinel/contracts';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { PolicyWorkflowService } from './policy-workflow.service.js';

/**
 * Policy history and the two operations that write to it.
 *
 * Saving takes effect immediately — there is no draft, submit, approve or publish step. The safety
 * property is recovery rather than prevention: history is append-only, every version keeps its
 * source, and `revert` brings an earlier one back by writing it forward as a new version.
 */
@Controller('policy')
@UseGuards(SessionGuard)
export class PolicyWorkflowController {
  constructor(private readonly workflow: PolicyWorkflowService) {}

  @Get('versions')
  async list() {
    return policyVersionListResponseSchema.parse(await this.workflow.list());
  }

  @Post('save')
  async save(@Body() body: unknown, @Req() request: AuthedRequest) {
    const { source } = policySaveRequestSchema.parse(body);
    return {
      version: policyVersionSchema.parse(await this.workflow.save(source, request.user!.id)),
    };
  }

  @Post('versions/:id/revert')
  async revert(@Param('id') id: string, @Req() request: AuthedRequest) {
    return { version: policyVersionSchema.parse(await this.workflow.revert(id, request.user!.id)) };
  }
}
