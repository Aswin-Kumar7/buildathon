import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// The bug this covers: Vite inlines `import.meta.env` at build time, so a deployment that set the
// storefront's address on the running container could never reach the already-built page. The link
// fell back to same-origin and sent people to the API instead. The address now comes from /api/meta.
//
// The resolver caches its answer module-side, on purpose — one request per page load, not one per
// link. So each case has to re-import the module, or the second test would silently assert against
// the first test's cached value and pass without exercising anything.
async function probe(): Promise<() => string | null> {
  vi.resetModules();
  const { useStorefrontUrl } = await import('./links.js');
  const Probe = (): React.JSX.Element => <a href={useStorefrontUrl()}>Storefront</a>;
  render(<Probe />);
  return () => screen.getByRole('link').getAttribute('href');
}

const answers = (body: unknown): void => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('useStorefrontUrl', () => {
  it('prefers the address the running API reports', async () => {
    const deployed = 'https://sentinel-shop.example.com/';
    answers({ storefrontUrl: deployed });
    const href = await probe();
    await waitFor(() => expect(href()).toBe(deployed));
  });

  it('falls back to the built-in address when the deployment configured none', async () => {
    answers({ storefrontUrl: null });
    const href = await probe();
    // Same-origin is the failure mode that sent people to the API, so it must never be the answer.
    await waitFor(() => expect(href()).toBe('http://localhost:5174'));
  });

  it('ignores a malformed answer rather than rendering it', async () => {
    answers({ storefrontUrl: 42 });
    const href = await probe();
    await waitFor(() => expect(href()).toBe('http://localhost:5174'));
  });

  it('renders a usable link when the api is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const href = await probe();
    await waitFor(() => expect(href()).toBe('http://localhost:5174'));
  });
});
