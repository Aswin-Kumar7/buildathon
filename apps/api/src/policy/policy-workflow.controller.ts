import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  policyDraftRequestSchema,
  policyVersionListResponseSchema,
  policyVersionSchema,
} from '@sentinel/contracts';
import { Roles, SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { PolicyWorkflowService } from './policy-workflow.service.js';

@Controller('policy')
@UseGuards(SessionGuard)
export class PolicyWorkflowController {
  constructor(private readonly workflow: PolicyWorkflowService) {}

  @Get('versions')
  async list() {
    return policyVersionListResponseSchema.parse(await this.workflow.list());
  }

  @Post('drafts')
  async draft(@Body() body: unknown, @Req() request: AuthedRequest) {
    const { source } = policyDraftRequestSchema.parse(body);
    return {
      version: policyVersionSchema.parse(await this.workflow.create(source, request.user!.id)),
    };
  }

  @Post('versions/:id/submit')
  async submit(@Param('id') id: string, @Req() request: AuthedRequest) {
    return { version: policyVersionSchema.parse(await this.workflow.submit(id, request.user!.id)) };
  }

  @Post('versions/:id/approve')
  @Roles('admin')
  async approve(@Param('id') id: string, @Req() request: AuthedRequest) {
    return {
      version: policyVersionSchema.parse(await this.workflow.approve(id, request.user!.id)),
    };
  }

  @Post('versions/:id/reject')
  @Roles('admin')
  async reject(@Param('id') id: string, @Req() request: AuthedRequest) {
    return {
      version: policyVersionSchema.parse(await this.workflow.reject(id, request.user!.id)),
    };
  }

  @Post('versions/:id/publish')
  @Roles('admin')
  async publish(@Param('id') id: string, @Req() request: AuthedRequest) {
    return {
      version: policyVersionSchema.parse(await this.workflow.publish(id, request.user!.id)),
    };
  }
}
