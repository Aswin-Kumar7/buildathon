import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IncidentDetail } from '@sentinel/contracts';
import { IncidentCopilotWidget } from './IncidentCopilot.js';
import { apiMutate } from '../auth/api.js';

vi.mock('../auth/api.js', () => ({ apiMutate: vi.fn() }));

const incident = { id: 'a1' } as IncidentDetail;

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function answers(body: unknown): void {
  (apiMutate as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

describe('IncidentCopilotTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('answers a clicked suggestion, grounded in the incident', async () => {
    answers({
      incidentId: 'a1',
      available: true,
      answer: 'Many different cards were tried from one network.',
    });
    render(wrap(<IncidentCopilotWidget incident={incident} />));

    await userEvent.click(screen.getByRole('button', { name: 'Ask AI about this incident' }));
    await userEvent.click(screen.getByRole('button', { name: 'Why is this risky?' }));

    expect(
      await screen.findByText('Many different cards were tried from one network.'),
    ).toBeInTheDocument();
    expect(apiMutate).toHaveBeenCalledWith('/api/incidents/a1/ask', {
      question: 'Why is this risky?',
    });
  });

  it('shows an honest unavailable message instead of a fabricated answer', async () => {
    answers({ incidentId: 'a1', available: false, answer: '' });
    render(wrap(<IncidentCopilotWidget incident={incident} />));

    await userEvent.click(screen.getByRole('button', { name: 'Ask AI about this incident' }));
    await userEvent.type(
      screen.getByLabelText('Ask about this incident'),
      'Is this a false alarm?',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText(/available right now/)).toBeInTheDocument();
  });
});
