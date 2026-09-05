/**
 * What the browser tab says, per route.
 *
 * Every page in the console used to be titled "Sentinel", which makes a pinned tab and a history
 * search useless once more than one is open. The page name comes first because tabs truncate from
 * the right, so the distinguishing word has to be the one that survives.
 *
 * Names match what each page calls itself in its own heading, or what the sidebar calls it where
 * that is shorter — a tab reading something the page never says is its own small confusion.
 */

const PRODUCT = 'Sentinel';

/** Specific before general: the detail routes have to be tested ahead of the lists they sit under. */
const CONSOLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/console\/attempts\/[^/]+\/?$/, 'Payment attempt'],
  [/^\/console\/attempts\/?$/, 'Payment attempts'],
  [/^\/console\/incidents\/[^/]+\/?$/, 'Incident'],
  [/^\/console\/incidents\/?$/, 'Incidents'],
  [/^\/console\/policy\/history\/?$/, 'Policy history'],
  [/^\/console\/policy\/?$/, 'Policy'],
  [/^\/console\/audit\/?$/, 'Audit trail'],
  [/^\/console\/scenarios\/?$/, 'Simulation'],
  [/^\/console\/settings\/?$/, 'Settings'],
  [/^\/console\/features\/?$/, 'Feature inspector'],
  [/^\/console\/health\/?$/, 'System health'],
  [/^\/console\/?$/, 'Overview'],
];

export function titleFor(pathname: string): string {
  if (pathname === '/' || pathname === '') {
    return `${PRODUCT} | Card testing detection`;
  }
  if (/^\/login\/?$/.test(pathname)) return `Sign in | ${PRODUCT}`;

  for (const [pattern, name] of CONSOLE) {
    if (pattern.test(pathname)) return `${name} | ${PRODUCT}`;
  }
  // An unrecognised path is the router's 404, not a page worth naming.
  return PRODUCT;
}
