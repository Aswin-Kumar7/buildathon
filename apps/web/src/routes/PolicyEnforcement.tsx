import { useState } from 'react';
import { Power } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EnforcementState } from '@sentinel/contracts';
import { useSession } from '../auth/useSession.js';
import {
  ENFORCEMENT_KEY,
  fetchEnforcement,
  pauseEnforcement,
  resumeEnforcement,
} from '../shell/enforcement.js';
import './PolicyEnforcement.css';

const WHEN: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
};
const fmt = (iso: string): string => new Date(iso).toLocaleString('en-IN', WHEN);

/**
 * The kill switch — one control that stops Sentinel instantly.
 *
 * This is the emergency stop, wired to the runtime enforcement flag (not the reviewed policy field):
 * engaging it takes effect at once, needs no approval, and releases every live block right away —
 * because stopping Sentinel from blocking people is the safe direction to hurry. It is admin-only
 * (the backend enforces that too), guarded by one confirm since it undoes live protection, and every
 * engage/resume is written to the audit log. State is read live from the backend and polled.
 */
export function EnforcementCard(): React.JSX.Element {
  const { user } = useSession();
  const state = useQuery({
    queryKey: ENFORCEMENT_KEY,
    queryFn: fetchEnforcement,
    refetchInterval: 15_000,
  });
  const stopped = state.data?.paused === true;

  return (
    <section className={`pol-enf${stopped ? ' is-stopped' : ''}`}>
      <header className="pol-enf__head">
        <div>
          <h2>
            <Power /> Kill switch
          </h2>
          <p>
            The emergency stop, separate from the policy below. Engage it and Sentinel stops
            blocking and checking everyone at once, and every block running right now is released —
            no review, because stopping protection is the safe direction to hurry.
          </p>
        </div>
        <span className={`pol-enf__pill pol-enf__pill--${stopped ? 'paused' : 'live'}`}>
          {state.isPending ? '…' : stopped ? 'Engaged — Sentinel stopped' : 'Sentinel active'}
        </span>
      </header>

      {stopped && state.data !== undefined && <StoppedMeta state={state.data} />}

      {user?.role === 'admin' ? (
        <Controls stopped={stopped} />
      ) : (
        <p className="pol-enf__note">Only an admin can use the kill switch.</p>
      )}
    </section>
  );
}

function StoppedMeta({ state }: { state: EnforcementState }): React.JSX.Element {
  const bits = [
    state.by === null ? null : `by ${state.by}`,
    state.since === null ? null : fmt(state.since),
    state.reason === null || state.reason === '' ? null : `“${state.reason}”`,
  ].filter((bit) => bit !== null);
  return (
    <p className="pol-enf__meta">
      Engaged {bits.join(' · ')}. Nobody is being blocked, and every live block was released.
    </p>
  );
}

function Controls({ stopped }: { stopped: boolean }): React.JSX.Element {
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const done = (): void => {
    setReason('');
    setConfirming(false);
    void client.invalidateQueries({ queryKey: ENFORCEMENT_KEY });
  };
  const pause = useMutation({ mutationFn: () => pauseEnforcement(reason), onSuccess: done });
  const resume = useMutation({ mutationFn: () => resumeEnforcement(reason), onSuccess: done });
  const err = pause.error?.message ?? resume.error?.message ?? null;

  const reasonInput = (
    <input
      className="pol-enf__reason"
      placeholder="Reason (optional)"
      value={reason}
      onChange={(event) => setReason(event.target.value)}
      maxLength={500}
    />
  );

  return (
    <div className="pol-enf__controls">
      {err !== null && (
        <p className="pol-enf__error" role="alert">
          {err}
        </p>
      )}
      {stopped ? (
        <div className="pol-enf__row">
          {reasonInput}
          <button
            type="button"
            className="pol-enf__btn pol-enf__btn--resume"
            onClick={() => resume.mutate()}
            disabled={resume.isPending}
          >
            {resume.isPending ? 'Turning back on…' : 'Turn protection back on'}
          </button>
        </div>
      ) : confirming ? (
        <div className="pol-enf__confirm">
          <p>
            <strong>Engage the kill switch now?</strong> This releases every active block
            immediately and stops all new blocks and checks until you turn protection back on.
            Shoppers currently blocked will be able to pay.
          </p>
          {reasonInput}
          <div className="pol-enf__row pol-enf__row--end">
            <button
              type="button"
              className="pol-enf__btn pol-enf__btn--ghost"
              onClick={() => setConfirming(false)}
              disabled={pause.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pol-enf__btn pol-enf__btn--pause"
              onClick={() => pause.mutate()}
              disabled={pause.isPending}
            >
              {pause.isPending ? 'Stopping…' : 'Stop & release all blocks'}
            </button>
          </div>
        </div>
      ) : (
        <div className="pol-enf__row">
          <button
            type="button"
            className="pol-enf__btn pol-enf__btn--pause"
            onClick={() => setConfirming(true)}
          >
            <Power /> Engage kill switch
          </button>
          <Link to="/console/audit" className="pol-enf__link">
            View in audit log →
          </Link>
        </div>
      )}
    </div>
  );
}
