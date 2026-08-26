/**
 * Where the merchant storefront lives. In local dev the two apps run on separate Vite ports; a
 * deployment can override with VITE_STOREFRONT_URL. Kept in one place so the landing and the console
 * never disagree about it.
 */
const env = (import.meta as unknown as { env: { VITE_STOREFRONT_URL?: string; DEV?: boolean } })
  .env;

export const STOREFRONT_URL = env.VITE_STOREFRONT_URL ?? (env.DEV ? 'http://localhost:5174' : '/');
