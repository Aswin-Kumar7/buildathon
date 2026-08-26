import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RiskModelMetrics, RiskModelMetricsResponse } from '@sentinel/contracts';

/**
 * Serves the deployed card-testing risk model's honest evaluation — the artefact `make eval`
 * generates in `ml/models/incident`.
 *
 * The JS server does not train anything: it reads `metrics.json` and `registry.json`, the
 * deterministic output of the Python pipeline, and maps their snake_case keys to the camelCase the
 * contract speaks. The number it returns is the *deployed* model's, on a held-out grouped split of
 * the synthetic corpus — the same model the request path scores with, so the metrics the reader sees
 * describe the model the merchant actually runs. If the file is absent (a clone where nobody ran the
 * pipeline) it says so plainly rather than rendering zeros that would read as a model with no skill.
 */
@Injectable()
export class ModelMetricsService {
  private readonly logger = new Logger(ModelMetricsService.name);

  private readonly bases = [
    'ml/models/incident/artifacts',
    '../../ml/models/incident/artifacts',
    '../ml/models/incident/artifacts',
  ];

  load(): RiskModelMetricsResponse {
    for (const base of this.bases) {
      try {
        const metrics = JSON.parse(
          readFileSync(resolve(process.cwd(), `${base}/metrics.json`), 'utf8'),
        );
        const registry = JSON.parse(
          readFileSync(resolve(process.cwd(), `${base}/registry.json`), 'utf8'),
        );
        return { available: true, model: ModelMetricsService.map(metrics, registry) };
      } catch {
        continue;
      }
    }

    return {
      available: false,
      reason:
        'The risk model has not been generated. Run `make eval` in ml/models/incident to produce it.',
    };
  }

  private static map(raw: Record<string, unknown>, registry: unknown): RiskModelMetrics {
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
        nGroups: p.n_groups as number,
        positiveRate: p.positive_rate as number,
      },
      honest: {
        model: h.model as string,
        reviewCap: h.review_cap as number,
        nTest: h.n_test as number,
        positives: h.positives as number,
        threshold: h.threshold as number,
        precision: interval(h.precision as Record<string, number>),
        recall: interval(h.recall as Record<string, number>),
        f1: interval(h.f1 as Record<string, number>),
        prAuc: interval(h.pr_auc as Record<string, number>),
        rocAuc: h.roc_auc as number,
        brier: h.brier as number,
        falseDeclineRate: h.false_decline_rate as number,
        blockRate: h.block_rate as number,
        reviewRate: h.review_rate as number,
        reviewThreshold: h.review_threshold as number,
        reliability: h.reliability as { predicted: number; observed: number }[],
        perOrigin: (h.per_origin as Record<string, unknown>[]).map((row) => ({
          origin: row.origin as string,
          n: row.n as number,
          positive: row.positive as boolean,
          recall: (row.recall as number | null) ?? null,
          falsePositiveRate: (row.false_positive_rate as number | null) ?? null,
          meanRisk: row.mean_risk as number,
        })),
      },
      baselineNoSkill: { prAuc: (raw.baseline_no_skill as Record<string, number>).pr_auc },
      leakage: {
        honestPrAuc: l.honest_pr_auc,
        naivePrAuc: l.naive_pr_auc,
        delta: l.delta,
        honestGroupOverlap: l.honest_group_overlap,
        naiveGroupOverlap: l.naive_group_overlap,
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
      ablation: (raw.ablation_ladder as Record<string, unknown>[]).map((row) => ({
        features: row.features as string,
        nFeatures: row.n_features as number,
        prAuc: row.pr_auc as number,
      })),
      errorTaxonomy: (raw.error_taxonomy as Record<string, unknown>[]).map((row) => ({
        amountBand: row.amount_band as string,
        n: row.n as number,
        falsePositive: row.false_positive as number,
        falseNegative: row.false_negative as number,
      })),
      registry: registry as RiskModelMetrics['registry'],
    } as RiskModelMetrics;
  }
}
