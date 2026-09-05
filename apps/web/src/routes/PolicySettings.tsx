import { useState } from 'react';
import {
  FloppyDisk,
  DownloadSimple,
  Gauge,
  SealCheck,
  HandPalm,
  ClockCountdown,
  UserCheck,
  CurrencyInr,
  SlidersHorizontal,
  ClockCounterClockwise,
  Info,
  CaretRight,
  CaretDown,
} from '@phosphor-icons/react';
import type { PolicyResponse } from '@sentinel/contracts';
import {
  blockOptions,
  buildPolicyYaml,
  durationOptions,
  pct,
  scoreOptions,
  type PolicyDraft,
} from './policy-draft.js';
import { Toggle } from './policy-ui.js';

type DraftSetter = (updater: (draft: PolicyDraft) => PolicyDraft) => void;
type SaveNote = { tone: 'ok' | 'critical'; text: string } | null;

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

/**
 * A slider over a fixed ladder of allowed values.
 *
 * The thumb and the reading always agree. They used to be able to disagree: when a neighbouring
 * setting raised this one's floor, the current value dropped out of `options`, `indexOf` returned
 * -1, and the thumb fell back to position 0 while the label went on printing the now-illegal value.
 * A value outside the ladder is snapped to the nearest legal one and reported upward, so the draft
 * cannot sit in a state the control is not showing.
 */
/**
 * A slider over a fixed ladder of allowed values.
 *
 * The scale never changes shape, so a thumb position always means the same value. An earlier version
 * shrank the ladder when a neighbouring setting raised this one's floor, which slid the thumb across
 * the track without the value changing — the control appeared to move on its own.
 *
 * A limit from a neighbouring setting (`floor`/`ceiling`) is applied to the *value*: notches outside
 * it are refused and the choice snaps to the nearest legal one, and the unreachable part of the
 * track is shaded so the limit is visible rather than mysterious.
 */
/**
 * Where a value sits on a fixed ladder, and which part of that ladder a neighbouring limit rules
 * out. Positions come from the index in the whole ladder, never from a filtered subset, so the thumb
 * only moves when the value does.
 */
function ladderGeometry(
  safe: number[],
  value: number,
  floor: number,
  ceiling: number,
): {
  idx: number;
  shown: number;
  fillPct: number;
  blockedBelow: number;
  blockedAbove: number;
  /** The lowest and highest values actually selectable right now, limits included. */
  lowest: number;
  highest: number;
  clamp: (candidate: number) => number;
} {
  const last = safe.length - 1;
  const posOf = (i: number): number => (last > 0 ? (i / last) * 100 : 0);

  const exact = safe.indexOf(value);
  const idx =
    exact >= 0
      ? exact
      : safe.reduce(
          (best, option, i) =>
            Math.abs(option - value) < Math.abs(safe[best]! - value) ? i : best,
          0,
        );

  const lowest = Math.min(...safe.filter((o) => o >= floor), safe[last]!);
  const highest = Math.max(...safe.filter((o) => o <= ceiling), safe[0]!);
  const firstLegal = safe.findIndex((option) => option >= floor);
  const lastLegal = safe.reduce((acc, option, i) => (option <= ceiling ? i : acc), 0);

  return {
    idx,
    shown: safe[idx] ?? value,
    fillPct: posOf(idx),
    blockedBelow: firstLegal > 0 ? posOf(firstLegal) : 0,
    blockedAbove: lastLegal < last ? 100 - posOf(lastLegal) : 0,
    lowest,
    highest,
    clamp: (candidate) => Math.min(Math.max(candidate, lowest), highest),
  };
}

/**
 * States the limit that is actually in force, and names what causes it. When the neighbouring
 * setting's value is not itself a step on this ladder, both numbers are given — otherwise the note
 * would quote a threshold the slider will not actually stop at.
 */
function limitText(
  limit: { direction: 'floor' | 'ceiling'; label: string; value: number },
  effective: number,
  format: (value: number) => string,
): string {
  const verb = limit.direction === 'floor' ? 'go below' : 'exceed';
  const source = `${limit.label} (${format(limit.value)})`;
  if (effective === limit.value) return `Cannot ${verb} ${source}.`;
  const edge = limit.direction === 'floor' ? 'lowest' : 'highest';
  return `Cannot ${verb} ${source}, so the ${edge} available here is ${format(effective)}.`;
}

