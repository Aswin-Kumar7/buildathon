import { useEffect, useState } from 'react';
import { healthSchema, type Health } from '@sentinel/contracts';

type State =
  { kind: 'loading' } | { kind: 'ready'; health: Health } | { kind: 'error'; message: string };

export function App(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/health');
        if (!response.ok) throw new Error(`api returned ${response.status}`);
        const health = healthSchema.parse(await response.json());
        if (!cancelled) setState({ kind: 'ready', health });
      } catch (error) {
        if (!cancelled) {
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'unknown' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>Sentinel</h1>
      <p>Merchant-side payment-attempt incident detection.</p>
      {state.kind === 'loading' && <p role="status">Checking API…</p>}
      {state.kind === 'error' && <p role="alert">API unreachable: {state.message}</p>}
      {state.kind === 'ready' && (
        <dl>
          <dt>status</dt>
          <dd>{state.health.status}</dd>
          <dt>version</dt>
          <dd>{state.health.version}</dd>
          <dt>commit</dt>
          <dd>{state.health.commit}</dd>
        </dl>
      )}
    </main>
  );
}
