import { Controller, Get, UseGuards } from '@nestjs/common';
import { workspaceResponseSchema, type WorkspaceResponse } from '@sentinel/contracts';
import { SessionGuard } from '../auth/session.guard.js';
import { SettingsService } from './settings.service.js';

@Controller()
@UseGuards(SessionGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Read-only environment facts the settings page shows instead of hand-typed strings. */
  @Get('workspace')
  workspace(): WorkspaceResponse {
    return workspaceResponseSchema.parse(this.settings.workspace());
  }
}
