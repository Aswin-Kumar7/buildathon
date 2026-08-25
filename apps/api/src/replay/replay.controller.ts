import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SCENARIOS, SCENARIO_FAMILIES, type ScenarioFamily } from '@sentinel/corpus';
import { ReplayService, type ReplayResult } from './replay.service.js';
import { SessionGuard } from '../auth/session.guard.js';

/**
 * Behind the session guard, and refused outright in production by the service.
 *
 * The route is mounted in every build so that the refusal is a code path a test can exercise,
 * rather than a wiring decision that changes with an environment variable and is therefore
 * never tested in the configuration that matters.
 */
@Controller('replay')
@UseGuards(SessionGuard)
export class ReplayController {
  constructor(private readonly replay: ReplayService) {}

  /** The catalogue, with the labels each scenario was registered with. */
  @Get()
  async list() {
    return {
      scenarios: SCENARIO_FAMILIES.map((family) => {
        const spec = SCENARIOS[family];
        return {
          family,
          title: spec.title,
          narrative: spec.narrative,
          classification: spec.classification,
          correlation: spec.correlation,
          recommendedAction: spec.recommendedAction,
          difficulty: spec.difficulty,
        };
      }),
      counts: await this.replay.counts(),
    };
  }

  @Post()
  @HttpCode(200)
  async run(@Body() body: { family?: string }): Promise<ReplayResult> {
    return this.replay.replay(body.family as ScenarioFamily);
  }

  @Delete()
  async clear() {
    return this.replay.clear();
  }
}
