import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  incidentFeatures,
  INCIDENT_FEATURE_NAMES,
  type FeatureVector,
  type TrafficContext,
} from '@sentinel/detect';
import type { ModelOpinion, ModelRegistry } from '@sentinel/contracts';

interface ServedModel {
  features: string[];
  classes: string[];
  riskClass: string;
  reviewThreshold: number;
  blockThreshold: number;
  scalerMean: number[];
  scalerStd: number[];
  coef: number[][];
  intercept: number[];
}

/**
 * Serves the deployed card-testing risk model in the request path, as the linear map it is.
 *
 * The model is a temperature-scaled binary logistic, exported to `model.json` as a scaler, a weight
 * matrix with the benign logit pinned to zero, and the two operating thresholds. Scoring it is a few
 * dot products and a softmax whose second class is P(abuse) — no native runtime, no ONNX dependency —
 * and the per-feature contributions it returns are exact for a linear model, which is what makes the
 * "why flagged" panel truthful rather than a plausible-looking approximation.
 *
 * When the artefact is absent — a clone where nobody ran `make eval` — this reports unavailable and
 * the system runs on rules and arbitration alone, marked `degraded:model`. The model informs the
 * decision and can move it on a short leash; it was never allowed to *be* the decision, so losing it
 * degrades the explanation, not the safety of what is done.
 */
@Injectable()
export class ModelScoringService {
  private readonly logger = new Logger(ModelScoringService.name);
  private readonly model: ServedModel | null;
  private readonly registry: ModelRegistry | null;

  private static readonly BASE = 'ml/models/incident/artifacts';

  constructor() {
    this.model = this.read<ServedModel>('model.json');
    this.registry = this.read<ModelRegistry>('registry.json');
    this.logger.log(
      this.model === null ? 'model artefact absent — scoring degraded' : 'incident model loaded',
    );
  }

  get available(): boolean {
    return this.model !== null;
  }

  registryEntry(): ModelRegistry | null {
    return this.registry;
  }

  /**
   * Scores one entity, or returns null when the model is unavailable (the degraded path).
   *
   * The caller has already confirmed the exact counts — a sketch estimate never reaches the model —
   * so the features here rest on numbers a decision is allowed to use.
   */
  score(vector: FeatureVector, traffic: TrafficContext): ModelOpinion | null {
    const model = this.model;
    if (model === null) return null;

    const raw = incidentFeatures(vector, traffic);
    const standardised = raw.map(
      (value, i) => (value - model.scalerMean[i]!) / model.scalerStd[i]!,
    );

    const logits = model.classes.map(
      (_, c) =>
        model.intercept[c]! + standardised.reduce((sum, x, i) => sum + x * model.coef[c]![i]!, 0),
    );
    const probabilities = softmax(logits);

    // The risk score is P(abuse) — the second class, by construction of the exported weights.
    const abuse = model.classes.indexOf(model.riskClass);
    const risk = probabilities[abuse]!;

    // The served bands: below the review threshold the risk is too low to act on, above the block
    // threshold it is containment-eligible, and between them it is a case for a person.
    const band: ModelOpinion['band'] =
      risk >= model.blockThreshold
        ? 'contain_eligible'
        : risk >= model.reviewThreshold
          ? 'review'
          : 'observe';

    // Contributions toward the abuse class: coefficient times the standardised value. For a linear
    // model these are exact SHAP values, not an approximation of them.
    const contributions = standardised
      .map((x, i) => ({
        feature: INCIDENT_FEATURE_NAMES[i] ?? model.features[i]!,
        contribution: Number((model.coef[abuse]![i]! * x).toFixed(4)),
      }))
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 6);

    return {
      risk: Number(risk.toFixed(4)),
      predictedClass: risk >= model.blockThreshold ? model.riskClass : 'benign',
      band,
      abstained: band === 'review',
      probabilities: model.classes.map((label, c) => ({
        label,
        probability: Number(probabilities[c]!.toFixed(4)),
      })),
      contributions,
      modelVersion: this.registry?.version ?? 'unknown',
    };
  }

  private read<T>(file: string): T | null {
    for (const prefix of ['', '../../', '../']) {
      try {
        const path = resolve(process.cwd(), `${prefix}${ModelScoringService.BASE}/${file}`);
        return JSON.parse(readFileSync(path, 'utf8')) as T;
      } catch {
        continue;
      }
    }
    return null;
  }
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exp = logits.map((z) => Math.exp(z - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / sum);
}
