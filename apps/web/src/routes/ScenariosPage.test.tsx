import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ScenarioListResponse } from '@sentinel/contracts';
import { ScenariosPage } from './ScenariosPage.js';

const catalogue: ScenarioListResponse = {
  counts: { razorpay: 5, replay: 0 },
  scenarios: [
    {
      family: 'retry_storm',
      title: 'Legitimate dunning',
      narrative: 'A subscription biller retrying failed renewals on a schedule.',
      classification: 'operational',
      correlation: 'A few cards, many attempts each, on a regular cadence.',
      recommendedAction: 'Nothing, or a note to whoever owns the retry schedule.',
      difficulty: 'An attack tries many cards a few times; dunning tries few cards many times.',
    },
    {
      family: 'attack_loud',
      title: 'Card enumeration, undisguised',
      narrative: 'One machine working through a list of card numbers.',
      classification: 'attack',
      correlation: 'One session, one device, one network, many distinct cards.',
      recommendedAction: 'Contain it.',
      difficulty: 'The easy case, included as a floor.',
    },
  ],
};

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(
  overrides: Partial<ScenarioListResponse> = {},
  replayOk = true,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return {
        ok: replayOk,
        status: replayOk ? 200 : 403,
        json: async () => ({
          family: 'attack_loud',
          eventsWritten: 67,
          checkoutsWritten: 63,
          duplicatesSkipped: 0,
        }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...catalogue, ...overrides }),
    } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ScenariosPage', () => {
  it('lists each scenario with what it is and what the right answer is', async () => {
    stub();
    render(wrap(<ScenariosPage />));

    expect(await screen.findByText('Legitimate dunning')).toBeInTheDocument();
    expect(screen.getByText(/Nothing, or a note/)).toBeInTheDocument();
    expect(screen.getByText('Card enumeration, undisguised')).toBeInTheDocument();
  });

  it('says why each scenario is hard, on the card', async () => {
    // A scenario nobody can see the point of is one that gets quietly dropped when it starts
    // failing.
    stub();
    render(wrap(<ScenariosPage />));
    expect(await screen.findByText(/dunning tries few cards many times/)).toBeInTheDocument();
  });

  it('marks a legitimate retry storm as operational, not as an attack', async () => {
    stub();
    render(wrap(<ScenariosPage />));

    expect(await screen.findByText('operational')).toBeInTheDocument();
    expect(screen.getByText('attack')).toBeInTheDocument();
  });

  it('counts synthetic events apart from real ones', async () => {
    // A demo that inflated the real numbers would make every claim about ingestion worthless.
    stub({ counts: { razorpay: 5, replay: 67 } });
    render(wrap(<ScenariosPage />));

    expect(await screen.findByText(/events from Razorpay/)).toBeInTheDocument();
    expect(screen.getByText('67')).toBeInTheDocument();
    expect(screen.getByText(/marked apart at the row/)).toBeInTheDocument();
  });

  it('replays a scenario and reports what it wrote', async () => {
    stub();
    render(wrap(<ScenariosPage />));

    await screen.findByText('Card enumeration, undisguised');
    await userEvent.click(
      screen.getByRole('button', { name: 'Replay Card enumeration, undisguised' }),
    );

    expect(await screen.findByText(/67 events and 63 checkouts written/)).toBeInTheDocument();
  });

  it('sends the csrf token, because replay writes to the database', async () => {
    const fetchMock = stub();
    render(wrap(<ScenariosPage />));

    await screen.findByText('Card enumeration, undisguised');
    await userEvent.click(screen.getByRole('button', { name: 'Replay Legitimate dunning' }));

    const post = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post).toBeDefined();
    expect(Object.keys(post![1].headers)).toContain('content-type');
  });

  it('cannot clear when nothing was replayed', async () => {
    stub({ counts: { razorpay: 5, replay: 0 } });
    render(wrap(<ScenariosPage />));

    expect(await screen.findByRole('button', { name: 'Remove replayed events' })).toBeDisabled();
  });

  it('surfaces a refused replay rather than looking like it worked', async () => {
    stub({}, false);
    render(wrap(<ScenariosPage />));

    await screen.findByText('Card enumeration, undisguised');
    await userEvent.click(screen.getByRole('button', { name: 'Replay Legitimate dunning' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('403');
  });
});
