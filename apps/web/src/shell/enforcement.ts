import { enforcementStateSchema, type EnforcementState } from '@sentinel/contracts';
import { apiMutate } from '../auth/api.js';

/** Shared query key so the banner, the top bar and the policy control all read one live value. */
export const ENFORCEMENT_KEY = ['enforcement'] as const;

export async function fetchEnforcement(): Promise<EnforcementState> {
  const response = await fetch('/api/enforcement', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return enforcementStateSchema.parse(await response.json());
}

async function errorText(response: Response): Promise<string> {
  const detail = (await response.json().catch(() => ({}))) as { message?: unknown };
  return typeof detail.message === 'string' ? detail.message : `api returned ${response.status}`;
}

export async function pauseEnforcement(reason: string): Promise<void> {
  const response = await apiMutate(
    '/api/enforcement/pause',
    reason.trim() === '' ? undefined : { reason: reason.trim() },
  );
  if (!response.ok) throw new Error(await errorText(response));
}

export async function resumeEnforcement(reason: string): Promise<void> {
  const response = await apiMutate(
    '/api/enforcement/resume',
    reason.trim() === '' ? undefined : { reason: reason.trim() },
  );
  if (!response.ok) throw new Error(await errorText(response));
}
