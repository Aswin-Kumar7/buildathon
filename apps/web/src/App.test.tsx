import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App.js';

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('renders the product name immediately', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Sentinel' })).toBeInTheDocument();
  });

  it('shows the health payload once the api responds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'ok',
          version: '0.0.1',
          commit: 'abc1234',
          startedAt: '2026-08-24T10:00:00.000Z',
        }),
      }),
    );

    render(<App />);
    expect(await screen.findByText('abc1234')).toBeInTheDocument();
  });

  it('surfaces an unreachable api rather than failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('connection refused');
  });
});
