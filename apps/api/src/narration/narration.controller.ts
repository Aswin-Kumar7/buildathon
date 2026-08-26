import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { narrativeResponseSchema, type NarrativeResponse } from '@sentinel/contracts';
import { SessionGuard } from '../auth/session.guard.js';
import { NarrationService } from './narration.service.js';

/**
 * The narrative for one incident, on its own path rather than folded into the detail response: it
 * may involve a provider call, and a reader should get the incident immediately and the account a
 * beat later, not wait for the second to see the first. The response is parsed through the contract
 * on the way out, so nothing but known sources and bound strings ever leaves here.
 */
@Controller('incidents')
@UseGuards(SessionGuard)
export class NarrationController {
  constructor(private readonly narration: NarrationService) {}

  @Get(':id/narrative')
  async narrative(@Param('id') id: string): Promise<NarrativeResponse> {
    const narrative = await this.narration.narrate(id);
    return narrativeResponseSchema.parse({ narrative });
  }
}
