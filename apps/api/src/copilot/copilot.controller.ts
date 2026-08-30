import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  copilotAnswerResponseSchema,
  copilotAskRequestSchema,
  type CopilotAnswerResponse,
} from '@sentinel/contracts';
import { CopilotService } from './copilot.service.js';
import { SessionGuard } from '../auth/session.guard.js';

/**
 * The incident copilot's request surface — one grounded question, one grounded answer. Behind the
 * session guard (and its double-submit CSRF check, since it is a POST), like every other write-shaped
 * route. It changes no state: it reads the incident and asks the model, and returns an honest
 * "unavailable" rather than a fabricated answer when the model cannot be reached.
 */
@Controller('incidents')
@UseGuards(SessionGuard)
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post(':id/ask')
  async ask(@Param('id') id: string, @Body() body: unknown): Promise<CopilotAnswerResponse> {
    const { question } = copilotAskRequestSchema.parse(body ?? {});
    return copilotAnswerResponseSchema.parse(await this.copilot.ask(id, question));
  }
}
