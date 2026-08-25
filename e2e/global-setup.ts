const API = 'http://localhost:3001/api/health';

const PORTS = {
  console: 'http://localhost:5173',
  storefront: 'http://localhost:5174',
};

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitFor(name: string, url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!(await reachable(url))) {
    if (Date.now() > deadline) {
      // An API that answers while a Vite server never appears means Playwright reused a
      // server it did not start: `pnpm dev` then found port 3001 taken, its own API failed
      // to bind, and the rest of the stack came down with it. Diagnosing that from a bare
      // timeout took an embarrassingly long time twice, so it says so now.
      const hint = (await reachable(API))
        ? `\n\nThe API is answering but ${name} is not, which usually means a dev server was already running on port 3001 before this run. Stop it and try again.`
        : '';
      throw new Error(`${name} did not become reachable at ${url} within ${timeoutMs}ms${hint}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * `webServer` waits for the API, which is the slowest of the three to come up. The two
 * Vite servers are normally ready long before it, but "normally" is not a guarantee — a
 * run that started testing before the API had finished booting produced six failures that
 * looked exactly like application bugs and were not. Waiting for all three costs a
 * fraction of a second and removes that whole class of false negative.
 */
export default async function globalSetup(): Promise<void> {
  // Checked before waiting, not after. An API already answering means Playwright reused a
  // server it did not start and therefore never ran `pnpm dev`, so the Vite servers are not
  // coming — waiting ninety seconds to discover that wastes ninety seconds every time.
  if ((await reachable(API)) && !(await reachable(PORTS.console))) {
    throw new Error(
      'An API is already listening on port 3001, so Playwright reused it and never started ' +
        'the web servers. It is usually a leftover from an interrupted run — Turbo does not ' +
        'always take its children down with it on Windows. ' +
        'Stop it with:  npx kill-port 3001 5173 5174',
    );
  }

  await Promise.all(Object.entries(PORTS).map(([name, url]) => waitFor(name, url)));
}
