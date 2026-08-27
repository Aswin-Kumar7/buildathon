import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Callout, Card, PageHeader } from '@sentinel/ui';
import {
  policyResponseSchema,
  simulationResponseSchema,
  type PolicyResponse,
  type SimulationResponse,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { actionLabel, rupees } from '../incidents/policy-words.js';
import './PolicyPage.css';

async function fetchPolicy(): Promise<PolicyResponse> {
  const response = await fetch('/api/policy', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return policyResponseSchema.parse(await response.json());
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;

type PolicyDraft = {
  stepUp: number;
  contain: number;
  defaultMinutes: number;
  maxMinutes: number;
  dualApprovalAbovePaise: number;
  maxActiveContainments: number;
  killSwitch: boolean;
};

const yaml = (policy: PolicyResponse, draft: PolicyDraft): string => `version: ${policy.version + 1}
killSwitch: ${draft.killSwitch}
thresholds:
  stepUp: ${draft.stepUp}
  contain: ${draft.contain}
containment:
  defaultMinutes: ${draft.defaultMinutes}
  maxMinutes: ${draft.maxMinutes}
  maxExtensions: ${policy.containment.maxExtensions}
approval:
  dualApprovalAbovePaise: ${draft.dualApprovalAbovePaise}
  containmentAlwaysNeedsApproval: ${policy.approval.containmentAlwaysNeedsApproval}
impactCaps:
  maxActiveContainments: ${draft.maxActiveContainments}
  maxContainmentsPerHour: ${policy.impactCaps.maxContainmentsPerHour}
  maxShareOfActiveSessions: ${policy.impactCaps.maxShareOfActiveSessions}
  shareAppliesAboveSessions: ${policy.impactCaps.shareAppliesAboveSessions}
allowlist:
  sessions: []
  devices: []
  networks: []
degradation:
  maxFeatureAgeMinutes: ${policy.degradation.maxFeatureAgeMinutes}
  requireConfirmedCounts: ${policy.degradation.requireConfirmedCounts}
  refuseWhenArbitrationAbstained: ${policy.degradation.refuseWhenArbitrationAbstained}
costs:
  chargebackPaise: ${policy.costs.chargebackPaise}
  blockedShopperPaise: ${policy.costs.blockedShopperPaise}
  reviewPaise: ${policy.costs.reviewPaise}
`;

// The builder keeps the policy controls and their safety copy together for a merchant review.
// eslint-disable-next-line max-lines-per-function
function Builder({
  policy,
  draft,
  onChange,
  onSimulate,
  pending,
}: {
  policy: PolicyResponse;
  draft: PolicyDraft;
  onChange: (next: PolicyDraft) => void;
  onSimulate: (source: string) => void;
  pending: boolean;
}): React.JSX.Element {
  const update = (key: keyof PolicyDraft, value: string | boolean): void => {
    onChange({ ...draft, [key]: typeof value === 'boolean' ? value : Number(value) });
  };

  return (
    <Card>
      <header className="policy-builder__head">
        <div>
          <h2>Build a candidate policy</h2>
          <p>
            Adjust the controls merchants actually reason about, then preview the impact on recorded
            incidents. This creates no live policy and takes no action.
          </p>
        </div>
        <Badge tone="info">draft v{policy.version + 1}</Badge>
      </header>
      <div className="policy-builder">
        <label>
          <span>Step-up score</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={draft.stepUp}
            onChange={(e) => update('stepUp', e.target.value)}
          />
          <small>Ask for another factor above this attack-support score.</small>
        </label>
        <label>
          <span>Contain score</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={draft.contain}
            onChange={(e) => update('contain', e.target.value)}
          />
          <small>Propose containment above this score; approval is still required.</small>
        </label>
        <label>
          <span>Default containment (minutes)</span>
          <input
            type="number"
            min="1"
            value={draft.defaultMinutes}
            onChange={(e) => update('defaultMinutes', e.target.value)}
          />
        </label>
        <label>
          <span>Maximum containment (minutes)</span>
          <input
            type="number"
            min="1"
            value={draft.maxMinutes}
            onChange={(e) => update('maxMinutes', e.target.value)}
          />
        </label>
        <label>
          <span>Dual approval above (₹)</span>
          <input
            type="number"
            min="0"
            value={draft.dualApprovalAbovePaise / 100}
            onChange={(e) => update('dualApprovalAbovePaise', String(Number(e.target.value) * 100))}
          />
          <small>High-impact containment needs two distinct reviewers.</small>
        </label>
        <label>
          <span>Active containment cap</span>
          <input
            type="number"
            min="0"
            value={draft.maxActiveContainments}
            onChange={(e) => update('maxActiveContainments', e.target.value)}
          />
        </label>
      </div>
      <label className="policy-toggle">
        <input
          type="checkbox"
          checked={draft.killSwitch}
          onChange={(e) => update('killSwitch', e.target.checked)}
        />
        <span>
          <strong>Kill switch</strong>
          <small>Refuse all customer-impacting actions while testing this candidate.</small>
        </span>
      </label>
      <div className="policy-builder__actions">
        <Button
          variant="secondary"
          onClick={() => onSimulate(yaml(policy, draft))}
          disabled={pending}
        >
          {pending ? 'Simulating…' : 'Preview impact'}
        </Button>
        <span className="detail-note">
          The candidate is validated by the same policy engine used for decisions.
        </span>
      </div>
    </Card>
  );
}

function Current({ policy }: { policy: PolicyResponse }): React.JSX.Element {
  return (
    <Card>
      <header className="incident__head">
        <h2>
          Version {policy.version} <code>{policy.hash}</code>
        </h2>
        {policy.killSwitch && <Badge tone="critical">kill switch engaged</Badge>}
      </header>

      <dl className="incident__facts">
        <div>
          <dt>Ask for another factor at</dt>
          <dd>{pct(policy.thresholds.stepUp)}</dd>
        </div>
        <div>
          <dt>Refuse attempts at</dt>
          <dd>{pct(policy.thresholds.contain)}</dd>
        </div>
        <div>
          <dt>Containment lasts</dt>
          <dd>{policy.containment.defaultMinutes} min</dd>
        </div>
        <div>
          <dt>Never longer than</dt>
          <dd>{policy.containment.maxMinutes} min</dd>
        </div>
        <div>
          <dt>Two people needed above</dt>
          <dd>{rupees(policy.approval.dualApprovalAbovePaise)}</dd>
        </div>
        <div>
          <dt>At most, contained at once</dt>
          <dd>{policy.impactCaps.maxActiveContainments}</dd>
        </div>
        <div>
          <dt>Features must be fresher than</dt>
          <dd>{policy.degradation.maxFeatureAgeMinutes} min</dd>
        </div>
        <div>
          <dt>Allowlisted</dt>
          <dd>
            {policy.allowlisted.sessions + policy.allowlisted.devices + policy.allowlisted.networks}{' '}
            entries
          </dd>
        </div>
      </dl>

      <p className="incident__band">
        Edited in <code>policy.yaml</code> and nowhere else. A policy that can be changed from a
        console is one whose history lives in a table nobody diffs — this one is reviewed and
        reverted like any other change, and every decision records the version that produced it.
      </p>
    </Card>
  );
}

function Results({ result }: { result: SimulationResponse }): React.JSX.Element {
  if (result.problems.length > 0) {
    return (
      <Callout tone="critical" title="That policy is not usable">
        <ul className="abstentions">
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </Callout>
    );
  }

  return (
    <>
      <dl className="incident__facts">
        <div>
          <dt>Incidents considered</dt>
          <dd>{result.summary.considered}</dd>
        </div>
        <div>
          <dt>Decisions changed</dt>
          <dd>{result.summary.changed}</dd>
        </div>
        <div>
          <dt>Newly contained</dt>
          <dd className={result.summary.newlyContained > 0 ? 'is-nervous' : undefined}>
            {result.summary.newlyContained}
          </dd>
        </div>
        <div>
          <dt>No longer contained</dt>
          <dd>{result.summary.newlyReleased}</dd>
        </div>
      </dl>

      {/* Called out on its own rather than folded into "changed": more containment is the
          direction that costs somebody their checkout, and it is what a person should have to
          look at before shipping an edit. */}
      {result.summary.newlyContained > 0 && (
        <Callout tone="warn" title="This would block people it does not block today">
          <p>
            {result.summary.newlyContained} of {result.summary.considered} would newly be refused.
            Each one is a shopper who gets through now and would not.
          </p>
        </Callout>
      )}

      <table className="simulation">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Now</th>
            <th>Would be</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.incidentId} className={row.changed ? 'is-changed' : undefined}>
              <td>
                {row.entityKind} <code>{row.entityKey.replace(/^v\d+:/, '').slice(0, 10)}</code>
              </td>
              <td>{actionLabel(row.current.action)}</td>
              <td>{actionLabel(row.proposed.action)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// eslint-disable-next-line max-lines-per-function
export function PolicyPage(): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [structuredDraft, setStructuredDraft] = useState<PolicyDraft | null>(null);
  const policy = useQuery({ queryKey: ['policy'], queryFn: fetchPolicy });

  useEffect(() => {
    if (policy.data === undefined || structuredDraft !== null) return;
    setStructuredDraft({
      stepUp: policy.data.thresholds.stepUp,
      contain: policy.data.thresholds.contain,
      defaultMinutes: policy.data.containment.defaultMinutes,
      maxMinutes: policy.data.containment.maxMinutes,
      dualApprovalAbovePaise: policy.data.approval.dualApprovalAbovePaise,
      maxActiveContainments: policy.data.impactCaps.maxActiveContainments,
      killSwitch: policy.data.killSwitch,
    });
  }, [policy.data, structuredDraft]);

  const simulate = useMutation({
    mutationFn: async (source: string) => {
      const response = await fetch('/api/policy/simulate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ policy: source }),
      });
      if (!response.ok) throw new Error(`api returned ${response.status}`);
      return simulationResponseSchema.parse(await response.json());
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Govern"
        title="Policies"
        description="Everything the system is allowed to do to a shopper. Five actions, all reversible, all expiring; containment never happens without a person agreeing, and nothing at all happens while the kill switch is engaged."
      />

      {policy.isError && (
        <Callout tone="critical" title="Could not load the policy">
          <p role="alert">{policy.error.message}</p>
        </Callout>
      )}
      {policy.isPending && <p role="status">Loading policy…</p>}
      {policy.data !== undefined && <Current policy={policy.data} />}

      {policy.data !== undefined && structuredDraft !== null && (
        <Builder
          policy={policy.data}
          draft={structuredDraft}
          onChange={setStructuredDraft}
          onSimulate={(source) => {
            setDraft(source);
            simulate.mutate(source);
          }}
          pending={simulate.isPending}
        />
      )}

      <Card>
        <h2>Advanced candidate editor</h2>
        <p>
          Review or edit the full validated document when you need to change settings beyond the
          guided controls. Nothing is saved and nothing is acted on — this only answers what it{' '}
          <em>would</em> have decided against incidents that already happened.
        </p>

        <label className="policy-editor">
          <span>Candidate policy</span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={12}
            spellCheck={false}
            placeholder={
              'version: 1\nkillSwitch: false\nthresholds:\n  stepUp: 0.55\n  contain: 0.75\n…'
            }
          />
        </label>

        <Button
          variant="ghost"
          onClick={() => simulate.mutate(draft)}
          disabled={simulate.isPending || draft.trim() === ''}
        >
          {simulate.isPending ? 'Simulating…' : 'Simulate'}
        </Button>

        {simulate.isError && <p role="alert">{simulate.error.message}</p>}
        {simulate.data !== undefined && <Results result={simulate.data} />}
      </Card>
    </>
  );
}
