import {
  loginResponseSchema,
  meResponseSchema,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
} from '@sentinel/contracts';

/**
 * The CSRF token is held in memory only, never in storage.
 *
 * The session cookie is httpOnly so scripts cannot read it; the CSRF token is the second
 * half of the double-submit pair and must travel in a header. Keeping it in memory means
 * it dies with the tab rather than lingering where an XSS could find it later.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/**
 * For callers that do their own fetch rather than going through `request` below.
 *
 * Returns an empty object when there is no token, so a signed-out caller sends no header at
 * all rather than an empty one the server would have to decide what to do with.
 */
export function csrfHeaders(): Record<string, string> {
  return csrfToken === null ? {} : { 'x-csrf-token': csrfToken };
}

/**
 * POST to the API with the CSRF token, self-healing a stale one.
 *
 * The CSRF token lives in memory (never storage), so it can drift out of sync with the session
 * cookie — a second tab signs in and rotates it, the dev API restarts, or a long-idle tab holds an
 * old one. The server then rejects the write with 403 "Invalid CSRF token". Rather than surface that
 * to the analyst mid-action, we refresh the token from `/me` once and retry. If the session is
 * genuinely gone, the retry fails too and the caller surfaces it honestly.
 */
export async function apiMutate(path: string, body?: unknown, method = 'POST'): Promise<Response> {
  const init: RequestInit =
    body === undefined
      ? { method, credentials: 'include', headers: { ...csrfHeaders() } }
      : {
          method,
          credentials: 'include',
          headers: { 'content-type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify(body),
        };

  const first = await fetch(path, init);
  if (first.status !== 403) return first;
  // Stale token: refresh from /me and retry once with the current header.
  await fetchMe().catch(() => undefined);
  const retryHeaders =
    body === undefined
      ? { ...csrfHeaders() }
      : { 'content-type': 'application/json', ...csrfHeaders() };
  return fetch(path, { ...init, headers: retryHeaders });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);

  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('content-type', 'application/json');
    if (csrfToken !== null) headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(path, { ...init, headers, credentials: 'include' });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : 'Something went wrong';
    throw new ApiError(message, response.status);
  }

  return response;
}

export async function fetchMe(): Promise<MeResponse> {
  const response = await request('/api/auth/me');
  const parsed = meResponseSchema.parse(await response.json());
  setCsrfToken(parsed.csrfToken);
  return parsed;
}

export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  const parsed = loginResponseSchema.parse(await response.json());
  setCsrfToken(parsed.csrfToken);
  return parsed;
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
  setCsrfToken(null);
}
