import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NarrativeDto } from '@sentinel/contracts';
import { NarrativePanel } from './NarrativePanel.js';

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function narrative(over: Partial<NarrativeDto> = {}): NarrativeDto {
  return {
    lines: [
      {
        claimId: 'headline',
        text: 'This checkout session looks like card testing.',
        source: 'live',
        evidence: ['arbitration'],
      },
      {
        claimId: 'top_reason',
        text: 'The clearest sign: 142 attempts came through.',
        source: 'live',
        evidence: ['velocity'],
      },
    ],
    source: 'live',
    mode: 'live',
    dropped: 0,
    evidenceHash: 'abcdef0123456789',
    ...over,
  };
}

function mockFetch(body: { narrative: NarrativeDto }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) } as Response),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('NarrativePanel', () => {
  it('renders the account with a per-line source badge', async () => {
    mockFetch({ narrative: narrative() });
    render(wrap(<NarrativePanel incidentId="a1" />));

    expect(await screen.findByText(/looks like card testing/i)).toBeInTheDocument();
    // The badge is the point: both lines carry where the words came from.
    expect(screen.getAllByText(/live model/i).length).toBeGreaterThanOrEqual(2);
  });

  it('surfaces the fact-guard drop count when the narrator named claims that did not exist', async () => {
    mockFetch({ narrative: narrative({ dropped: 2 }) });
    render(wrap(<NarrativePanel incidentId="a1" />));

    await screen.findByText(/looks like card testing/i);
    expect(screen.getByText(/dropped by the fact guard/i)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('says when it degraded below the mode that was asked for', async () => {
    mockFetch({
      narrative: narrative({
        source: 'template',
        mode: 'live',
        lines: [
          {
            claimId: 'headline',
            text: 'This checkout session looks like card testing.',
            source: 'template',
            evidence: ['arbitration'],
          },
        ],
      }),
    });
    render(wrap(<NarrativePanel incidentId="a1" />));

    await screen.findByText(/looks like card testing/i);
    // The header badge reflects the tier it actually fell to, and the note explains the drop.
    expect(screen.getByText(/asked for live model, degraded to this/i)).toBeInTheDocument();
  });

  it('reports an error rather than blanking when the narrative cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    render(wrap(<NarrativePanel incidentId="a1" />));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
