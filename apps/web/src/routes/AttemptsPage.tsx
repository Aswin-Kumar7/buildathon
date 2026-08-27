import { useQuery } from '@tanstack/react-query';
import { Badge, Callout, Card } from '@sentinel/ui';
import {
  ordersResponseSchema,
  type OrdersResponse,
  type ResolvedAttempt,
  type ResolvedOrder,
  type SensorContext,
  type UnresolvedAttempt,
} from '@sentinel/contracts';
import './AttemptsPage.css';

async function fetchAttempts(): Promise<OrdersResponse> {
  const params = new URLSearchParams(window.location.search);
  const query = params.toString();
  const response = await fetch(`/api/attempts${query === '' ? '' : `?${query}`}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return ordersResponseSchema.parse(await response.json());
}

const rupees = (paise: number | null): string =>
  paise === null
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** Seconds between two attempts, so the gap a shopper actually waited is visible. */
function gap(from: string, to: string): string {
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  if (seconds < 60) return `${seconds}s later`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m later`;
  return `${Math.round(seconds / 3600)}h later`;
}

const TONE: Record<string, 'ok' | 'warn' | 'critical' | 'neutral'> = {
  captured: 'ok',
  refunded: 'warn',
  authorized: 'warn',
  failed: 'critical',
  created: 'neutral',
};

function Fingerprints({ sensor }: { sensor: SensorContext }): React.JSX.Element {
  return (
    <dl className="fingerprints">
      <div>
        <dt>Session</dt>
        <dd>{sensor.sessionFingerprint}</dd>
      </div>
      <div>
        <dt>Device</dt>
        <dd>{sensor.deviceFingerprint}</dd>
      </div>
      <div>
        <dt>Network</dt>
        <dd>{sensor.ipFingerprint}</dd>
      </div>
      <div>
        <dt>Client</dt>
        <dd>{sensor.userAgentFamily}</dd>
      </div>
    </dl>
  );
}

function Attempt({
  attempt,
  previous,
}: {
  attempt: ResolvedAttempt;
  previous: ResolvedAttempt | undefined;
}): React.JSX.Element {
  const tone = TONE[attempt.status] ?? 'neutral';

  return (
    <li className={`attempt attempt--${tone}`}>
      <span className="attempt__dot" aria-hidden="true" />

      <div className="attempt__body">
        <p className="attempt__head">
          <strong>{attempt.status}</strong>
          <span className="attempt__id">{attempt.razorpayPaymentId}</span>
          <span className="attempt__time">{clock(attempt.firstSeenAt)}</span>
          {previous !== undefined && (
            <span className="attempt__gap">{gap(previous.lastSeenAt, attempt.firstSeenAt)}</span>
          )}
        </p>

        <p className="attempt__meta">
          {[attempt.method, attempt.cardNetwork, attempt.cardIssuer].filter(Boolean).join(' · ') ||
            'no method recorded'}
          {attempt.eventCount > 1 && ` · ${attempt.eventCount} events`}
          {attempt.late && ' · arrived late'}
        </p>

        {/*
          Shown even when the attempt ended up captured. A recovery is only legible if the
          thing it recovered from is still on the record.
        */}
        {attempt.failure !== null && (
          <p className="attempt__failure">
            {attempt.failure.reason ?? attempt.failure.code ?? 'failed'}
            {attempt.failure.step !== null && <span> · {attempt.failure.step}</span>}
            {attempt.failure.source !== null && <span> · blamed on {attempt.failure.source}</span>}
          </p>
        )}
      </div>
    </li>
  );
}

function Order({ order }: { order: ResolvedOrder }): React.JSX.Element {
  return (
    <Card>
      <header className="order__head">
        <div>
          <p className="order__id">{order.razorpayOrderId}</p>
          <p className="order__amount">{rupees(order.amountPaise)}</p>
        </div>

        <div className="order__badges">
          {order.recovered ? (
            <Badge tone="ok">recovered</Badge>
          ) : (
            <Badge
              tone={
                order.outcome === 'paid' ? 'ok' : order.outcome === 'failed' ? 'critical' : 'warn'
              }
            >
              {order.outcome}
            </Badge>
          )}
          {order.attempts.length > 1 && (
            <Badge tone="neutral">{order.attempts.length} attempts</Badge>
          )}
        </div>
      </header>

      {/*
        Stated in words, not left to the reader to infer from a green badge next to a red dot.
        A shopper declined once who then paid is a customer who had a bad minute; an order
        with the same two dots and no recovery is the opposite, and the difference is the
        entire point of resolving state rather than counting failures.
      */}
      {order.recovered && (
        <p className="order__recovery">
          Failed {order.failureCount === 1 ? 'once' : `${order.failureCount} times`}, then paid.
          Treated as a recovery, not as {order.failureCount === 1 ? 'a failure' : 'failures'}.
        </p>
      )}

      <ol className="timeline">
        {order.attempts.map((attempt, index) => (
          <Attempt
            key={attempt.razorpayPaymentId}
            attempt={attempt}
            previous={order.attempts[index - 1]}
          />
        ))}
      </ol>

      {order.sensor !== null && <Fingerprints sensor={order.sensor} />}
    </Card>
  );
}

function Unresolved({
  items,
  allowedLatenessMinutes,
}: {
  items: UnresolvedAttempt[];
  allowedLatenessMinutes: number;
}): React.JSX.Element {
  return (
    <section>
      <h2>Unresolved checkouts</h2>
      <Callout tone="warn" title={`${items.length} started and never settled`}>
        <p>
          An order was created and no terminal payment event followed, more than{' '}
          {allowedLatenessMinutes} minutes ago. Recorded as unresolved rather than assumed to have
          failed &mdash; inventing a failure that never happened is the last thing a detector keyed
          on failure counts should do. Closing the tab before paying leaves exactly this trace.
        </p>
      </Callout>

      <ul className="unresolved">
        {items.map((item) => (
          <li key={item.razorpayOrderId}>
            <span className="unresolved__id">{item.razorpayOrderId}</span>
            <span>{rupees(item.amountPaise)}</span>
            <span className="muted">{item.ageMinutes}m ago</span>
            {item.sensor !== null && <span className="muted">{item.sensor.userAgentFamily}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AttemptsPage(): React.JSX.Element {
  const filter = new URLSearchParams(window.location.search);
  const hasFilter = filter.has('entityKind') && filter.has('entityKey');
  const attempts = useQuery({
    queryKey: ['attempts', filter.toString()],
    queryFn: fetchAttempts,
    refetchInterval: 10_000,
  });

  return (
    <>
      <header className="page-head">
        <h1>Payment attempts</h1>
        <p>
          Reconstructed from the event history, not from the order events arrived in. The same
          events in any sequence, with any duplicates, across a restart, resolve to what you see
          here.
        </p>
        {hasFilter && (
          <p className="attempts-filter">
            Showing attempts related to this {filter.get('entityKind')} incident activity.{' '}
            <a href="/console/attempts">Clear filter</a>
          </p>
        )}
      </header>

      {attempts.isError && (
        <Callout tone="critical" title="Could not read payment attempts">
          <p role="alert">{attempts.error.message}</p>
        </Callout>
      )}

      {attempts.isPending && <p role="status">Resolving attempts…</p>}

      {attempts.data !== undefined && attempts.data.orders.length === 0 && (
        <Callout tone="neutral" title="No payment events yet">
          <p>
            Make a payment through the storefront and it will appear here. Nothing is invented in
            the meantime.
          </p>
        </Callout>
      )}

      {attempts.data !== undefined && attempts.data.orders.length > 0 && (
        <section className="orders">
          {attempts.data.orders.map((order) => (
            <Order key={order.razorpayOrderId} order={order} />
          ))}
        </section>
      )}

      {attempts.data !== undefined && attempts.data.unresolved.length > 0 && (
        <Unresolved
          items={attempts.data.unresolved}
          allowedLatenessMinutes={attempts.data.allowedLatenessMinutes}
        />
      )}
    </>
  );
}
