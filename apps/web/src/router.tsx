import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { fetchMe } from './auth/api.js';
import { SESSION_KEY } from './auth/useSession.js';
import { Landing } from './landing/Landing.js';
import { LoginPage } from './routes/LoginPage.js';
import { OverviewPage } from './routes/OverviewPage.js';
import { HealthPage } from './routes/HealthPage.js';
import { AttemptsPage } from './routes/AttemptsPage.js';
import { ScenariosPage } from './routes/ScenariosPage.js';
import { FeaturesPage } from './routes/FeaturesPage.js';
import { IncidentsPage } from './routes/IncidentsPage.js';
import { IncidentDetailPage } from './routes/IncidentDetailPage.js';
import { AppShell } from './shell/AppShell.js';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const rootRoute = createRootRoute({ component: Outlet });

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Landing,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
});

/**
 * The guard runs before the protected tree renders, so a signed-out visitor never sees a
 * flash of console chrome. The intended destination travels in the query string and is
 * restored after signing in.
 */
const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/console',
  beforeLoad: async ({ location }) => {
    const session = await queryClient.ensureQueryData({
      queryKey: SESSION_KEY,
      queryFn: fetchMe,
    });

    if (session.user === null) {
      throw redirect({ to: '/login', search: { redirect: location.pathname } });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const overviewRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/',
  component: OverviewPage,
});

const healthRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/health',
  component: HealthPage,
});

const attemptsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/attempts',
  component: AttemptsPage,
});

const featuresRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/features',
  component: FeaturesPage,
});

const incidentsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/incidents',
  component: IncidentsPage,
});

const incidentDetailRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/incidents/$id',
  component: IncidentDetailPage,
});

const scenariosRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: '/scenarios',
  component: ScenariosPage,
});

const routeTree = rootRoute.addChildren([
  landingRoute,
  loginRoute,
  consoleRoute.addChildren([
    overviewRoute,
    attemptsRoute,
    featuresRoute,
    incidentsRoute,
    incidentDetailRoute,
    scenariosRoute,
    healthRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
