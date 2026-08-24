const PORTS = {
  console: 'http://localhost:5173',
  storefront: 'http://localhost:5174',
};

async function waitFor(name: string, url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }

    if (Date.now() > deadline) {
      throw new Error(`${name} did not become reachable at ${url} within ${timeoutMs}ms`);
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
  await Promise.all(Object.entries(PORTS).map(([name, url]) => waitFor(name, url)));
}
