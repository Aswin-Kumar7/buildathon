import { useState, type ReactNode } from 'react';
import {
  FloppyDisk,
  PaperPlaneRight,
  DownloadSimple,
  Checks,
  X,
  Clock,
  Check,
  ArrowRight,
} from '@phosphor-icons/react';
import { Callout } from '@sentinel/ui';
import type { PolicyResponse } from '@sentinel/contracts';
import {
  blockOptions,
  buildPolicyYaml,
  draftFromPolicy,
  durationOptions,
  pct,
  scoreOptions,
  type PolicyDraft,
} from './policy-draft.js';
import { Toggle } from './policy-ui.js';

type DraftSetter = (updater: (draft: PolicyDraft) => PolicyDraft) => void;
type SaveNote = { tone: 'ok' | 'critical'; text: string } | null;

/** The safeguards behind the collapsible row — every one a real, backend-enforced ceiling. */
interface Safeguard {
  key: keyof PolicyDraft;
  kind: 'number' | 'percent' | 'bool';
  label: string;
  hint: string;
  suffix?: string;
}
const SAFEGUARDS: Safeguard[] = [
  {
    key: 'maxActiveContainments',
    kind: 'number',
    label: 'Maximum blocks at once',
    hint: 'The most shoppers Sentinel may block at the same time.',
  },
  {
    key: 'maxContainmentsPerHour',
    kind: 'number',
    label: 'Maximum blocks per hour',
    hint: 'A ceiling on how fast Sentinel can act, whatever it sees.',
  },
  {
    key: 'maxShareOfActiveSessions',
    kind: 'percent',
    label: 'Maximum share of shoppers blocked',
    hint: 'Sentinel never blocks more than this share of active shoppers at once.',
  },
  {
    key: 'shareAppliesAboveSessions',
    kind: 'number',
    label: 'Apply that share only above',
    hint: 'The share limit kicks in only once there are at least this many active shoppers.',
    suffix: 'shoppers',
  },
  {
    key: 'maxMinutes',
    kind: 'number',
    label: 'Longest a block can last',
    hint: 'No block can be extended past this, so nothing ever becomes permanent.',
    suffix: 'minutes',
  },
  {
    key: 'maxExtensions',
    kind: 'number',
    label: 'Maximum block extensions',
    hint: 'How many times a block may be extended before it must be reviewed again.',
  },
  {
    key: 'maxFeatureAgeMinutes',
    kind: 'number',
    label: 'Require recent data within',
    hint: 'If Sentinel’s view of activity is staler than this, it holds off rather than acting.',
    suffix: 'minutes',
  },
  {
    key: 'requireConfirmedCounts',
    kind: 'bool',
    label: 'Only act on confirmed activity',
    hint: 'Sentinel acts on confirmed counts only, never on an early estimate.',
  },
  {
    key: 'refuseWhenArbitrationAbstained',
    kind: 'bool',
    label: 'Do nothing when uncertain',
    hint: 'When Sentinel can’t clearly explain activity, it takes no action and asks a person.',
  },
];

export function PolicySettingsCard({
  draft,
  onDraft,
  problems,
  policy,
  version,
  dirty,
  allowlistEmpty,
  pending,
  note,
  onSave,
}: {
  draft: PolicyDraft;
  onDraft: DraftSetter;
  problems: string[];
  policy: PolicyResponse;
  version: number;
  dirty: boolean;
  allowlistEmpty: boolean;
  pending: boolean;
  note: SaveNote;
  onSave: (submit: boolean) => void;
}): React.JSX.Element {
  const set = (key: keyof PolicyDraft, value: number | boolean): void =>
    onDraft((current) => ({ ...current, [key]: value }));

  return (
    <section className="pol-card pol-settings">
      <header className="pol-settings__head">
        <div className="pol-settings__intro">
          <h2>Policy settings</h2>
          <p>
            Drag to adjust how Sentinel handles risky activity. Changes are staged as a draft and
            reviewed before they go live.
          </p>
        </div>
        <SettingsActions
          policy={policy}
          dirty={dirty}
          allowlistEmpty={allowlistEmpty}
          pending={pending}
          onSave={onSave}
        />
      </header>

      {note !== null && (
        <Callout
          tone={note.tone === 'ok' ? 'ok' : 'critical'}
          title={note.tone === 'ok' ? 'Done' : 'Not saved'}
        >
          <p role="status">{note.text}</p>
        </Callout>
      )}
      {problems.length > 0 && (
        <Callout tone="warn" title="Check these before saving">
          <ul className="pol-problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Callout>
      )}

      <RiskLadders draft={draft} set={set} />

      <ApprovalSetting draft={draft} set={set} />

      <Advanced draft={draft} set={set} />

      <p className="pol-settings__foot">
        {dirty && !allowlistEmpty
          ? 'This policy has allowlist entries that can’t be edited from here, so it can’t be saved from the console.'
          : dirty
            ? `Next draft would be version ${version}.`
            : 'Change a setting to stage a draft.'}
      </p>
    </section>
  );
}

