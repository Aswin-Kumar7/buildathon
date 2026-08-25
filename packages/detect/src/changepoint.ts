/**
 * Tier 2: statistical change detection over a per-minute series.
 *
 * Tier 1 asks "is this rate above a number". That question has a floor it cannot get under: an
 * attacker who stays below the threshold is invisible to it forever, and Visa has documented
 * enumeration evolving in exactly that direction — spread thin enough that any single merchant
 * sees only a trickle. This tier asks a different question, "has this changed", which does not
 * have that floor.
 *
 * **EWMA** for the loud case: a weighted average that reacts within a few buckets and is
 * compared against its own control limit.
 *
 * **CUSUM** for the quiet one, and it is the reason this file exists. It accumulates the
 * amount by which each bucket exceeds what was normal, so a shift too small to trip any
 * threshold still adds up until it cannot be explained by noise. It answers with the thing a
 * person actually wants to know: how far past normal, and after how many events.
 *
 * Neither is trained, both are pure, and both produce an explanation rather than a verdict.
 *
 * **The limit, stated rather than papered over.** This sees one merchant. An attacker
 * distributing across hundreds of them is visible from the platform and invisible from here,
 * and no amount of statistics fixes an observation that was never made. CUSUM raises our floor
 * within one merchant; that is the honest extent of the claim.
 */

/** How the baseline was established, and how much of the series it consumed. */
export interface Baseline {
  mean: number;
  /** Standard deviation, floored so a perfectly flat warm-up cannot make every bucket infinite. */
  deviation: number;
  buckets: number;
}

export interface ChangeOptions {
  /** Buckets used to learn what normal is. The detectors only judge what comes after. */
  warmUpBuckets: number;
  /** EWMA smoothing. Lower reacts more slowly and is less twitchy. */
  lambda: number;
  /** EWMA control limit, in standard deviations. */
  controlLimit: number;
  /** CUSUM slack, in standard deviations: the shift considered not worth accumulating. */
  slack: number;
  /** CUSUM decision interval, in standard deviations. */
  decisionInterval: number;
}

/**
 * Chosen by measurement, not by taste, and against real traffic rather than tidy noise.
 *
 * The textbook pairing — `slack` 0.5, `decisionInterval` 4 — has an average run length under no
 * change of roughly 170 samples, which over an hour of minute buckets is a false alarm on about
 * a third of quiet entities. A queue that is mostly noise is a queue nobody opens.
 *
 * Tuning against synthetic noise then turned out not to be enough. At `controlLimit` 4.5 the
 * false-alarm rate on a well-behaved stationary series was 0.55%, and the same settings alarmed
 * on the corpus's own `normal_traffic` — real traffic is bursty in a way a tidy series is not,
 * and a detector calibrated on the tidy one is calibrated on the wrong thing.
 *
 * What these values were measured to do, over 500 stationary series and all five benign
 * scenario families:
 *
 * | | false alarms | catches |
 * |---|---|---|
 * | EWMA | 0% synthetic, 0 of 5 benign families | a sustained doubling, every time |
 * | CUSUM | 0% synthetic, 0 of 5 benign families | a sustained 1.5×, every time |
 *
 * **What this deliberately does not catch, and what catching it would cost.** The corpus's
 * `attack_distributed` rotates session, device and network — 37 sessions, 37 devices, 29
 * networks — so no single entity looks remarkable and Tier 1 scores every one of them at 0.35,
 * below the floor. Tier 2 over the merchant-wide series is the natural answer, and it does work:
 * at `controlLimit` 4.5 / `decisionInterval` 8 both detectors fire on it. But that setting also
 * fires on `normal_traffic`. Measured, the choice is between catching that attack and never
 * alarming on ordinary traffic, and this project takes false positives on legitimate traffic to
 * be the expensive mistake — a merchant stopped from collecting, a customer punished for an
 * outage. So the distributed case stays uncaught here and is stated rather than hidden. It is
 * the same blindness the architecture plan describes for cross-merchant distribution, arriving
 * one level earlier than expected.
 */
export const DEFAULT_CHANGE_OPTIONS: ChangeOptions = {
  warmUpBuckets: 30,
  lambda: 0.2,
  controlLimit: 6,
  slack: 1.5,
  decisionInterval: 12,
};

