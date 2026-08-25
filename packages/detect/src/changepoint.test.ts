import { describe, expect, it } from 'vitest';
import { bucketize, detectChange, DEFAULT_CHANGE_OPTIONS } from './changepoint.js';
import { generate, seeded } from '@sentinel/corpus';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');
const MINUTE = 60_000;

/** A quiet baseline of roughly `rate` per bucket, then `after` buckets at `raised`. */
function series(quietBuckets: number, rate: number, after: number, raised: number): number[] {
  const random = seeded(4242);
  const out: number[] = [];
  for (let i = 0; i < quietBuckets; i += 1) out.push(Math.round(rate + (random() - 0.5)));
  for (let i = 0; i < after; i += 1) out.push(Math.round(raised + (random() - 0.5)));
  return out;
}

describe('bucketize', () => {
  it('keeps the empty minutes', () => {
    // A detector handed only the busy buckets never learns what quiet looks like, and would
    // read a burst with gaps in it as continuous traffic.
    const stamps = [T0, T0 + 1000, T0 + 3 * MINUTE];
    expect(bucketize(stamps, T0, T0 + 5 * MINUTE)).toEqual([2, 0, 0, 1, 0]);
  });

  it('drops anything outside the range rather than folding it into an edge bucket', () => {
    expect(bucketize([T0 - 1, T0 + 5 * MINUTE], T0, T0 + 5 * MINUTE)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('change detection', () => {
  it('learns the baseline from the warm-up and judges only what follows', () => {
    const result = detectChange(series(35, 2, 25, 2));

    expect(result.baseline.buckets).toBe(30);
    expect(result.baseline.mean).toBeCloseTo(2, 0);
    // Nothing changed, so nothing should fire. A detector that alarms on its own baseline is
    // worse than none.
    expect(result.ewma.fired).toBe(false);
    expect(result.cusum.fired).toBe(false);
  });

  it('catches a loud burst quickly', () => {
    const result = detectChange(series(35, 2, 25, 20));

    expect(result.ewma.fired).toBe(true);
    expect(result.ewma.at).toBeLessThan(38);
    expect(result.ewma.statistic).toBeGreaterThan(result.ewma.limit);
  });

  it('catches a shift too small for any fixed threshold', () => {
    // The case this tier exists for. Four attempts a minute against a baseline of two would
    // not trip a velocity rule set anywhere sensible, and it is not supposed to — but it is
    // still a doubling that persists, and CUSUM accumulates it until it cannot be noise.
    const quiet = series(35, 2, 0, 0);
    const creeping = [...quiet, ...Array.from({ length: 25 }, () => 4)];

    const result = detectChange(creeping);
    expect(result.cusum.fired).toBe(true);
    expect(result.cusum.buckets).toBeGreaterThan(1);
    expect(result.cusum.statistic).toBeGreaterThan(result.cusum.limit);
  });

  it('says how long the deviation had been accumulating', () => {
    // "Cumulative deviation exceeded the limit after N buckets" is the explanation. Without
    // the count it is a number nobody can argue with.
    const result = detectChange([...series(35, 2, 0, 0), ...Array.from({ length: 30 }, () => 5)]);

    expect(result.cusum.fired).toBe(true);
    expect(result.cusum.at).not.toBeNull();
    expect(result.cusum.buckets).toBeGreaterThanOrEqual(1);
    expect(result.cusum.buckets).toBeLessThanOrEqual(result.cusum.at! + 1);
  });

  it('ignores traffic falling away', () => {
    // One-sided on purpose. A merchant whose volume drops has a problem, but not this one, and
    // an alarm here would be a detector inventing work.
    const result = detectChange([...series(35, 8, 0, 0), ...Array.from({ length: 20 }, () => 0)]);

    expect(result.ewma.fired).toBe(false);
    expect(result.cusum.fired).toBe(false);
  });

  it('survives a flat warm-up without treating one event as infinite', () => {
    // Twenty silent minutes give a standard deviation of zero. Dividing by it would make the
    // first attempt of the day an alarm, every day.
    const result = detectChange([...Array.from({ length: 30 }, () => 0), 1, 0, 0, 1]);

    expect(Number.isFinite(result.cusum.limit)).toBe(true);
    expect(result.baseline.deviation).toBeGreaterThan(0);
    expect(result.cusum.fired).toBe(false);
  });

  it('does nothing at all with less history than a warm-up', () => {
    const result = detectChange([5, 5, 5]);

    expect(result.baseline.buckets).toBe(3);
    expect(result.baseline.mean).toBe(5);
    expect(result.ewma.fired).toBe(false);
    expect(result.cusum.fired).toBe(false);
  });

  it('stays inside its false-alarm budget on stationary traffic', () => {
    // The number that decides whether anyone reads the queue. With the textbook parameters it
    // sat at 35%, which is what forced the sweep behind DEFAULT_CHANGE_OPTIONS. Asserted at
    // zero because that is what was measured — anything above it is a regression worth
    // arguing about rather than absorbing.
    let alarms = 0;
    const runs = 500;

    for (let run = 0; run < runs; run += 1) {
      const random = seeded(run + 1);
      const stationary = Array.from({ length: 90 }, () => Math.round(3 + (random() - 0.5) * 3));
      const result = detectChange(stationary);
      if (result.ewma.fired || result.cusum.fired) alarms += 1;
    }

    expect(alarms).toBe(0);
  });

  it('catches every sustained shift above its stated floor', () => {
    // The other half of the same trade, so neither can be improved silently at the other's
    // expense. Against a baseline of two a minute, a sustained three is the floor — and the
    // point of recording it is that below three this method has nothing honest to say.
    let caught = 0;
    const runs = 200;

    for (let run = 0; run < runs; run += 1) {
      const random = seeded(run + 5000);
      const shifted = [
        ...Array.from({ length: 35 }, () => Math.round(2 + (random() - 0.5))),
        ...Array.from({ length: 30 }, () => 3),
      ];
      const result = detectChange(shifted);
      if (result.ewma.fired || result.cusum.fired) caught += 1;
    }

    expect(caught).toBe(runs);
  });

  it('gives the same answer twice', () => {
    const input = series(35, 2, 25, 9);
    expect(JSON.stringify(detectChange(input))).toBe(
      JSON.stringify(detectChange(input, DEFAULT_CHANGE_OPTIONS)),
    );
  });
});

describe('against the corpus, not against tidy noise', () => {
  /**
   * The false-positive count the slice asks to be recorded, measured on the traffic this has
   * to live with rather than on a well-behaved series.
   *
   * This is what caught the parameters out. At `controlLimit` 4.5 the synthetic false-alarm
   * rate was a comfortable 0.55% and `normal_traffic` still alarmed — real traffic arrives in
   * clumps, and a detector tuned on something smoother is tuned on the wrong distribution.
   */
  function minuteSeries(family: Parameters<typeof generate>[0]): number[] {
    const stamps = generate(family)
      .events.flatMap((event) => {
        const body = event.body as {
          created_at: number;
          payload?: { payment?: { entity?: unknown } };
        };
        return body.payload?.payment?.entity === undefined ? [] : [body.created_at * 1000];
      })
      .sort((a, b) => a - b);

    return bucketize(stamps, stamps[0]!, stamps[stamps.length - 1]! + 60_000);
  }

  const benign = ['normal_traffic', 'flash_sale', 'retry_storm', 'customer_error'] as const;

  for (const family of benign) {
    it(`raises nothing on ${family}`, () => {
      const result = detectChange(minuteSeries(family));

      expect(result.ewma.fired, `${family} ewma`).toBe(false);
      expect(result.cusum.fired, `${family} cusum`).toBe(false);
    });
  }

  it('raises nothing on an outage either', () => {
    // An acquirer falling over does change the failure rate, and it is still not this
    // detector's business: containing anyone during an outage punishes customers for it.
    const result = detectChange(minuteSeries('gateway_outage'));

    expect(result.ewma.fired).toBe(false);
    expect(result.cusum.fired).toBe(false);
  });

  it('catches a loud attack that follows ordinary traffic', () => {
    const combined = [...minuteSeries('normal_traffic'), ...minuteSeries('attack_loud')];
    const result = detectChange(combined);

    expect(result.ewma.fired || result.cusum.fired).toBe(true);
  });

  it('records that it does not catch the distributed attack', () => {
    // Not a gap left unnoticed — a trade taken deliberately and pinned here so it cannot be
    // reversed by accident. A setting sensitive enough to catch this also alarms on
    // `normal_traffic`, and a false positive on legitimate traffic is the expensive mistake.
    // If this ever starts passing, the false-alarm tests above are what to check first.
    const combined = [...minuteSeries('normal_traffic'), ...minuteSeries('attack_distributed')];
    const result = detectChange(combined);

    expect(result.ewma.fired).toBe(false);
    expect(result.cusum.fired).toBe(false);
  });
});