/** The three primary risk-response sliders: when to verify, when to block, and for how long. */
function RiskLadders({
  draft,
  set,
}: {
  draft: PolicyDraft;
  set: (key: keyof PolicyDraft, value: number | boolean) => void;
}): React.JSX.Element {
  return (
    <>
      <Setting
        icon={<Checks />}
        title="Ask for verification when"
        desc="Customers verify when activity looks suspicious but not clearly fraudulent."
      >
        <LadderSlider
          options={scoreOptions(draft.stepUp, 0)}
          value={draft.stepUp}
          onChange={(v) => set('stepUp', v)}
          ariaLabel="Verification risk level"
          format={(v) => `${pct(v)} risk score`}
        />
      </Setting>

      <Setting
        icon={<X />}
        title="Block suspicious activity when"
        desc="Pulse with strong signs of abuse is blocked temporarily."
      >
        <LadderSlider
          options={blockOptions(draft.contain, draft.stepUp)}
          value={draft.contain}
          onChange={(v) => set('contain', v)}
          ariaLabel="Block risk level"
          format={(v) => `${pct(v)} risk score`}
        />
      </Setting>

      <Setting
        icon={<Clock />}
        title="Block duration"
        desc="The block is lifted automatically after the selected time."
      >
        <LadderSlider
          options={durationOptions(draft.defaultMinutes, draft.maxMinutes)}
          value={draft.defaultMinutes}
          onChange={(v) => set('defaultMinutes', v)}
          ariaLabel="Block duration"
          format={(m) => `${m} minutes`}
        />
      </Setting>
    </>
  );
}

/** The three staged-change actions, as icon buttons in the card header. Labels live in the tooltip and for assistive tech. */
function SettingsActions({
  policy,
  dirty,
  allowlistEmpty,
  pending,
  onSave,
}: {
  policy: PolicyResponse;
  dirty: boolean;
  allowlistEmpty: boolean;
  pending: boolean;
  onSave: (submit: boolean) => void;
}): React.JSX.Element {
  const canSave = dirty && allowlistEmpty && !pending;
  return (
    <div className="pol-settings__actions">
      <button
        type="button"
        className="pol-settings__act pol-settings__act--primary"
        title="Save as draft"
        aria-label="Save as draft"
        disabled={!canSave}
        onClick={() => onSave(false)}
      >
        {pending ? <Spinner /> : <FloppyDisk />}
      </button>
      <button
        type="button"
        className="pol-settings__act"
        title="Create draft & request approval"
        aria-label="Create draft & request approval"
        disabled={!canSave}
        onClick={() => onSave(true)}
      >
        <PaperPlaneRight />
      </button>
      <button
        type="button"
        className="pol-settings__act"
        title="Export current policy (YAML)"
        aria-label="Export current policy"
        disabled={!allowlistEmpty}
        onClick={() => exportPolicy(policy)}
      >
        <DownloadSimple />
      </button>
    </div>
  );
}

