/**
 * A fixed-memory latency window that reports the tail, not the average.
 *
 * An average is the wrong statistic for a latency SLO and actively misleading under load: a service
 * can sit at a healthy mean while its p99 has already breached, because the mean is dominated by the
 * many fast requests and says nothing about the few slow ones a user actually notices. So this keeps
 * the recent samples in a ring buffer and reports p50/p95/p99/p99.9/max — the shape the performance
 * report is required to publish, and the signal the shedder triggers on.
 *
 * The buffer is bounded, so memory is fixed regardless of throughput; old samples age out as new
 * ones arrive, which is what makes the percentiles reflect *now* rather than the whole history.
 */
export interface Percentiles {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  max: number;
}

export class LatencyWindow {
  private readonly buffer: Float64Array;
  private index = 0;
  private filled = 0;

  constructor(private readonly capacity = 4096) {
    this.buffer = new Float64Array(capacity);
  }

  /** Record one latency sample in milliseconds. */
  record(ms: number): void {
    this.buffer[this.index] = ms;
    this.index = (this.index + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
  }

  get samples(): number {
    return this.filled;
  }

  /** The current p99 in the window, or 0 when nothing has been recorded — what the shedder reads. */
  p99(): number {
    return this.quantile(0.99);
  }

  /** The full percentile set over the current window. */
  snapshot(): Percentiles {
    return {
      count: this.filled,
      p50: this.quantile(0.5),
      p95: this.quantile(0.95),
      p99: this.quantile(0.99),
      p999: this.quantile(0.999),
      max: this.filled === 0 ? 0 : this.quantile(1),
    };
  }

  // Nearest-rank on a copy of the live samples. Sorting per call is fine at these window sizes and
  // avoids the bookkeeping of an online structure; if this ever became hot, a t-digest would replace
  // it without changing the interface.
  private quantile(q: number): number {
    if (this.filled === 0) return 0;
    const sorted = Array.from(this.buffer.subarray(0, this.filled)).sort((a, b) => a - b);
    const rank = Math.ceil(q * sorted.length) - 1;
    const clamped = Math.min(sorted.length - 1, Math.max(0, rank));
    return sorted[clamped]!;
  }
}
