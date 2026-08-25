import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Callout, Card } from '@sentinel/ui';
import {
  featureRankResponseSchema,
  type DistinctEstimateDto,
  type FeatureRankResponse,
  type FeatureVectorDto,
} from '@sentinel/contracts';
import './FeaturesPage.css';

type EntityKind = FeatureVectorDto['entityKind'];
type Source = FeatureRankResponse['source'];

const SOURCE_LABEL: Record<Source, string> = {
  all: 'Both',
  razorpay: 'Real traffic',
  replay: 'Replayed',
};

async function fetchFeatures(kind: EntityKind, source: Source): Promise<FeatureRankResponse> {
  const response = await fetch(`/api/features/${kind}?source=${source}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  // Parsed, not cast. A vector that arrived malformed should fail here, loudly, rather than
  // render as a plausible-looking number nobody can trace.
  return featureRankResponseSchema.parse(await response.json());
}

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;

function ago(from: number, to: number): string {
  const seconds = Math.max(Math.round((to - from) / 1000), 0);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
const num = (value: number): string => value.toFixed(2);
const rupees = (paise: number | null): string =>
  paise === null ? '—' : `₹${(paise / 100).toFixed(2)}`;

/**
 * A sketch-derived count, shown with its uncertainty and its confirmation side by side.
 *
 * The estimate is never presented alone. It exists to find candidates cheaply; the exact
 * figure beside it is what a decision is allowed to rest on, and showing both is the only way
 * a reader can tell which they are looking at.
 */
function Distinct({
  label,
  value,
}: {
  label: string;
  value: DistinctEstimateDto;
}): React.JSX.Element {
  return (
    <div className="feature feature--sketch">
      <dt>{label}</dt>
      <dd>
        <span className="feature__exact">{value.exact ?? '—'}</span>
        <span className="feature__estimate">
          sketch {value.estimate} ±{value.errorBound}
        </span>
      </dd>
      <p className="feature__note">
        {value.exact === null
          ? 'Estimate only — not confirmed, so not decidable on'
          : value.exact === value.estimate
            ? 'Sketch agreed with the exact count'
            : `Sketch was ${value.estimate > value.exact ? 'over' : 'under'} by ${Math.abs(value.estimate - value.exact)}`}
      </p>
    </div>
  );
}

function Feature({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}): React.JSX.Element {
  return (
    <div className="feature">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note !== undefined && <p className="feature__note">{note}</p>}
    </div>
  );
}

function Vector({ vector }: { vector: FeatureVectorDto }): React.JSX.Element {
  const windowMinutes = Math.round(vector.window.windowMs / 60_000);
  const halfLifeMinutes = Math.round(vector.window.halfLifeMs / 60_000);

  return (
    <Card>
      <header className="vector__head">
        <code>{vector.entityKey.replace(/^v\d+:/, '').slice(0, 16)}</code>
        <div className="vector__badges">
          <Badge tone="neutral">{vector.entityKind}</Badge>
          {vector.recoveredOrders > 0 && (
            <Badge tone="ok">{vector.recoveredOrders} recovered</Badge>
          )}
          {vector.infrastructureFailureShare > 0.7 && vector.failures > 3 && (
            <Badge tone="warn">infrastructure</Badge>
          )}
        </div>
      </header>

      <p className="vector__window">
        {windowMinutes}-minute window, {halfLifeMinutes}-minute half-life. Rates are decayed, so a
        burst that stopped fades rather than dropping off a cliff.{' '}
        {vector.lastSeenAt === null
          ? 'Nothing from this entity inside the window.'
          : `Last attempt ${ago(vector.lastSeenAt, vector.asOf)}.`}
      </p>

      <dl className="features">
        <Feature label="Attempts" value={String(vector.attempts)} />
        <Feature label="Failures" value={String(vector.failures)} />
        <Feature label="Attempts / min" value={num(vector.attemptRate)} note="Decayed" />
        <Feature label="Failures / min" value={num(vector.failureRate)} note="Decayed" />

        <Distinct label="Distinct cards" value={vector.distinctCards} />
        <Distinct label="Distinct sessions" value={vector.distinctSessions} />
        <Distinct label="Distinct networks" value={vector.distinctNetworks} />

        <Feature
          label="Approval rate"
          value={pct(vector.approvalRate)}
          note="Attacks sit far below anything honest traffic reaches"
        />
        <Feature
          label="Infrastructure share"
          value={pct(vector.infrastructureFailureShare)}
          note="Failures Razorpay blamed on its gateway. A bank refusing a card is not counted — that is what enumeration produces."
        />
        <Feature
          label="Reason concentration"
          value={num(vector.reasonConcentration)}
          note="1 means every decline had the same reason"
        />
        <Feature label="Median amount" value={rupees(vector.medianAmountPaise)} />
        <Feature
          label="Small amounts"
          value={pct(vector.smallAmountShare)}
          note="Share at or below ₹50 — the probe signature"
        />
        <Feature
          label="Burstiness"
          value={num(vector.burstiness)}
          note="Near 0 is a machine on a timer; near 1 is independent arrivals"
        />
        <Feature
          label="Recovery rate"
          value={pct(vector.recoveryRate)}
          note="Orders that failed and were then paid — the mitigating signal"
        />
      </dl>
    </Card>
  );
}

function Pickers({
  kind,
  setKind,
  source,
  setSource,
}: {
  kind: EntityKind;
  setKind: (kind: EntityKind) => void;
  source: Source;
  setSource: (source: Source) => void;
}): React.JSX.Element {
  return (
    <div className="pickers">
      <div className="kinds" role="group" aria-label="Entity kind">
        {(['session', 'device', 'network'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={option === kind ? 'is-current' : undefined}
            aria-pressed={option === kind}
            onClick={() => setKind(option)}
          >
            {option}
          </button>
        ))}
      </div>

      {/*
        Real and replayed traffic are separable here for the same reason they are counted apart
        on the health page: replayed events must never pass as evidence the system works against
        Razorpay. It also keeps the window usable — the corpus carries timestamps from months
        ago, so a single live attempt anchors the window to now and would hide every replayed
        scenario behind it.
      */}
      <div className="kinds" role="group" aria-label="Traffic">
        {(['all', 'razorpay', 'replay'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={option === source ? 'is-current' : undefined}
            aria-pressed={option === source}
            onClick={() => setSource(option)}
          >
            {SOURCE_LABEL[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Results({ data }: { data: FeatureRankResponse }): React.JSX.Element {
  return (
    <>
      {/*
        The two-pass split, said out loud. A sketch is cheap enough to run over everything and
        too approximate to decide on, so it narrows the field and the exact path confirms what
        survives.
      */}
      <Callout tone="neutral" title="Estimated to find, exact to decide">
        <p>
          {data.candidates} entities seen; the {data.vectors.length} most worth a look are shown
          with their counts re-derived exactly. Sketch figures appear beside the confirmed ones with
          their error bound, never instead of them.
        </p>
      </Callout>

      {/*
        Said plainly rather than left to be inferred. A replayed scenario carries the timestamps
        it was recorded with, so its rates are real but historical, and a page that presented
        them as live would be lying by omission.
      */}
      {data.basis === 'last-activity' && (
        <Callout tone="warn" title="Evaluated as of the last activity, not now">
          <p>
            Nothing has arrived within the last{' '}
            {Math.round((data.vectors[0]?.window.windowMs ?? 0) / 60_000)} minutes, so these are
            computed as of {new Date(data.asOf).toLocaleString()} — the moment of the newest event (
            {ago(data.asOf, data.generatedAt)}). Rates describe that moment, not this one.
          </p>
        </Callout>
      )}

      <section className="vectors">
        {data.vectors.map((vector) => (
          <Vector key={vector.entityKey} vector={vector} />
        ))}
      </section>
    </>
  );
}

export function FeaturesPage(): React.JSX.Element {
  const [kind, setKind] = useState<EntityKind>('session');
  const [source, setSource] = useState<Source>('all');
  const features = useQuery({
    queryKey: ['features', kind, source],
    queryFn: () => fetchFeatures(kind, source),
    refetchInterval: 15_000,
  });

  return (
    <>
      <header className="page-head">
        <h1>Feature inspector</h1>
        <p>
          Everything the detector will read, for the entity a containment decision would act on.
          Computed as of a moment rather than from a clock, so a decision taken on these numbers can
          be replayed and reach the same answer.
        </p>
      </header>

      <Pickers kind={kind} setKind={setKind} source={source} setSource={setSource} />

      {features.isError && (
        <Callout tone="critical" title="Could not compute features">
          <p role="alert">{features.error.message}</p>
        </Callout>
      )}

      {features.isPending && <p role="status">Computing features…</p>}

      {features.data !== undefined && features.data.vectors.length === 0 && (
        <Callout tone="neutral" title="Nothing to compute from">
          <p>
            {source === 'razorpay'
              ? 'No real payment events. Make a payment through the storefront, or switch to replayed traffic.'
              : 'No payment events to compute from. Replay a scenario, or make a payment through the storefront.'}
          </p>
        </Callout>
      )}

      {features.data !== undefined && features.data.vectors.length > 0 && (
        <Results data={features.data} />
      )}
    </>
  );
}
