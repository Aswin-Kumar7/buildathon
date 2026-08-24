import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginRequest, SessionUser } from '@sentinel/contracts';
import { fetchMe, login as loginRequest, logout as logoutRequest } from './api.js';

export const SESSION_KEY = ['session'] as const;

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
  return useMutation({
    mutationFn: logoutRequest,
    onSettled: async () => {
      // Clear everything rather than only the session: cached console data belongs to
      // the person who just signed out.
      client.clear();
      await client.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}
