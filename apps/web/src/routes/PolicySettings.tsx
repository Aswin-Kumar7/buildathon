import { useState } from 'react';
import {
  FloppyDisk,
  PaperPlaneRight,
  DownloadSimple,
  Gauge,
  SealCheck,
  HandPalm,
  ClockCountdown,
  UserCheck,
  CurrencyInr,
  SlidersHorizontal,
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

function LadderSlider({
  options,
  value,
  onChange,
  ariaLabel,
  format,
  rangeLabel,
}: {
  options: number[];
  value: number;
  onChange: (next: number) => void;
  ariaLabel: string;
  format: (value: number) => string;
  rangeLabel: string;
}): React.JSX.Element {
  const safe = options.length > 0 ? options : [value];
  const idx = Math.max(0, safe.indexOf(value));
  return (
    <div className="pol-settings-row__control">
      <div className="pol-settings-slider-header">
        <span className="pol-settings-slider-val">{format(value)}</span>
        <span className="pol-settings-slider-range">{rangeLabel}</span>
      </div>
      <div className="pol-settings-slider-track-wrap">
        <input
          type="range"
          min={0}
          max={safe.length - 1}
          step={1}
          value={idx}
          onChange={(event) => onChange(safe[Number(event.target.value)] ?? value)}
          className="pol-settings-slider-input"
          aria-label={ariaLabel}
          aria-valuetext={format(value)}
        />
      </div>
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
            Adjust how Sentinel handles risky activity. Changes are staged as a draft and reviewed
            before they go live.
          </p>
        </div>
        <div className="pol-settings-card__actions">
          <button
            type="button"
            className="pol-settings-card__icon-btn"
            title="Save draft"
            aria-label="Save as draft"
            onClick={() => onSave(false)}
            disabled={!dirty || pending || problems.length > 0}
          >
            <FloppyDisk size={15} />
          </button>
          <button
            type="button"
            className="pol-settings-card__icon-btn"
            title="Submit for approval"
            aria-label="Submit for approval"
            onClick={() => onSave(true)}
            disabled={!dirty || pending || problems.length > 0}
          >
            <PaperPlaneRight size={15} />
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
          options={scoreOptions(draft.stepUp, 0)}
          value={draft.stepUp}
          onChange={(val) => onDraft((d) => ({ ...d, stepUp: val }))}
          ariaLabel="Verification risk level"
          format={(v) => `${pct(v)}`}
          rangeLabel="40% – 70%"
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
          options={blockOptions(draft.contain, draft.stepUp)}
          value={draft.contain}
          onChange={(val) => onDraft((d) => ({ ...d, contain: val }))}
          ariaLabel="Containment risk level"
          format={(v) => `${pct(v)}`}
          rangeLabel="60% – 90%"
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
          options={durationOptions(draft.defaultMinutes, draft.maxMinutes)}
          value={draft.defaultMinutes}
          onChange={(val) => onDraft((d) => ({ ...d, defaultMinutes: val }))}
          ariaLabel="Default block duration"
          format={(v) => `${v} min`}
          rangeLabel="5 min – 120 min"
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

      <div className="pol-settings-safeguards-trigger" onClick={() => setSafeguardsOpen((v) => !v)}>
        <span className="pol-settings-row__icon-plate">
          <SlidersHorizontal size={15} />
        </span>
        <div className="pol-settings-row__text">
          <span className="pol-settings-row__label">Advanced safeguards</span>
          <span className="pol-settings-row__sub">
            Limits that cap the maximum impact Sentinel can have.
          </span>
        </div>
        <span className="pol-settings-safeguards-badge">9 safeguards</span>
        {safeguardsOpen ? <CaretDown size={13} /> : <CaretRight size={13} />}
      </div>

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
                  <div className="pol-safeguard-input-wrap">
                    <input
                      type="number"
                      value={draft[s.key] as number}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value || '0');
                        onDraft((d) => ({ ...d, [s.key]: val }) as PolicyDraft);
                      }}
                      className="pol-safeguard-input"
                      aria-label={s.label}
                    />
                    {s.suffix && <span className="pol-safeguard-suffix">{s.suffix}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Card Footer */}
      <div className="pol-settings-card__foot">
        <Info size={14} />
        <span>Change a setting to stage a draft.</span>
      </div>
    </section>
  );
}