export interface ChangeAlarm {
  fired: boolean;
  /** Index into the series where it first fired, or null. */
  at: number | null;
  /** How far past the limit, in the detector's own units. */
  statistic: number;
  limit: number;
  /** Buckets the statistic had been accumulating when it fired. Empty for EWMA. */
  buckets: number;
}

export interface ChangeResult {
  baseline: Baseline;
  ewma: ChangeAlarm;
  cusum: ChangeAlarm;
}

/**
 * A floor on the deviation.
 *
 * A silent warm-up gives a standard deviation of zero, and dividing by that makes the first
 * single attempt an infinitely significant event. Half a bucket is the smallest difference the
 * series can express, so it is the smallest deviation worth pretending to.
 */
const MINIMUM_DEVIATION = 0.5;

function baselineOf(series: readonly number[], buckets: number): Baseline {
  const warmUp = series.slice(0, buckets);
  if (warmUp.length === 0) return { mean: 0, deviation: MINIMUM_DEVIATION, buckets: 0 };

  const mean = warmUp.reduce((sum, value) => sum + value, 0) / warmUp.length;
  // Sample variance, over n-1. The population form underestimates the spread on a short
  // warm-up, and every limit below is a multiple of it — so it would tighten exactly the
  // thing that decides how often this alarms at nothing.
  const variance =
    warmUp.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(warmUp.length - 1, 1);

  return {
    mean,
    deviation: Math.max(Math.sqrt(variance), MINIMUM_DEVIATION),
    buckets: warmUp.length,
  };
}

const quiet = (limit: number): ChangeAlarm => ({
  fired: false,
  at: null,
  statistic: 0,
  limit,
  buckets: 0,
});

/**
 * Runs both detectors over a series of per-bucket counts.
 *
 * The series is bucket counts rather than raw timestamps because that is what a tile is, which
 * means this runs over aggregated history exactly as it would run online.
 */
export function detectChange(
  series: readonly number[],
  options: ChangeOptions = DEFAULT_CHANGE_OPTIONS,
): ChangeResult {
  const baseline = baselineOf(series, options.warmUpBuckets);
  const { mean, deviation } = baseline;

  const ewmaLimit =
    options.controlLimit * deviation * Math.sqrt(options.lambda / (2 - options.lambda));
  const cusumLimit = options.decisionInterval * deviation;
  const slack = options.slack * deviation;

  const ewmaAlarm = quiet(ewmaLimit);
  const cusumAlarm = quiet(cusumLimit);

  let ewma = mean;
  let accumulated = 0;
  let accumulatingSince = 0;

  for (let i = baseline.buckets; i < series.length; i += 1) {
    const value = series[i]!;

    ewma = options.lambda * value + (1 - options.lambda) * ewma;
    const deviated = ewma - mean;
    if (!ewmaAlarm.fired && deviated > ewmaLimit) {
      ewmaAlarm.fired = true;
      ewmaAlarm.at = i;
      ewmaAlarm.statistic = Math.round(deviated * 1000) / 1000;
    }

    // One-sided: a merchant whose traffic quietly *drops* is not this system's problem.
    const excess = value - mean - slack;
    if (accumulated === 0 && excess > 0) accumulatingSince = i;
    accumulated = Math.max(0, accumulated + excess);

    if (!cusumAlarm.fired && accumulated > cusumLimit) {
      cusumAlarm.fired = true;
      cusumAlarm.at = i;
      cusumAlarm.statistic = Math.round(accumulated * 1000) / 1000;
      cusumAlarm.buckets = i - accumulatingSince + 1;
    }
  }

  return { baseline, ewma: ewmaAlarm, cusum: cusumAlarm };
}

/**
 * Counts per minute between two moments, including the empty ones.
 *
 * The gaps matter as much as the events: a detector handed only the buckets that had traffic
 * would see a burst as continuous and never learn what quiet looks like.
 */
export function bucketize(
  timestamps: readonly number[],
  from: number,
  to: number,
  bucketMs = 60_000,
): number[] {
  const count = Math.max(0, Math.ceil((to - from) / bucketMs));
  const series = new Array<number>(count).fill(0);

  for (const at of timestamps) {
    if (at < from || at >= to) continue;
    const index = Math.floor((at - from) / bucketMs);
    series[index]! += 1;
  }
  return series;
}