function LadderSlider({
  options,
  value,
  onChange,
  ariaLabel,
  format,
  floor = -Infinity,
  ceiling = Infinity,
  limit,
}: {
  options: number[];
  value: number;
  onChange: (next: number) => void;
  ariaLabel: string;
  format: (value: number) => string;
  /** Lowest legal value, set by a neighbouring setting. */
  floor?: number;
  /** Highest legal value, set by a neighbouring setting. */
  ceiling?: number;
  /**
   * The neighbouring setting that constrains this one. The note is composed from it rather than
   * passed in ready-made, because the two numbers can differ: a limit of 55% on a ladder that steps
   * 50 → 60 is really a limit of 60, and saying "cannot go below 55%" beside a slider whose lowest
   * notch is 60% is a contradiction the reader has to resolve.
   */
  limit?: { direction: 'floor' | 'ceiling'; label: string; value: number };
}): React.JSX.Element {
  const safe = options.length > 0 ? options : [value];
  const last = safe.length - 1;
  const { idx, shown, fillPct, blockedBelow, blockedAbove, lowest, highest, clamp } =
    ladderGeometry(safe, value, floor, ceiling);
  return (
    <div className="pol-settings-row__control">
      <div className="pol-settings-slider-header">
        <span className="pol-settings-slider-val">{format(shown)}</span>
        {/*
         * The range of what can actually be picked, limits included, and named as a range. It used
         * to print the ladder's raw ends unlabelled — so it read like a description of the value
         * beside it, and on a limited slider it was simply untrue: "50% – 90%" while everything
         * below 60% was refused.
         */}
        <span className="pol-settings-slider-range">
          <span className="pol-settings-slider-range__key">Range</span> {format(lowest)} –{' '}
          {format(highest)}
        </span>
      </div>
      <div className="pol-settings-slider-track-wrap">
        {blockedBelow > 0 && (
          <span
            className="pol-settings-slider-blocked pol-settings-slider-blocked--low"
            style={{ width: `${blockedBelow}%` }}
            aria-hidden="true"
          />
        )}
        {blockedAbove > 0 && (
          <span
            className="pol-settings-slider-blocked pol-settings-slider-blocked--high"
            style={{ width: `${blockedAbove}%` }}
            aria-hidden="true"
          />
        )}
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={idx}
          onChange={(event) => onChange(clamp(safe[Number(event.target.value)] ?? value))}
          className="pol-settings-slider-input"
          style={{ '--fill-pct': `${fillPct}%` } as React.CSSProperties}
          aria-label={ariaLabel}
          aria-valuetext={format(shown)}
        />
      </div>
      {limit !== undefined && (blockedBelow > 0 || blockedAbove > 0) && (
        <span className="pol-settings-slider-note">
          {limitText(limit, limit.direction === 'floor' ? lowest : highest, format)}
        </span>
      )}
    </div>
  );
}

/**
 * A safeguard's numeric field.
 *
 * The `percent` kind was declared and never handled: the share limit rendered its raw fraction, so
 * "Maximum share of shoppers blocked" read `0.05`, and typing the 5 that reads as five percent would
 * have stored 500%. Percent safeguards are now shown and entered in percent and converted at the
 * edge, which is the only place the fraction belongs.
 */
function SafeguardNumber({
  safeguard,
  value,
  onChange,
}: {
  safeguard: Safeguard;
  value: number;
  onChange: (next: number) => void;
}): React.JSX.Element {
  const isPercent = safeguard.kind === 'percent';
  const shown = isPercent ? Math.round(value * 1000) / 10 : value;

  return (
    <div className="pol-safeguard-input-wrap">
      <input
        type="number"
        value={shown}
        min={0}
        max={isPercent ? 100 : undefined}
        step={isPercent ? 0.1 : 1}
        onChange={(event) => {
          const entered = parseFloat(event.target.value || '0');
          const safe = Number.isFinite(entered) ? entered : 0;
          onChange(isPercent ? Math.min(Math.max(safe, 0), 100) / 100 : safe);
        }}
        className="pol-safeguard-input"
        aria-label={safeguard.label}
      />
      <span className="pol-safeguard-suffix">{isPercent ? '%' : (safeguard.suffix ?? '')}</span>
    </div>
  );
}

