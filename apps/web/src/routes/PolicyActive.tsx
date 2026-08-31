import { Badge } from '@sentinel/ui';
import type { PolicyResponse, PolicyVersion } from '@sentinel/contracts';
import { STATUS_LABEL, STATUS_TONE } from './policy-draft.js';
import { fmtDateTime } from './policy-ui.js';

/**
 * The active policy — the exact document the engine is deciding on, matched to its governance record
 * by hash. This card is read-only: it is a statement of what is live, not a place to change it.
 *
 * There is no kill-switch toggle here. Stopping Sentinel is the Kill switch card above (an instant,
 * block-releasing emergency stop); the reviewed policy's own killSwitch field is surfaced only when
 * it is actually set, so a rare true value is never hidden — but it is never presented as a live
 * control, because changing it means publishing a new policy, and it does not release live blocks.
 */
export function ActivePolicyCard({
  policy,
  versions,
}: {
  policy: PolicyResponse;
  versions: PolicyVersion[];
}): React.JSX.Element {
  const record = versions.find((version) => version.hash === policy.hash) ?? null;

  return (
    <section className="pol-card pol-active">
      <header className="pol-active__head">
        <h2>Active policy</h2>
        {record !== null ? (
          <Badge tone={STATUS_TONE[record.status]}>{STATUS_LABEL[record.status]}</Badge>
        ) : (
          <Badge tone="neutral">From file</Badge>
        )}
      </header>
      <dl className="pol-active__facts">
        <Fact term="Version" value={`v${policy.version}`} />
        <Fact term="Published on" value={fmtDateTime(record?.publishedAt ?? null)} />
        <Fact term="Approved by" value={record?.approvedByName ?? record?.createdByName ?? '—'} />
        <Fact term="Policy hash" value={<code>{policy.hash}</code>} mono />
      </dl>
      {policy.killSwitch && (
        <p className="pol-active__note" role="status">
          This published policy has its kill-switch field set on, so under it Sentinel takes no
          action. Changing that means publishing a new policy — it is separate from the instant Kill
          switch above.
        </p>
      )}
    </section>
  );
}

function Fact({
  term,
  value,
  mono,
}: {
  term: string;
  value: React.ReactNode;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="pol-fact">
      <dt>{term}</dt>
      <dd className={mono ? 'pol-fact__mono' : undefined}>{value}</dd>
    </div>
  );
}
