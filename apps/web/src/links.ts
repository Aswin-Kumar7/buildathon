import { useEffect, useState } from 'react';

/**
 * Where the merchant storefront lives.
 *
 * This is resolved twice, and the order matters. `import.meta.env` is inlined by Vite when the
 * bundle is built, so a deployment that only sets the address on the running container can never
 * reach it — the built page falls back to a same-origin link and sends people to whatever is
 * serving it, which on the hosted build is the API. So the built-in value is only a floor, and the
 * running API's `/api/meta` is asked for the real one.
 */
const env = (import.meta as unknown as { env: { VITE_STOREFRONT_URL?: string; DEV?: boolean } })
  .env;

/** The build-time floor: the dev port locally, and same-origin if nothing was configured. */
export const STOREFRONT_URL = env.VITE_STOREFRONT_URL ?? (env.DEV ? 'http://localhost:5174' : '/');

/** Module-scoped so the answer is fetched once per page load, not once per link on the page. */
let resolved: string | undefined;
let inflight: Promise<string> | undefined;

async function askTheApi(): Promise<string> {
  try {
    const res = await fetch('/api/meta');
    if (!res.ok) return STOREFRONT_URL;
    const body: unknown = await res.json();
    const url = (body as { storefrontUrl?: unknown }).storefrontUrl;
    return typeof url === 'string' && url.length > 0 ? url : STOREFRONT_URL;
  } catch {
    // An unreachable API is not a reason to render a broken link; keep the built-in value.
    return STOREFRONT_URL;
  }
}

/**
 * The storefront address, starting from the build-time value and upgrading to the deployment's own
 * once the API answers. Rendering the floor first means the link is never dead while in flight.
 */
export function useStorefrontUrl(): string {
  const [url, setUrl] = useState(resolved ?? STOREFRONT_URL);

  useEffect(() => {
    if (resolved !== undefined) return undefined;
    let live = true;
    inflight ??= askTheApi();
    void inflight.then((value) => {
      resolved = value;
      if (live) setUrl(value);
    });
    return () => {
      live = false;
    };
  }, []);

  return url;
}
