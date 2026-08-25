import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModelMetrics, ModelMetricsResponse } from '@sentinel/contracts';

/**
 * Serves the model benchmark artefact the Python pipeline generates.
 *
 * The JS server does not train anything — it reads `metrics.json`, the deterministic output of
 * `make eval`, and maps its snake_case keys to the camelCase the contract speaks. If the file is
 * absent (a clone where nobody ran the pipeline) it says so, rather than rendering zeros that would
 * read as a model with no skill. Read fresh each request so a regenerated artefact shows up without
 * a restart.
 */
@Injectable()
export class ModelMetricsService {
  private readonly logger = new Logger(ModelMetricsService.name);

  private readonly candidates = [
    'ml/models/transaction_risk/artifacts/metrics.json',
    '../../ml/models/transaction_risk/artifacts/metrics.json',
    '../ml/models/transaction_risk/artifacts/metrics.json',
  ];

  load(): ModelMetricsResponse {
    for (const candidate of this.candidates) {
      try {
        const raw = readFileSync(resolve(process.cwd(), candidate), 'utf8');
        return { available: true, metrics: ModelMetricsService.map(JSON.parse(raw)) };
      } catch {
        continue;
      }
    }

    return {
      available: false,
      reason:
        'The model benchmark has not been generated. Run `make eval` in ' +
        'ml/models/transaction_risk to produce it.',
    };
  }

  private static map(raw: Record<string, unknown>): ModelMetrics {
    const interval = (i: Record<string, number>) => ({ point: i.point, low: i.low, high: i.high });
    const p = raw.provenance as Record<string, unknown>;
    const h = raw.honest as Record<string, unknown>;
    const l = raw.leakage as Record<string, number>;
    const c = raw.cost as Record<string, number>;

    return {
      provenance: {
        dataSource: p.data_source as string,
        modelBackend: p.model_backend as string,
        dataNote: p.data_note as string,
        seed: p.seed as number,
        nRows: p.n_rows as number,
        nUids: p.n_uids as number,
        fraudRate: p.fraud_rate as number,
      },
      honest: {
        model: h.model as string,
        threshold: h.threshold as number,
        nTest: h.n_test as number,
        positives: h.positives as number,
        precision: interval(h.precision as Record<string, number>),
        recall: interval(h.recall as Record<string, number>),
        prAuc: interval(h.pr_auc as Record<string, number>),
        rocAuc: h.roc_auc as number,
        brier: h.brier as number,
        reliability: h.reliability as { predicted: number; observed: number }[],
      },
      baselineLogisticPrAuc: (raw.baseline_logistic as Record<string, number>).pr_auc,
      leakage: {
        honestPrAuc: l.honest_pr_auc,
        naivePrAuc: l.naive_pr_auc,
        delta: l.delta,
        honestUidOverlap: l.honest_uid_overlap,
        naiveUidOverlap: l.naive_uid_overlap,
        droppedToGap: l.dropped_to_gap,
      },
      cost: {
        falseNegativePaise: c.false_negative_paise,
        falsePositivePaise: c.false_positive_paise,
      },
      featureImportance: raw.feature_importance as { feature: string; importance: number }[],
      learningCurve: (raw.learning_curve as Record<string, number>[]).map((row) => ({
        trainFraction: row.train_fraction,
        nTrain: row.n_train,
        valPrAuc: row.val_pr_auc,
      })),
      errorTaxonomy: (raw.error_taxonomy as Record<string, unknown>[]).map((row) => ({
        amountBand: row.amount_band as string,
        n: row.n as number,
        falsePositive: row.false_positive as number,
        falseNegative: row.false_negative as number,
      })),
      // Asserted, then re-validated: the controller parses this through the contract on the way
      // out, so a genuinely malformed artefact fails there loudly rather than rendering wrong.
    } as ModelMetrics;
  }
}
