import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { LoginRequest, SessionUser } from '@sentinel/contracts';
import { fetchMe, login as loginRequest, logout as logoutRequest } from './api.js';

export const SESSION_KEY = ['session'] as const;

/** How long an armed sign-out waits for its second press before giving up. */
const CONFIRM_WINDOW_MS = 4_000;

export interface SessionState {
  user: SessionUser | null;
  isLoading: boolean;
}

export function useSession(): SessionState {
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: fetchMe,
    // A signed-out visitor is a normal answer, not a failure, so retrying is pointless
    // and only delays the login screen.
    retry: false,
    staleTime: 30_000,
  });

  return { user: query.data?.user ?? null, isLoading: query.isLoading };
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (credentials: LoginRequest) => loginRequest(credentials),
    onSuccess: (data) => {
      client.setQueryData(SESSION_KEY, { user: data.user, csrfToken: data.csrfToken });
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: logoutRequest,
    onSettled: async () => {
      // Clear everything rather than only the session: cached console data belongs to
      // the person who just signed out.
      client.clear();
      // Clearing the cache does not move the page. The console's route guard only runs on
      // navigation, so without this the shell stayed mounted with an empty cache and the person
      // who had just signed out was still looking at it. Land them where a visitor starts.
      await navigate({ to: '/' });
    },
  });
}

export interface ConfirmedLogout {
  /** True once the first press has landed and the control is waiting to be pressed again. */
  armed: boolean;
  isPending: boolean;
  /** First call arms, second signs out. */
  press: () => void;
  /** Drop the confirmation, for blur or for leaving the control. */
  cancel: () => void;
}

/**
 * Signing out is one stray click away from a bare icon in the sidebar, so it asks first. This is
 * the confirmation itself rather than a way to open one: the control arms, relabels, and only the
 * second press calls {@link useLogout}. It disarms on its own so a live confirm is never left
 * sitting in the UI for someone who walked away mid-thought.
 */
export function useConfirmedLogout(): ConfirmedLogout {
  const logout = useLogout();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return {
    armed,
    isPending: logout.isPending,
    press: () => {
      if (!armed) {
        setArmed(true);
        return;
      }
      setArmed(false);
      logout.mutate();
    },
    cancel: () => setArmed(false),
  };
}