function exportPolicy(policy: PolicyResponse): void {
  const yaml = buildPolicyYaml(draftFromPolicy(policy), policy, policy.version);
  const url = URL.createObjectURL(new Blob([yaml], { type: 'text/yaml' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `sentinel-policy-v${policy.version}.yaml`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** A slider that steps through a fixed ladder of valid values — drag left/right, never an invalid stop. */
function LadderSlider({
  options,
  value,
  onChange,
  ariaLabel,
  format,
}: {
  options: number[];
  value: number;
  onChange: (next: number) => void;
  ariaLabel: string;
  format: (value: number) => string;
}): React.JSX.Element {
  const safe = options.length > 0 ? options : [value];
  const idx = Math.max(0, safe.indexOf(value));
  const first = safe[0] ?? value;
  const last = safe[safe.length - 1] ?? value;
  return (
    <div className="pol-slider">
      <div className="pol-slider__value">{format(value)}</div>
      <input
        type="range"
        className="pol-slider__range"
        min={0}
        max={safe.length - 1}
        step={1}
        value={idx}
        onChange={(event) => onChange(safe[Number(event.target.value)] ?? value)}
        aria-label={ariaLabel}
        aria-valuetext={format(value)}
      />
      <div className="pol-slider__ends" aria-hidden="true">
        <span>{format(first)}</span>
        <span>{format(last)}</span>
      </div>
    </div>
  );
}

function Setting({
  icon,
  title,
  desc,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="pol-setting">
      <div className="pol-setting__label">
        <span className="pol-setting__ico">{icon}</span>
        <span className="pol-setting__labeltext">
          <strong>{title}</strong>
          <small>{desc}</small>
        </span>
      </div>
      <div className="pol-setting__control">{children}</div>
    </div>
  );
}

function ApprovalSetting({
  draft,
  set,
}: {
  draft: PolicyDraft;
  set: (key: keyof PolicyDraft, value: number | boolean) => void;
}): React.JSX.Element {
  return (
    <div className="pol-setting pol-setting--group">
      <div className="pol-setting__label">
        <span className="pol-setting__ico">
          <Check />
        </span>
        <span className="pol-setting__labeltext">
          <strong>Require approval before blocking</strong>
          <small>Recommended, so no shopper is ever blocked without a person agreeing.</small>
        </span>
      </div>
      <div className="pol-setting__control pol-setting__control--toggle">
        <Toggle
          checked={draft.containmentAlwaysNeedsApproval}
          onChange={(next) => set('containmentAlwaysNeedsApproval', next)}
          label="Require approval before blocking"
        />
      </div>

      <div className="pol-subsetting">
        <div className="pol-subsetting__label">
          <strong>Approval required above</strong>
          <small>Transactions above this amount require an additional approver.</small>
        </div>
        <div className="pol-subsetting__control">
          <span className="pol-money">
            <span aria-hidden="true">₹</span>
            <input
              type="number"
              min="0"
              step="100"
              value={Math.round(draft.dualApprovalAbovePaise / 100)}
              onChange={(event) =>
                set(
                  'dualApprovalAbovePaise',
                  Math.max(0, Math.round(Number(event.target.value))) * 100,
                )
              }
              aria-label="Approval required above amount in rupees"
            />
          </span>
        </div>
      </div>
    </div>
  );
}

function Advanced({
  draft,
  set,
}: {
  draft: PolicyDraft;
  set: (key: keyof PolicyDraft, value: number | boolean) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className={`pol-advanced${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="pol-advanced__bar"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="pol-advanced__title">
          <ArrowRight />
          <span>
            <strong>Advanced safeguards</strong>
            <small>Set limits to control the maximum impact Sentinel can have.</small>
          </span>
        </span>
        <span className="pol-advanced__count">{SAFEGUARDS.length} safeguards</span>
      </button>
      {open && (
        <div className="pol-advanced__body">
          {SAFEGUARDS.map((safeguard) => (
            <SafeguardRow key={safeguard.key} safeguard={safeguard} draft={draft} set={set} />
          ))}
        </div>
      )}
    </div>
  );
}

function SafeguardRow({
  safeguard,
  draft,
  set,
}: {
  safeguard: Safeguard;
  draft: PolicyDraft;
  set: (key: keyof PolicyDraft, value: number | boolean) => void;
}): React.JSX.Element {
  const value = draft[safeguard.key];
  return (
    <div className="pol-guard">
      <div className="pol-guard__text">
        <strong>{safeguard.label}</strong>
        <small>{safeguard.hint}</small>
      </div>
      <div className="pol-guard__control">
        {safeguard.kind === 'bool' ? (
          <Toggle
            checked={value === true}
            onChange={(next) => set(safeguard.key, next)}
            label={safeguard.label}
          />
        ) : safeguard.kind === 'percent' ? (
          <span className="pol-suffix">
            <input
              type="number"
              min="0"
              max="100"
              value={Math.round((value as number) * 100)}
              onChange={(event) =>
                set(safeguard.key, Math.min(100, Math.max(0, Number(event.target.value))) / 100)
              }
              aria-label={safeguard.label}
            />
            <span aria-hidden="true">%</span>
          </span>
        ) : (
          <span className="pol-suffix">
            <input
              type="number"
              min="0"
              value={value as number}
              onChange={(event) =>
                set(safeguard.key, Math.max(0, Math.round(Number(event.target.value))))
              }
              aria-label={safeguard.label}
            />
            {safeguard.suffix !== undefined && <span aria-hidden="true">{safeguard.suffix}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

function Spinner(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="pol-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
