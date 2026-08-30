import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** open = the full panel; minimized = a chip near Run simulation; hidden = nothing. */
export type SimView = 'open' | 'minimized' | 'hidden';

interface SimDock {
  view: SimView;
  open: () => void;
  minimize: () => void;
  dismiss: () => void;
}

const SimDockContext = createContext<SimDock | null>(null);

/** Control the simulation panel's view, held above the page so it survives leaving Incidents. */
export function useSimDock(): SimDock {
  const ctx = useContext(SimDockContext);
  if (ctx === null) throw new Error('useSimDock must be used within a SimDockProvider');
  return ctx;
}

/**
 * Keeps the simulation panel's open/minimized state at the shell level.
 *
 * The panel itself is rendered only on the Incidents page — it does not float over other screens.
 * But its state lives here so navigating away from Incidents and back does not reset it: a run
 * minimized to a chip is still a chip on return, and a panel left open is still open.
 */
export function SimDockProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [view, setView] = useState<SimView>('hidden');
  const open = useCallback(() => setView('open'), []);
  const minimize = useCallback(() => setView('minimized'), []);
  const dismiss = useCallback(() => setView('hidden'), []);
  const value = useMemo<SimDock>(
    () => ({ view, open, minimize, dismiss }),
    [view, open, minimize, dismiss],
  );

  return <SimDockContext.Provider value={value}>{children}</SimDockContext.Provider>;
}
