import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  auditListResponseSchema,
  auditVerifyResponseSchema,
  type AuditListResponse,
  type AuditVerifyResponse,
} from '@sentinel/contracts';
import { AuditService } from './audit.service.js';
import { SessionGuard } from '../auth/session.guard.js';

@Controller('audit')
@UseGuards(SessionGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @Query('incidentId') incidentId?: string,
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
  ): Promise<AuditListResponse> {
    const entries =
      incidentId !== undefined
        ? await this.audit.listForIncident(incidentId)
        : await this.audit.list(subjectType, subjectId);

    return auditListResponseSchema.parse({ entries });
  }

  /**
   * Walks the chain and reports the first place it stops adding up.
   *
   * A GET would be more RESTful, but this is the button an operator presses to prove the record
   * has not been touched, and a POST keeps it out of anything that prefetches or caches GETs —
   * the answer must always be computed fresh, never served from a store that could itself be the
   * thing that was tampered with.
   */
  @Post('verify')
  async verify(): Promise<AuditVerifyResponse> {
    return auditVerifyResponseSchema.parse(await this.audit.verify());
  }
}
