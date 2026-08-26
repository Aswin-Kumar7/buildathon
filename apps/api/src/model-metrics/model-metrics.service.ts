import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  IncidentModel,
  IncidentModelResponse,
  ModelMetrics,
  ModelMetricsResponse,
} from '@sentinel/contracts';

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

  /**
   * Model B's benchmark, mapped from the incident pipeline's metrics.json. Same graceful-absence
   * behaviour as Model A: a clone where nobody ran `make eval` gets an honest "not generated".
   */
  loadIncident(): IncidentModelResponse {
    const bases = [
      'ml/models/incident/artifacts',
      '../../ml/models/incident/artifacts',
      '../ml/models/incident/artifacts',
    ];
    for (const base of bases) {
      try {
        const metrics = JSON.parse(
          readFileSync(resolve(process.cwd(), `${base}/metrics.json`), 'utf8'),
        );
        const registry = JSON.parse(
          readFileSync(resolve(process.cwd(), `${base}/registry.json`), 'utf8'),
        );
        return { available: true, model: ModelMetricsService.mapIncident(metrics, registry) };
      } catch {
        continue;
      }
    }
    return {
      available: false,
      reason:
        'The incident classifier has not been generated. Run `make eval` in ml/models/incident.',
    };
  }

  private static mapIncident(raw: Record<string, unknown>, registry: unknown): IncidentModel {
    const e = raw.evaluation as Record<string, unknown>;
    const perClass = e.per_class as Record<
      string,
      { precision: number; recall: number; support: number }
    >;
    const h = raw.hardening as Record<string, unknown>;

    return {
      classes: e.classes as string[],
      accuracy: e.accuracy as number,
      macroF1: e.macro_f1 as number,
      abstainRate: e.abstain_rate as number,
      abstainThreshold: e.abstain_threshold as number,
      perClass: Object.entries(perClass).map(([label, m]) => ({
        label,
        precision: m.precision,
        recall: m.recall,
        support: m.support,
      })),
      confusion: e.confusion as number[][],
      riskCoverage: (e.risk_coverage as Record<string, number>[]).map((row) => ({
        threshold: row.threshold,
        coverage: row.coverage,
        selectiveAccuracy: row.selective_accuracy,
      })),
      ablation: (raw.ablation_ladder as Record<string, unknown>[]).map((row) => ({
        features: row.features as string,
        nFeatures: row.n_features as number,
        macroF1: row.macro_f1 as number,
      })),
      hardening: {
        triggered: h.triggered as boolean,
        baseMacroF1: h.base_macro_f1 as number,
        hardenedMacroF1: (h.hardened_macro_f1 as number | undefined) ?? null,
        note: (h.note as string | undefined) ?? null,
      },
      splitGroupOverlap: (raw.split_integrity as Record<string, number>).train_test_group_overlap,
      registry: registry as IncidentModel['registry'],
    } as IncidentModel;
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
        reviewCap: h.review_cap as number,
        falseDeclineRate: h.false_decline_rate as number,
        blockRate: h.block_rate as number,
        reviewRate: h.review_rate as number,
        reviewThreshold: h.review_threshold as number,
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
