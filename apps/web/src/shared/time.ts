/**
 * The two time formatters the console pages share. One implementation each, so a duration or an
 * age reads the same on every page — three copies of `formatWindow` and two of `timeAgo` had
 * drifted into being the same code in five places.
 */

/** A duration as a person says it: "45 sec", "3 min 10 sec", "2 hr 5 min". */
export function formatWindow(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} sec`;
  if (minutes < 60) return `${minutes} min ${seconds} sec`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** How long ago an instant was, coarsened as it recedes. */
export function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hr ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
