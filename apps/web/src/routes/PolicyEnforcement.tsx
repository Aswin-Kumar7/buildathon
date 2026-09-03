import { useState } from 'react';
import { Power, ArrowRight } from '@phosphor-icons/react';
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

export function EnforcementCard(): React.JSX.Element {
  const { user } = useSession();
  const state = useQuery({
    queryKey: ENFORCEMENT_KEY,
    queryFn: fetchEnforcement,
    refetchInterval: 15_000,
  });
  const stopped = state.data?.paused === true;

  return (
    <section className={`pol-enf-card${stopped ? ' is-stopped' : ''}`}>
      {/* Hazard stripe on left edge */}
      <span className="pol-enf-card__hazard" aria-hidden="true" />

      <div className="pol-enf-card__body">
        <div className="pol-enf-card__info">
          <div className="pol-enf-card__heading-row">
            <h2 className="pol-enf-card__title">Kill switch</h2>
            <span
              className={`pol-enf-card__pill pol-enf-card__pill--${stopped ? 'paused' : 'live'}`}
            >
              <span className="pol-enf-card__pill-dot" />
              <span>
                {state.isPending ? 'Checking…' : stopped ? 'Sentinel stopped' : 'Enforcing'}
              </span>
              {!stopped && !state.isPending && <span className="pol-sr-only">Sentinel active</span>}
            </span>
            <span className="pol-enf-card__badge">Emergency stop</span>
          </div>
          <p className="pol-enf-card__desc">
            Separate from the policy below. Engage it and Sentinel stops blocking and checking
            everyone at once, and every block running right now is released — no review, because
            stopping protection is the safe direction to hurry.
          </p>
          {stopped && state.data !== undefined && <StoppedMeta state={state.data} />}
        </div>

        <div className="pol-enf-card__actions">
          <a href="/console/audit" className="pol-enf-card__audit-link">
            Audit log <ArrowRight size={13} />
          </a>
          {user?.role === 'admin' ? (
            <Controls stopped={stopped} />
          ) : (
            <p className="pol-enf-card__admin-only">Only an admin can use the kill switch.</p>
          )}
        </div>
      </div>
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
    <p className="pol-enf-card__meta">
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

  if (stopped) {
    return (
      <div className="pol-enf-ctrl">
        {err !== null && <span className="pol-enf-ctrl__err">{err}</span>}
        <button
          type="button"
          className="pol-enf-btn pol-enf-btn--resume"
          onClick={() => resume.mutate()}
          disabled={resume.isPending}
        >
          <Power size={15} /> Turn protection back on
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="pol-enf-ctrl pol-enf-ctrl--confirming">
        {err !== null && <span className="pol-enf-ctrl__err">{err}</span>}
        <p className="pol-enf-ctrl__warn">
          This immediately releases every active block and stops Sentinel from checking anyone.
        </p>
        <input
          type="text"
          className="pol-enf-ctrl__reason-input"
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          type="button"
          className="pol-enf-btn pol-enf-btn--kill"
          onClick={() => pause.mutate()}
          disabled={pause.isPending}
        >
          <Power size={15} /> Stop &amp; release all blocks
        </button>
        <button
          type="button"
          className="pol-enf-btn pol-enf-btn--cancel"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="pol-enf-ctrl">
      {err !== null && <span className="pol-enf-ctrl__err">{err}</span>}
      <button
        type="button"
        className="pol-enf-btn pol-enf-btn--kill"
        onClick={() => setConfirming(true)}
      >
        <Power size={15} /> Engage kill switch
      </button>
    </div>
  );
}
