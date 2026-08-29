import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  simulationRunsResponseSchema,
  simulationStartRequestSchema,
  simulationStartResponseSchema,
  simulationStatusSchema,
  type SimulationRunsResponse,
  type SimulationStartResponse,
  type SimulationStatus,
} from '@sentinel/contracts';
import { SCENARIO_FAMILIES, type ScenarioFamily } from '@sentinel/corpus';
import { SessionGuard } from '../auth/session.guard.js';
import { SimulationService } from './simulation.service.js';
import { ReplayService } from './replay.service.js';

/**
 * Drives the streaming transaction simulator from the console. Behind the session guard, and the
 * mutating routes behind the same double-submit CSRF check as every other write, since a run
 * fills the database with synthetic traffic.
 */
@Controller('simulation')
@UseGuards(SessionGuard)
export class SimulationController {
  constructor(
    private readonly simulation: SimulationService,
    private readonly replay: ReplayService,
  ) {}

  @Get('status')
  async status(): Promise<SimulationStatus> {
    return simulationStatusSchema.parse(await this.simulation.status());
  }

  /** The durable history of past runs and what each one detected — survives the per-run data reset. */
  @Get('runs')
  async runs(): Promise<SimulationRunsResponse> {
    return simulationRunsResponseSchema.parse({ runs: await this.simulation.listRuns() });
  }

  /**
   * Start a run. An optional `family` streams just that committed scenario's behaviour; without it,
   * the full mixed campaign runs. Either way the detector — not this endpoint — decides the outcome.
   */
  @Post('start')
  @HttpCode(200)
  async start(@Body() body: unknown): Promise<SimulationStartResponse> {
    const { family } = simulationStartRequestSchema.parse(body ?? {});
    if (family !== undefined && !SCENARIO_FAMILIES.includes(family as ScenarioFamily)) {
      throw new BadRequestException(`no such scenario: ${family}`);
    }
    // A fresh run starts from a clean slate: the previous run's SIMULATED data (incidents, canonical
    // events via cascade, checkouts) is cleared first — scoped to the replay source, so live traffic
    // and its incidents are never touched. Skipped when a run is already in flight (start is a no-op).
    // A fresh run resets only THIS scenario's previous rows (source='replay' AND family), so other
    // scenarios accumulate; re-running the same scenario replaces its own. Skipped mid-run.
    if (!this.simulation.running) {
      await this.replay.clearFamily(family ?? 'mixed');
    }
    return simulationStartResponseSchema.parse(
      await this.simulation.start(family as ScenarioFamily | undefined),
    );
  }

  @Post('stop')
  @HttpCode(200)
  async stop(): Promise<{ running: boolean }> {
    return this.simulation.stop();
  }
}
