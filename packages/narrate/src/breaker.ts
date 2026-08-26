/**
 * A circuit breaker for the live narrator, so a provider that is down or slow degrades cleanly
 * instead of making every incident wait for the same timeout.
 *
 * The states are the usual three. Closed: calls go through. After enough consecutive failures it
 * trips Open and calls are refused outright — the whole point, since a provider that just failed a
 * dozen times in a row will almost certainly fail the next one too, and the caller should drop to a
 * lower tier immediately rather than burn another timeout. After a cooldown it goes Half-open and
 * lets a single trial through: success closes it, failure opens it again.
 *
 * The clock is injected. This is not ceremony — a breaker whose behaviour depends on wall-clock time
 * is a breaker whose tests are flaky, and the resilience layer is exactly the part that must be
 * tested deterministically rather than hoped about.
 */

import type { Selector } from './select.js';

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  /** Consecutive failures that trip the breaker open. */
  failureThreshold: number;
  /** Milliseconds the breaker stays open before allowing one trial call. */
  cooldownMs: number;
  /** Returns the current time in milliseconds. Injected so the breaker is deterministic under test. */
  now: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: BreakerState = 'closed';

  constructor(private readonly options: BreakerOptions) {}

  /** Whether a call may proceed right now, advancing open → half-open once the cooldown has passed. */
  canAttempt(): boolean {
    if (this.state === 'open' && this.options.now() - this.openedAt >= this.options.cooldownMs) {
      this.state = 'half-open';
    }
    return this.state !== 'open';
  }

  get current(): BreakerState {
    return this.state;
  }

  /** A call succeeded: the breaker closes and the failure count resets. */
  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  /**
   * A call failed. A failure during a half-open trial re-opens immediately; otherwise the breaker
   * opens once the consecutive-failure threshold is reached.
   */
  recordFailure(): void {
    if (this.state === 'half-open') {
      this.trip();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) this.trip();
  }

  private trip(): void {
    this.state = 'open';
    this.openedAt = this.options.now();
    this.failures = this.options.failureThreshold;
  }
}

/** Rejects if `work` does not settle within `ms`, so one slow provider call cannot hang a request. */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Wrap a selector so the breaker and a hard timeout stand in front of it. An open breaker refuses
 * the call outright; a call that runs is bounded, and its success or failure is what moves the
 * breaker. Failures — including the timeout — surface as a throw, so the fallback ladder descends.
 */
export function guarded(selector: Selector, breaker: CircuitBreaker, timeoutMs: number): Selector {
  return {
    source: selector.source,
    async select(facts, available, evidenceHash) {
      if (!breaker.canAttempt()) throw new Error(`breaker open for ${selector.source}`);
      try {
        const result = await withTimeout(
          Promise.resolve(selector.select(facts, available, evidenceHash)),
          timeoutMs,
          () => {
            /* the timeout's failure is recorded on the throw path below */
          },
        );
        breaker.recordSuccess();
        return result;
      } catch (error) {
        breaker.recordFailure();
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
  };
}
