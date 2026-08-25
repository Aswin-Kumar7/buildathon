import { Inject, Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { incidents, type DbHandle } from '@sentinel/db';
import {
  computeFeatures,
  computeTraffic,
  type Arbitration,
  type EntityKind,
} from '@sentinel/detect';
import { decide, InvalidPolicy, parsePolicy, type SystemState } from '@sentinel/policy';
import type { SimulationResponse, SimulationRow } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { FeaturesService } from '../features/features.service.js';
import { PolicyService } from '../policy/policy.service.js';

/**
 * What a policy *would* have decided, on incidents that already happened.
 *
 * The question anybody sensible asks before moving a threshold — and the one that is otherwise
 * answered by intuition, deployment and regret. Running the candidate policy against real
 * recorded incidents turns "this feels safer" into "this would have contained four more
 * sessions, here they are".
 *
 * Changes nothing. It does not save the policy, does not touch a containment, and does not
 * write an audit entry: a simulator with a side effect is a deploy with extra steps.
 */
@Injectable()
export class SimulationService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly features: FeaturesService,
    private readonly policy: PolicyService,
  ) {}

  async simulate(source: string, limit = 50): Promise<SimulationResponse> {
    const empty = { considered: 0, changed: 0, newlyContained: 0, newlyReleased: 0 };

    let candidate;
    try {
      candidate = parsePolicy(source);
    } catch (error) {
      // A broken candidate is reported, not thrown. The person is editing a file in a text box;
      // telling them which lines are wrong is the useful answer, and an exception is not it.
      return {
        rows: [],
        summary: empty,
        problems: error instanceof InvalidPolicy ? error.problems : [(error as Error).message],
      };
    }

    const recent = await this.handle.db
      .select()
      .from(incidents)
      .orderBy(desc(incidents.detectedAt))
      .limit(limit);

    const rows: SimulationRow[] = [];
    for (const incident of recent) {
      const arbitration = incident.arbitration as Arbitration | null;
      if (arbitration === null) continue;

      const kind = incident.entityKind as EntityKind;
      const ranked = await this.features.rank(kind, 1, 'all');
      const vector = computeFeatures(
        kind,
        incident.entityKey,
        ranked.observations,
        ranked.asOf,
        undefined,
        true,
      );
      const traffic = computeTraffic(ranked.observations, ranked.asOf);

      // The same system state for both, so the only difference between the two answers is the
      // policy. Comparing against live counters would attribute their drift to the edit.
      //
      // Replayed incidents are judged standing at the moment of their own data, as they are when
      // proposed for real — otherwise every historical row is stale, every answer is "escalate",
      // and the simulator reports that no policy change makes any difference to anything.
      const state: SystemState = {
        now: incident.source === 'replay' ? ranked.asOf : ranked.generatedAt,
        featuresAsOf: ranked.asOf,
        activeContainments: 0,
        containmentsInLastHour: 0,
      };

      const current = decide({ arbitration, vector, traffic, state, policy: this.policy.policy });
      const proposed = decide({ arbitration, vector, traffic, state, policy: candidate });

      rows.push({
        incidentId: incident.id,
        entityKind: kind,
        entityKey: incident.entityKey,
        detectedAt: incident.detectedAt.getTime(),
        current,
        proposed,
        changed: current.action !== proposed.action,
      });
    }

    return {
      rows,
      summary: {
        considered: rows.length,
        changed: rows.filter((row) => row.changed).length,
        // The number worth being nervous about, called out on its own rather than folded into
        // "changed": more containment is the direction that costs somebody their checkout.
        newlyContained: rows.filter(
          (row) => row.proposed.action === 'contain' && row.current.action !== 'contain',
        ).length,
        newlyReleased: rows.filter(
          (row) => row.current.action === 'contain' && row.proposed.action !== 'contain',
        ).length,
      },
      problems: [],
    };
  }
}
