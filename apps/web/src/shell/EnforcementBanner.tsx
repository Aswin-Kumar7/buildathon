import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/useSession.js';
import { ENFORCEMENT_KEY, fetchEnforcement, resumeEnforcement } from './enforcement.js';
import './EnforcementBanner.css';

const WHEN: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
};

/**
 * The always-on notice that enforcement is stopped.
 *
 * Renders nothing while enforcing, and a loud strip across every console page while paused — because
 * "Sentinel is blocking nobody right now" is a fact an operator must not be able to miss. The state
 * is read live from the backend and polled, so a pause triggered from anywhere shows up here.
 */
export function EnforcementBanner(): React.JSX.Element | null {
  const { user } = useSession();
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ENFORCEMENT_KEY,
    queryFn: fetchEnforcement,
    refetchInterval: 15_000,
  });

  const resume = useMutation({
    mutationFn: () => resumeEnforcement('resumed from the banner'),
    onSuccess: () => void client.invalidateQueries({ queryKey: ENFORCEMENT_KEY }),
  });

  if (state.data?.paused !== true) return null;

  const { by, since, reason } = state.data;
  const when = since === null ? null : new Date(since).toLocaleString('en-IN', WHEN);
  const meta = [by === null ? null : `by ${by}`, when].filter((part) => part !== null).join(' · ');

  return (
    <div className="enfbanner" role="alert">
      <span className="enfbanner__pulse" aria-hidden="true" />
      <div className="enfbanner__text">
        <strong>Enforcement is paused — Sentinel is blocking nobody.</strong>
        <span>
          {meta}
          {reason !== null && reason !== '' ? ` · “${reason}”` : ''}
        </span>
      </div>
      {user?.role === 'admin' ? (
        <button
          type="button"
          className="enfbanner__resume"
          onClick={() => resume.mutate()}
          disabled={resume.isPending}
        >
          {resume.isPending ? 'Resuming…' : 'Resume enforcement'}
        </button>
      ) : (
        <span className="enfbanner__note">An admin can resume it.</span>
      )}
    </div>
  );
}
