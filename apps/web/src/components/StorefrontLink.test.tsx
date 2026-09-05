import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The storefront container scales to zero, so its first load after an idle period is a blank tab
// for about ten seconds. The link warns first and starts the wake while the warning is read.
//
// Localhost is the only address that never sleeps. An earlier version also demanded a cross-origin
// address, so a deployment that had not set STOREFRONT_URL yet — where the link is same-origin —
// got no warning at all, in exactly the case the notice exists for. The same-origin case has its
// own test below so that cannot come back quietly.
//
// `useStorefrontUrl` caches its answer module-side — one request per page load, not one per link —
// so every case re-imports the module. Without that, the second test would assert against the
// first test's cached address and pass without exercising anything.
async function mount(storefrontUrl: string | null): Promise<void> {
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ storefrontUrl }) }),
  );
  const { StorefrontLink } = await import('./StorefrontLink.js');
  render(<StorefrontLink className="probe">Storefront</StorefrontLink>);
  if (storefrontUrl !== null) {
    await waitFor(() => expect(screen.getByRole('link').getAttribute('href')).toBe(storefrontUrl));
  }
}

const notice = (): HTMLElement | null => screen.queryByRole('dialog');

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('StorefrontLink', () => {
  it('warns before opening the storefront, and wakes it while the warning is read', async () => {
    await mount('https://sentinel-shop.example.com/');
    const warmUps = (): number =>
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('sentinel-shop'))
        .length;
    expect(warmUps()).toBe(0);

    await userEvent.click(screen.getByRole('link'));

    expect(notice()).not.toBeNull();
    expect(screen.getByRole('heading', { name: /storefront is waking up/i })).toBeTruthy();
    // The point of warning early: the container starts on this click, not on the next one.
    expect(warmUps()).toBe(1);
  });

  it('still warns when the deployment has not configured an address', async () => {
    // The regression that made this notice look broken: no STOREFRONT_URL, so the API reports a
    // same-origin link. The container it resolves to sleeps exactly the same.
    vi.stubGlobal('location', {
      href: 'https://sentinel-api.example.com/',
      hostname: 'sentinel-api.example.com',
    });
    await mount('/');
    await userEvent.click(screen.getByRole('link'));
    expect(notice()).not.toBeNull();
  });

  it('opens the storefront in a new tab once the warning is acknowledged', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await mount('https://sentinel-shop.example.com/');
    await userEvent.click(screen.getByRole('link'));
    await userEvent.click(screen.getByRole('button', { name: /open the storefront/i }));

    expect(open).toHaveBeenCalledWith(
      'https://sentinel-shop.example.com/',
      '_blank',
      'noopener,noreferrer',
    );
    expect(notice()).toBeNull();
  });

  it('dismisses without opening anything', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await mount('https://sentinel-shop.example.com/');
    await userEvent.click(screen.getByRole('link'));
    await userEvent.click(screen.getByRole('button', { name: /not now/i }));

    expect(open).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });

  it('stays quiet on localhost, where nothing has to wake up', async () => {
    await mount('http://localhost:5174');
    await userEvent.click(screen.getByRole('link'));
    expect(notice()).toBeNull();
  });

  it('leaves a modifier click alone, because that reader already chose how to open it', async () => {
    await mount('https://sentinel-shop.example.com/');
    // One session, so the held modifier is still down when the click lands.
    const user = userEvent.setup();
    await user.keyboard('{Meta>}');
    await user.click(screen.getByRole('link'));
    await user.keyboard('{/Meta}');
    expect(notice()).toBeNull();
  });
});
