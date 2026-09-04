/**
 * Absolute deadlines carried with a job, so work whose time has already passed is dropped rather
 * than run late.
 *
 * Under backpressure the useful thing to do with a job that has been waiting too long is to abandon
 * it: the caller has almost certainly given up, and spending a worker on it delays the jobs that
 * have not. A deadline is absolute (a wall-clock instant, not a duration) precisely so it survives
 * being queued — the clock keeps moving while the job waits, and only an absolute instant tells you
 * how much of the budget the wait already spent.
 */

/** Whether the deadline has already passed — the check a worker makes before starting queued work. */
export function isExpired(deadline: number, now: () => number = Date.now): boolean {
  return now() >= deadline;
}

/** Milliseconds left on the deadline, floored at zero. */
export function remainingMs(deadline: number, now: () => number = Date.now): number {
  return Math.max(0, deadline - now());
}