export function PolicySettingsCard({
  draft,
  onDraft,
  problems,
  policy,
  version,
  dirty,
  pending,
  note,
  onSave,
  onViewHistory,
}: {
  draft: PolicyDraft;
  onDraft: DraftSetter;
  problems: string[];
  policy: PolicyResponse;
  version: number;
  dirty: boolean;
  pending: boolean;
  note: SaveNote;
  onSave: () => void;
  onViewHistory: () => void;
}): React.JSX.Element {
  const [safeguardsOpen, setSafeguardsOpen] = useState(false);

  const downloadYaml = (): void => {
    const yaml = buildPolicyYaml(draft, policy, version);
    const blob = new Blob([yaml], { type: 'application/x-yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentinel-policy-v${version}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="pol-settings-card">
      {/* Header with Title and Action Icons */}
      <div className="pol-settings-card__head">
        <div className="pol-settings-card__head-info">
          <h2 className="pol-settings-card__title">Policy settings</h2>
          <p className="pol-settings-card__desc">
            Adjust how Sentinel handles risky activity. Saving takes effect immediately, and every
            version can be brought back from history.
          </p>
        </div>
        <div className="pol-settings-card__actions">
          {/* History sits with Save: both are things you do to the policy, not page chrome. */}
          <button type="button" className="pol-settings-card__history-btn" onClick={onViewHistory}>
            <ClockCounterClockwise size={14} /> History
          </button>
          {/* One save. It asks for confirmation, then the policy is live. */}
          <button
            type="button"
            className="pol-settings-card__save-btn"
            onClick={onSave}
            disabled={!dirty || pending || problems.length > 0}
          >
            <FloppyDisk size={15} /> {pending ? 'Saving…' : 'Save policy'}
          </button>
          <button
            type="button"
            className="pol-settings-card__icon-btn"
            title="Export policy YAML"
            aria-label="Export policy YAML"
            onClick={downloadYaml}
          >
            <DownloadSimple size={15} />
          </button>
        </div>
      </div>

      {note !== null && (
        <div className={`pol-settings-card__note pol-settings-card__note--${note.tone}`}>
          {note.text}
        </div>
      )}

      {/* Section 1: RISK THRESHOLDS */}
      <div className="pol-settings-card__section-head">
        <Gauge size={14} />
        <span>Risk thresholds</span>
      </div>

      {/* Slider 1: Ask for verification when */}
      <div className="pol-settings-row">
        <div className="pol-settings-row__info">
          <span className="pol-settings-row__icon-plate">
            <SealCheck size={15} />
          </span>
          <div className="pol-settings-row__text">
            <span className="pol-settings-row__label">Ask for verification when</span>
            <span className="pol-settings-row__sub">
              Customers verify when activity looks suspicious but not clearly fraudulent.
            </span>
          </div>
        </div>
        <LadderSlider
          options={scoreOptions(draft.stepUp)}
          value={draft.stepUp}
          // Blocking is a bigger step than verifying, so the block level is carried up with this one
          // rather than being left stranded below it in a policy the backend would reject.
          onChange={(val) =>
            onDraft((d) => ({ ...d, stepUp: val, contain: Math.max(d.contain, val) }))
          }
          ceiling={draft.contain}
          limit={{ direction: 'ceiling', label: 'the block level', value: draft.contain }}
          ariaLabel="Verification risk level"
          format={(v) => `${pct(v)}`}
        />
      </div>

      {/* Slider 2: Block suspicious activity when */}
      <div className="pol-settings-row">
        <div className="pol-settings-row__info">
          <span className="pol-settings-row__icon-plate">
            <HandPalm size={15} />
          </span>
          <div className="pol-settings-row__text">
            <span className="pol-settings-row__label">Block suspicious activity when</span>
            <span className="pol-settings-row__sub">
              A shopper with strong signs of abuse is blocked temporarily.
            </span>
          </div>
        </div>
        <LadderSlider
          options={blockOptions(draft.contain)}
          value={draft.contain}
          onChange={(val) => onDraft((d) => ({ ...d, contain: Math.max(val, d.stepUp) }))}
          floor={draft.stepUp}
          limit={{ direction: 'floor', label: 'the verification level', value: draft.stepUp }}
          ariaLabel="Containment risk level"
          format={(v) => `${pct(v)}`}
        />
      </div>

      {/* Slider 3: Block duration */}
      <div className="pol-settings-row">
        <div className="pol-settings-row__info">
          <span className="pol-settings-row__icon-plate">
            <ClockCountdown size={15} />
          </span>
          <div className="pol-settings-row__text">
            <span className="pol-settings-row__label">Block duration</span>
            <span className="pol-settings-row__sub">
              The block is lifted automatically after the selected time.
            </span>
          </div>
        </div>
        <LadderSlider
          options={durationOptions(draft.defaultMinutes)}
          value={draft.defaultMinutes}
          onChange={(val) =>
            onDraft((d) => ({ ...d, defaultMinutes: Math.min(val, d.maxMinutes) }))
          }
          ceiling={draft.maxMinutes}
          limit={{
            direction: 'ceiling',
            label: 'the longest a block may last',
            value: draft.maxMinutes,
          }}
          ariaLabel="Default block duration"
          format={(v) => `${v} min`}
        />
      </div>

      {/* Section 2: APPROVALS */}
      <div className="pol-settings-card__section-head">
        <UserCheck size={14} />
        <span>Approvals</span>
      </div>

      {/* Toggle: Require approval before blocking */}
      <div className="pol-settings-row">
        <div className="pol-settings-row__info">
          <span className="pol-settings-row__icon-plate">
            <UserCheck size={15} />
          </span>
          <div className="pol-settings-row__text">
            <span className="pol-settings-row__label">Require approval before blocking</span>
            <span className="pol-settings-row__sub">
              Recommended, so no shopper is ever blocked without a person agreeing.
            </span>
          </div>
        </div>
        <div className="pol-settings-row__toggle-wrap">
          <Toggle
            checked={draft.containmentAlwaysNeedsApproval}
            onChange={(checked) =>
              onDraft((d) => ({ ...d, containmentAlwaysNeedsApproval: checked }))
            }
            label="Require approval before blocking"
          />
        </div>
      </div>

      {/* Input: Approval required above */}
      <div className="pol-settings-row">
        <div className="pol-settings-row__info">
          <span className="pol-settings-row__icon-plate">
            <CurrencyInr size={15} />
          </span>
          <div className="pol-settings-row__text">
            <span className="pol-settings-row__label">Approval required above</span>
            <span className="pol-settings-row__sub">
              Transactions above this amount require an additional approver.
            </span>
          </div>
        </div>
        <div className="pol-settings-amount-wrap">
          <span className="pol-settings-amount-cur">₹</span>
          <input
            type="number"
            value={Math.round(draft.dualApprovalAbovePaise / 100)}
            onChange={(e) => {
              const rupees = Math.max(0, parseInt(e.target.value || '0', 10));
              onDraft((d) => ({ ...d, dualApprovalAbovePaise: rupees * 100 }));
            }}
            className="pol-settings-amount-input"
            aria-label="Approval required above amount in Rupees"
          />
        </div>
      </div>

      {/* Section 3: LIMITS */}
      <div className="pol-settings-card__section-head">
        <SlidersHorizontal size={14} />
        <span>Limits</span>
      </div>

      {/*
       * A real button, not a clickable div: this was a bare <div onClick>, so it could not be
       * reached by keyboard and announced itself as nothing at all. The count is derived rather
       * than typed, so it cannot drift from the list below it.
       */}
      <button
        type="button"
        className="pol-settings-safeguards-trigger"
        aria-expanded={safeguardsOpen}
        onClick={() => setSafeguardsOpen((open) => !open)}
      >
        <span className="pol-settings-row__icon-plate">
          <SlidersHorizontal size={15} />
        </span>
        <span className="pol-settings-row__text">
          <span className="pol-settings-row__label">Advanced safeguards</span>
          <span className="pol-settings-row__sub">
            Limits that cap the maximum impact Sentinel can have.
          </span>
        </span>
        <span className="pol-settings-safeguards-badge">{SAFEGUARDS.length} safeguards</span>
        {safeguardsOpen ? <CaretDown size={13} /> : <CaretRight size={13} />}
      </button>

      {safeguardsOpen && (
        <div className="pol-settings-safeguards-body">
          {SAFEGUARDS.map((s) => (
            <div key={s.key} className="pol-safeguard-row">
              <div className="pol-safeguard-row__info">
                <span className="pol-safeguard-row__label">{s.label}</span>
                <span className="pol-safeguard-row__hint">{s.hint}</span>
              </div>
              <div className="pol-safeguard-row__control">
                {s.kind === 'bool' ? (
                  <Toggle
                    checked={draft[s.key] as boolean}
                    onChange={(checked) =>
                      onDraft((d) => ({ ...d, [s.key]: checked }) as PolicyDraft)
                    }
                    label={s.label}
                  />
                ) : (
                  <SafeguardNumber
                    safeguard={s}
                    value={draft[s.key] as number}
                    onChange={(next) => onDraft((d) => ({ ...d, [s.key]: next }) as PolicyDraft)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Card Footer */}
      <div className="pol-settings-card__foot">
        <Info size={14} />
        <span>Saving asks you to confirm, then applies to live traffic straight away.</span>
      </div>
    </section>
  );
}
