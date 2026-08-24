import { Controller, Get } from '@nestjs/common';
import { healthSchema, type Health } from '@sentinel/contracts';

const STARTED_AT = new Date().toISOString();

@Controller('health')
export class HealthController {
  @Get()
  get(): Health {
    // Parsed rather than cast: the API validates its own responses against the
    // shared contract, so a drift fails here rather than in the browser.
    return healthSchema.parse({
      status: 'ok',
      version: process.env.APP_VERSION ?? '0.0.1',
      commit: process.env.GIT_COMMIT ?? 'dev',
      startedAt: STARTED_AT,
    });
  }
}
