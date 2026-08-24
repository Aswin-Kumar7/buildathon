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
