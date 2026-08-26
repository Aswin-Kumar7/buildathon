import { describe, expect, it } from 'vitest';
import {
  isExpired,
  isSheddable,
  LatencyWindow,
  queueCap,
  remainingMs,
  Shedder,
  tierOf,
  type LoadSignals,
} from './index.js';

describe('criticality taxonomy', () => {
  it('maps ingestion to the tier that is never shed, and narration to the one shed freely', () => {
    expect(tierOf('webhook_ingestion')).toBe('CRITICAL_PLUS');
    expect(tierOf('model_scoring')).toBe('SHEDDABLE_PLUS');
    expect(tierOf('narration')).toBe('SHEDDABLE');
    expect(isSheddable('CRITICAL_PLUS')).toBe(false);
    expect(isSheddable('CRITICAL')).toBe(false);
    expect(isSheddable('SHEDDABLE_PLUS')).toBe(true);
  });
});

describe('LatencyWindow', () => {
  it('reports the tail rather than the average', () => {
    const window = new LatencyWindow(1000);
    // 990 fast requests and 10 slow ones: the mean stays low while p99 sees the slow tail.
    for (let i = 0; i < 990; i += 1) window.record(5);
    for (let i = 0; i < 10; i += 1) window.record(500);

    const p = window.snapshot();
    expect(p.p50).toBe(5);
    expect(p.p99).toBeGreaterThanOrEqual(5);
    expect(p.max).toBe(500);
    expect(p.count).toBe(1000);
  });

  it('is fixed-memory: old samples age out of the window', () => {
    const window = new LatencyWindow(100);
    for (let i = 0; i < 100; i += 1) window.record(1000); // fill with slow
    for (let i = 0; i < 100; i += 1) window.record(1); // overwrite with fast
    expect(window.snapshot().p99).toBe(1);
    expect(window.samples).toBe(100);
  });
});

describe('Shedder', () => {
  const base: LoadSignals = { p99Ms: 100, sloMs: 500, inFlight: 1, queueDepth: 0, poolSize: 8 };

  it('never sheds the critical tiers, whatever the pressure', () => {
    const shedder = new Shedder();
    const crushed: LoadSignals = { ...base, p99Ms: 10_000, queueDepth: 1000 };
    expect(shedder.decide('CRITICAL_PLUS', crushed).shed).toBe(false);
    expect(shedder.decide('CRITICAL', crushed).shed).toBe(false);
  });

  it('sheds narration first, at the first breach of the tail', () => {
    const shedder = new Shedder();
    const mildBreach: LoadSignals = { ...base, p99Ms: 600 }; // just over the 500 SLO
    expect(shedder.decide('SHEDDABLE', mildBreach).shed).toBe(true);
    // The heavier tier holds until the breach is bad — a small breach must not cost a decision evidence.
    expect(shedder.decide('SHEDDABLE_PLUS', mildBreach).shed).toBe(false);
  });

  it('sheds enrichment only once the tail is badly breached', () => {
    const shedder = new Shedder();
    const badBreach: LoadSignals = { ...base, p99Ms: 900 }; // > 1.5x the SLO
    expect(shedder.decide('SHEDDABLE_PLUS', badBreach).shed).toBe(true);
    expect(shedder.decide('SHEDDABLE_PLUS', badBreach).reason).toBe('p99-breach');
  });

  it('sheds on queue depth past the cap even when the tail looks fine', () => {
    const shedder = new Shedder();
    expect(queueCap(8)).toBe(4);
    const backed: LoadSignals = { ...base, queueDepth: 5, poolSize: 8 };
    expect(shedder.decide('SHEDDABLE', backed).reason).toBe('queue-cap');
    expect(shedder.decide('SHEDDABLE_PLUS', backed).reason).toBe('queue-cap');
  });

  it('reports which tiers are shedding, in criticality order', () => {
    const shedder = new Shedder();
    const badBreach: LoadSignals = { ...base, p99Ms: 900 };
    expect(shedder.shedding(badBreach)).toEqual(['SHEDDABLE_PLUS', 'SHEDDABLE']);
  });
});

describe('deadlines', () => {
  it('expires once the absolute instant has passed', () => {
    let now = 0;
    const clock = () => now;
    const deadline = 100;
    expect(isExpired(deadline, clock)).toBe(false);
    expect(remainingMs(deadline, clock)).toBe(100);
    now = 150;
    expect(isExpired(deadline, clock)).toBe(true);
    expect(remainingMs(deadline, clock)).toBe(0);
  });
});
