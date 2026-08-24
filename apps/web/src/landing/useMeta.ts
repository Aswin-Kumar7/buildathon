import { useEffect, useState } from 'react';
import { metaSchema, type Meta } from '@sentinel/contracts';

export type MetaState =
  { kind: 'loading' } | { kind: 'ready'; meta: Meta } | { kind: 'error'; message: string };

/** Reads project metadata from the API so the page cannot claim more than the system does. */
export function useMeta(): MetaState {
  const [state, setState] = useState<MetaState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/meta');
        if (!response.ok) throw new Error(`api returned ${response.status}`);
        const meta = metaSchema.parse(await response.json());
        if (!cancelled) setState({ kind: 'ready', meta });
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'unknown error',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
