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

/** Everything both shapes share: the feature order, the class names and the two operating bands. */
export interface ServedCommon {
  features: string[];
  classes: string[];
  riskClass: string;
  reviewThreshold: number;
  blockThreshold: number;
}

/** The temperature-folded linear model. Kept because a rollback should not need a code change. */
export interface LinearServedModel extends ServedCommon {
  kind?: 'binary_risk';
  scalerMean: number[];
  scalerStd: number[];
  coef: number[][];
  intercept: number[];
}

/**
 * The gradient-boosted ensemble. Each tree is an array of nodes, each node six numbers:
 * `[isLeaf, feature, threshold, left, right, value]`, and a row goes left when its value for that
 * feature is `<= threshold`. Summing the leaves reached and dividing by the temperature reproduces
 * the trained model's log-odds exactly.
 */
export interface TreeServedModel extends ServedCommon {
  kind: 'binary_risk_trees';
  baseline: number;
  temperature: number;
  featureMedians: number[];
  trees: number[][][];
}

type ServedModel = LinearServedModel | TreeServedModel;

const isTrees = (model: ServedModel): model is TreeServedModel =>
  model.kind === 'binary_risk_trees';

/**
 * Serves the deployed card-testing risk model in the request path.
 *
 * Two artefact shapes are supported, distinguished by `kind`. The deployed one is a
 * temperature-scaled gradient-boosted ensemble, exported as node arrays this walks directly; the
 * linear model it replaced is still readable, so reverting is a matter of regenerating `model.json`
 * rather than shipping code. Neither needs a native runtime or an ONNX dependency.
 *
 * The ensemble was promoted because the model ladder said to: on the same grouped split and the same
 * cost model it reached PR-AUC 0.991 against the linear model's 0.940 and roughly halved the cost of
 * being wrong, on every one of five re-splits. What the linear model had in exchange was exact
 * per-feature attribution, and that is not lost — see `contributions` below.
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
      this.model === null
        ? 'model artefact absent — scoring degraded'
        : `incident model loaded (${this.model.kind ?? 'binary_risk'})`,
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
    const { risk, contributions } = isTrees(model)
      ? scoreTrees(model, raw)
      : scoreLinear(model, raw);

    // The served bands: below the review threshold the risk is too low to act on, above the block
    // threshold it is containment-eligible, and between them it is a case for a person.
    const band: ModelOpinion['band'] =
      risk >= model.blockThreshold
        ? 'contain_eligible'
        : risk >= model.reviewThreshold
          ? 'review'
          : 'observe';

    const abuse = model.classes.indexOf(model.riskClass);
    const probabilities = model.classes.map((label, c) => ({
      label,
      probability: Number((c === abuse ? risk : 1 - risk).toFixed(4)),
    }));

    return {
      risk: Number(risk.toFixed(4)),
      predictedClass: risk >= model.blockThreshold ? model.riskClass : 'benign',
      band,
      abstained: band === 'review',
      probabilities,
      contributions: contributions
        .map((contribution, i) => ({
          feature: INCIDENT_FEATURE_NAMES[i] ?? model.features[i]!,
          contribution: Number(contribution.toFixed(4)),
        }))
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 6),
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

export interface Scored {
  risk: number;
  /** One contribution per feature, in feature order. */
  contributions: number[];
}

export function scoreLinear(model: LinearServedModel, raw: number[]): Scored {
  const standardised = raw.map((value, i) => (value - model.scalerMean[i]!) / model.scalerStd[i]!);
  const logits = model.classes.map(
    (_, c) =>
      model.intercept[c]! + standardised.reduce((sum, x, i) => sum + x * model.coef[c]![i]!, 0),
  );
  const probabilities = softmax(logits);
  const abuse = model.classes.indexOf(model.riskClass);

  // Coefficient times the standardised value. For a linear model these are exact, not an estimate.
  return {
    risk: probabilities[abuse]!,
    contributions: standardised.map((x, i) => model.coef[abuse]![i]! * x),
  };
}

/**
 * Walks the ensemble, then explains it by ablation.
 *
 * A tree ensemble has no coefficient to read, and the usual substitute — an approximate SHAP value —
 * would put a number in front of an analyst that is not quite the reason the model decided. So each
 * feature is instead held at its training median and the model re-scored: the drop in risk *is* that
 * feature's contribution to this particular decision, exactly, by construction.
 *
 * That costs one walk per feature. At roughly six microseconds a walk it is invisible against a
 * detection path measured in seconds, and it keeps the "why flagged" panel truthful.
 */
export function scoreTrees(model: TreeServedModel, raw: number[]): Scored {
  const risk = treeRisk(model, raw);
  const contributions = raw.map((_, i) => {
    const ablated = [...raw];
    ablated[i] = model.featureMedians[i]!;
    return risk - treeRisk(model, ablated);
  });
  return { risk, contributions };
}

function treeRisk(model: TreeServedModel, x: number[]): number {
  let total = model.baseline;
  for (const tree of model.trees) {
    let at = 0;
    for (;;) {
      const node = tree[at]!;
      // node = [isLeaf, feature, threshold, left, right, value]
      if (node[0] === 1) {
        total += node[5]!;
        break;
      }
      at = x[node[1]!]! <= node[2]! ? node[3]! : node[4]!;
    }
  }
  return 1 / (1 + Math.exp(-total / model.temperature));
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exp = logits.map((z) => Math.exp(z - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / sum);
}
