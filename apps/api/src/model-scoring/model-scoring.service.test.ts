import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  scoreLinear,
  scoreTrees,
  type LinearServedModel,
  type TreeServedModel,
} from './model-scoring.service.js';

/**
 * The two artefact shapes the request path can serve, tested where they are pure.
 *
 * The integration test proves an incident gets a risk opinion end to end. What it cannot show is
 * whether the *explanation* beside that number means anything, because both a correct attribution and
 * a broken one produce a plausible-looking list. These check the properties that make the "why
 * flagged" panel truthful rather than decorative.
 */

/**
 * A two-tree ensemble small enough to reason about by hand.
 *
 * Tree A splits on feature 0 at 5: below, it subtracts 1; above, it adds 2.
 * Tree B splits on feature 1 at 10: below, it subtracts 0.5; above, it adds 1.
 * Feature 2 is never read by any split, so it is the control — nothing about it can matter.
 *
 * The medians are chosen to sit on the far side of each split from the values used below, so that
 * ablating a feature actually crosses its threshold. A median on the same side would produce a zero
 * contribution — correctly, but it would test nothing.
 */
const ENSEMBLE: TreeServedModel = {
  kind: 'binary_risk_trees',
  features: ['f0', 'f1', 'f2'],
  classes: ['benign', 'abuse'],
  riskClass: 'abuse',
  reviewThreshold: 0.2,
  blockThreshold: 0.6,
  baseline: 0,
  temperature: 1,
  featureMedians: [5, 50, 99],
  trees: [
    [
      [0, 0, 5, 1, 2, 0],
      [1, -1, 0, -1, -1, -1],
      [1, -1, 0, -1, -1, 2],
    ],
    [
      [0, 1, 10, 1, 2, 0],
      [1, -1, 0, -1, -1, -0.5],
      [1, -1, 0, -1, -1, 1],
    ],
  ],
};

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

describe('tree scoring', () => {
  it('walks to the leaves the thresholds select', () => {
    // f0 = 9 > 5 takes the right leaf (+2); f1 = 3 <= 10 takes the left leaf (-0.5).
    expect(scoreTrees(ENSEMBLE, [9, 3, 0]).risk).toBeCloseTo(sigmoid(1.5), 12);
    // Both low: -1 and -0.5.
    expect(scoreTrees(ENSEMBLE, [1, 1, 0]).risk).toBeCloseTo(sigmoid(-1.5), 12);
    // Both high: +2 and +1.
    expect(scoreTrees(ENSEMBLE, [9, 99, 0]).risk).toBeCloseTo(sigmoid(3), 12);
  });

  it('sends a value exactly on a threshold left, matching the trainer', () => {
    // The exported comparison is `<=`. Getting this backwards would shift a boundary case silently,
    // and a boundary case is exactly where a contested decision lives.
    expect(scoreTrees(ENSEMBLE, [5, 1, 0]).risk).toBeCloseTo(sigmoid(-1.5), 12);
  });

  it('divides by the temperature the calibration fitted', () => {
    const warmer: TreeServedModel = { ...ENSEMBLE, temperature: 2 };
    expect(scoreTrees(warmer, [9, 99, 0]).risk).toBeCloseTo(sigmoid(3 / 2), 12);
  });

  describe('attribution by ablation', () => {
    it('gives a feature already at its median exactly no contribution', () => {
      // Holding a feature at the value it already has cannot change the score, so its contribution
      // must be zero — not merely small. A non-zero result here would mean the ablation is reading
      // the wrong index.
      const { contributions } = scoreTrees(ENSEMBLE, [5, 50, 0]);
      expect(contributions[0]).toBe(0);
      expect(contributions[1]).toBe(0);
    });

    it('attributes nothing to a feature no split reads', () => {
      const { contributions } = scoreTrees(ENSEMBLE, [9, 3, 12345]);
      expect(contributions[2]).toBe(0);
    });

    it('signs a contribution by which way it moved the risk', () => {
      // f0 = 9 is above its median of 5, and being above raises the score, so replacing it with
      // the median lowers the risk — a positive contribution. f1 = 3 is below its median of 50 and
      // lowers the score, so replacing it raises the risk — a negative contribution.
      const { contributions } = scoreTrees(ENSEMBLE, [9, 3, 0]);
      expect(contributions[0]).toBeGreaterThan(0);
      expect(contributions[1]).toBeLessThan(0);
    });

    it('returns one contribution per feature, in feature order', () => {
      expect(scoreTrees(ENSEMBLE, [9, 3, 0]).contributions).toHaveLength(ENSEMBLE.features.length);
    });
  });
});

describe('linear scoring', () => {
  const LINEAR: LinearServedModel = {
    kind: 'binary_risk',
    features: ['f0', 'f1'],
    classes: ['benign', 'abuse'],
    riskClass: 'abuse',
    reviewThreshold: 0.2,
    blockThreshold: 0.6,
    scalerMean: [0, 0],
    scalerStd: [1, 1],
    coef: [
      [0, 0],
      [2, -1],
    ],
    intercept: [0, 0],
  };

  it('still serves the shape it replaced, so a rollback needs no code change', () => {
    const { risk, contributions } = scoreLinear(LINEAR, [1, 1]);
    expect(risk).toBeCloseTo(sigmoid(1), 12);
    expect(contributions).toEqual([2, -1]);
  });
});

describe('the committed artefact', () => {
  it('is the tree ensemble the model card describes', () => {
    const path = resolve(process.cwd(), '../../ml/models/incident/artifacts/model.json');
    const served = JSON.parse(readFileSync(path, 'utf8')) as TreeServedModel;

    expect(served.kind).toBe('binary_risk_trees');
    expect(served.featureMedians).toHaveLength(served.features.length);
    expect(served.trees.length).toBeGreaterThan(0);
    expect(served.temperature).toBeGreaterThan(0);
    expect(served.reviewThreshold).toBeLessThanOrEqual(served.blockThreshold);
  });
});
