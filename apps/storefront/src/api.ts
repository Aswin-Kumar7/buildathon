declare global {
  interface Window {
    __SENTINEL__?: { apiBaseUrl?: string };
  }
}

/**
 * Where the API lives.
 *
 * Read from a `<script>` the static server injects into index.html at request time, not
 * substituted into the bundle at build time. The difference matters for how this deploys:
 * a build-time value makes the shop's image depend on an address that only exists after
 * the API is running, so the repository cannot simply build and deploy itself. As a
 * runtime value the shop is pointed at a different API with an environment variable and
 * no rebuild.
 *
 * Empty means same-origin, which is what the Vite dev proxy provides locally.
 *
 * These calls deliberately send no credentials. The shop is anonymous; nothing it does
 * should carry a session, and a cookie arriving here would mean the origins had collapsed.
 */
function baseUrl(): string {
  const injected = globalThis.window?.__SENTINEL__?.apiBaseUrl;
  return (injected ?? '').replace(/\/$/, '');
}

export function apiUrl(path: string): string {
  return `${baseUrl()}${path}`;
}
