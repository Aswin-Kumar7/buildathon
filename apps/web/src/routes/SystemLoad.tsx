import { useQuery } from '@tanstack/react-query';
import { Badge, Callout, Card } from '@sentinel/ui';
import {
  systemHealthResponseSchema,
  type CriticalityDto,
  type PercentilesDto,
  type SystemHealthDto,
} from '@sentinel/contracts';

const REFRESH_MS = 2_000;

async function fetchLoad(): Promise<SystemHealthDto> {
  const response = await fetch('/api/system/health', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return systemHealthResponseSchema.parse(await response.json()).health;
}

const TIER_LABEL: Record<CriticalityDto, string> = {
  CRITICAL_PLUS: 'Ingestion (never shed)',
  CRITICAL: 'Decision (degrades in place)',
  SHEDDABLE_PLUS: 'Model & enrichment',
  SHEDDABLE: 'Narration & polling',
};

const ms = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value.toFixed(1)}ms`;

function Row({ label, p }: { label: string; p: PercentilesDto }): React.JSX.Element {
  return (
    <tr>
      <td>{label}</td>
      <td>{p.count.toLocaleString('en-IN')}</td>
      <td>{ms(p.p50)}</td>
      <td>{ms(p.p95)}</td>
      <td>{ms(p.p99)}</td>
      <td>{ms(p.p999)}</td>
      <td>{ms(p.max)}</td>
    </tr>
  );
}

function Tiers({ h }: { h: SystemHealthDto }): React.JSX.Element {
  const shedding = new Set(h.shedding);
  const tiers: CriticalityDto[] = ['CRITICAL_PLUS', 'CRITICAL', 'SHEDDABLE_PLUS', 'SHEDDABLE'];
  return (
    <>
      <h3>Shedding now</h3>
      <ul className="load__tiers">
        {tiers.map((tier) => (
          <li key={tier} className={shedding.has(tier) ? 'is-shedding' : ''}>
            <span className="load__tier-name">{TIER_LABEL[tier]}</span>
            <span className="load__tier-state">
              {tier === 'CRITICAL_PLUS' || tier === 'CRITICAL' ? (
                <Badge tone="ok">protected</Badge>
              ) : shedding.has(tier) ? (
                <Badge tone="warn">shedding</Badge>
              ) : (
                <Badge tone="neutral">serving</Badge>
              )}{' '}
              <span className="load__counts">
                ran {(h.ran[tier] ?? 0).toLocaleString('en-IN')} · shed{' '}
                {(h.shed[tier] ?? 0).toLocaleString('en-IN')}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function LatencySplit({ h }: { h: SystemHealthDto }): React.JSX.Element {
  return (
    <>
      <h3>Latency, split by stage</h3>
      <div className="audit-table-wrap">
        <table className="metrics-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>n</th>
              <th>p50</th>
              <th>p95</th>
              <th>p99</th>
              <th>p99.9</th>
              <th>max</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Ingestion (CRITICAL_PLUS)" p={h.ingestion} />
            <Row label="Feature fetch" p={h.featureFetch} />
            <Row label="Inference" p={h.inference} />
            <Row label="Warm path, end to end" p={h.warmPath} />
          </tbody>
        </table>
      </div>
      <p className="load__note">
        The interesting term is the feature fetch, not the model — the online-store read dominates
        the warm path, which is why the model was never the thing that had to be fast. Ingestion
        sits outside the worker pool, so its latency stays flat while the warm path queues.
      </p>
    </>
  );
}

/**
 * System behaviour under load, refreshed live so shedding is visible as it happens.
 *
 * The story this tells in one screen: which tiers are being shed right now, the three-way latency
 * split the report is built from, and — the point of the whole design — that ingestion latency stays
 * flat while the warm path degrades, because ingestion is the one tier that is never shed.
 */
export function SystemLoad(): React.JSX.Element {
  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchLoad,
    refetchInterval: REFRESH_MS,
  });

  if (health.isError) {
    return (
      <Callout tone="critical" title="Could not read system load">
        <p role="alert">{health.error.message}</p>
      </Callout>
    );
  }
  if (health.data === undefined) return <p role="status">Reading system load…</p>;

  const h = health.data;
  const breached = h.warmPath.p99 > h.sloMs;

  return (
    <section className="load">
      <div className="load__head">
        <h2>Under load</h2>
        <Badge tone={breached ? 'warn' : 'ok'}>
          warm p99 {ms(h.warmPath.p99)} / SLO {ms(h.sloMs)}
        </Badge>
      </div>

      <Card>
        <div className="load__signals">
          <div>
            <dt>In flight</dt>
            <dd>{h.inFlight}</dd>
          </div>
          <div>
            <dt>Queue depth</dt>
            <dd className={h.queueDepth > 0 ? 'is-hot' : ''}>{h.queueDepth}</dd>
          </div>
          <div>
            <dt>Worker pool</dt>
            <dd>{h.poolSize}</dd>
          </div>
        </div>

        <Tiers h={h} />
        <LatencySplit h={h} />
      </Card>
    </section>
  );
}
