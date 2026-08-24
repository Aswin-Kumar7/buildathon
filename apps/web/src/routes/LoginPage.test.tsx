import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LoginPage } from './LoginPage.js';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => ({}),
}));

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  navigate.mockReset();
});

describe('LoginPage', () => {
  it('explains why an identity is needed at all', () => {
    render(wrap(<LoginPage />));
    expect(screen.getByText(/every approval is recorded/i)).toBeInTheDocument();
  });

  it('rejects a malformed email before contacting the api', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(wrap(<LoginPage />));
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires a password', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(wrap(<LoginPage />));
    await userEvent.type(screen.getByLabelText('Email'), 'analyst@sentinel.local');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Password is required')).toBeInTheDocument();
  });

  it('surfaces a rejected sign-in without revealing which field was wrong', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Email or password is incorrect' }),
      }),
    );

    render(wrap(<LoginPage />));
    await userEvent.type(screen.getByLabelText('Email'), 'analyst@sentinel.local');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('navigates to the console after a successful sign-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'analyst@sentinel.local',
            displayName: 'Demo Analyst',
            role: 'analyst',
          },
          csrfToken: 'csrf-token-value',
        }),
      }),
    );

    render(wrap(<LoginPage />));
    await userEvent.type(screen.getByLabelText('Email'), 'analyst@sentinel.local');
    await userEvent.type(screen.getByLabelText('Password'), 'sentinel-demo');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/console' }));
  });

  it('shows the demo credentials so a reviewer can get in', () => {
    render(wrap(<LoginPage />));
    expect(screen.getByText(/analyst@sentinel.local/)).toBeInTheDocument();
  });
});
