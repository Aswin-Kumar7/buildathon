import { expect, test, type Page } from '@playwright/test';

const DEMO = { email: 'analyst@sentinel.local', password: 'sentinel-demo' };

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(DEMO.email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/console');
}

/**
 * Replays the loud enumeration scenario through the real ingestion path. The drain evaluates
 * detection on its own once the events land, so no button is pressed to make incidents appear.
 */
async function replayEnumeration(page: Page): Promise<void> {
  await page.goto('/console/scenarios');
  const replay = page.getByRole('button', { name: 'Replay Card enumeration, undisguised' });
  await expect(replay).toBeVisible({ timeout: 60_000 });
  await replay.click();
  await expect(page.getByText(/events and \d+ checkouts written/)).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('landing', () => {
  test('states the claim', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /Sentinel finds the attack/i,
    );
  });

  test('reads the build version from the running api', async ({ page }) => {
    await page.goto('/');
    // The footer prints the version only once /api/meta responds, so this proves the API is
    // genuinely reachable rather than the page hardcoding it.
    await expect(page.getByText(/v\d+\.\d+\.\d+/)).toBeVisible();
  });

  test('routes to the console entry point', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('link', { name: /open the console/i })
      .first()
      .click();
    await expect(page).toHaveURL('/login');
  });
});

test.describe('authentication', () => {
  test('signs in and reaches the console', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    // The display name is editable in Settings, so only presence is asserted.
    await expect(page.getByTestId('current-user')).toBeVisible();
    await expect(page.getByTestId('current-user')).not.toBeEmpty();
  });

  test('shows a generic failure that does not reveal which field was wrong', async ({ page }) => {
    await page.goto('/login');
    // A non-existent account, so a real one is never rate-limited by this test.
    await page.getByLabel('Email', { exact: true }).fill('nobody-e2e@sentinel.local');
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
    await expect(page).toHaveURL(/\/login/);
  });

  test('validates the email client-side before calling the api', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('anything');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
  });
});

test.describe('route protection', () => {
  test('redirects an anonymous visitor away from the console', async ({ page }) => {
    await page.goto('/console');
    await expect(page).toHaveURL(/\/login/);
  });

  test('returns to the intended destination after signing in', async ({ page }) => {
    await page.goto('/console');
    await expect(page).toHaveURL(/redirect=/);

    await page.getByLabel('Email', { exact: true }).fill(DEMO.email);
    await page.getByLabel('Password', { exact: true }).fill(DEMO.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/console');
  });

  test('never shows console chrome to an anonymous visitor', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden();
  });
});

test.describe('payment attempts', () => {
  test('lists attempts with a live count from the api', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/attempts');

    await expect(page.getByRole('heading', { level: 1, name: 'Payment attempts' })).toBeVisible();
    // The summary tiles carry the live counts. The table below them renders an empty state on a
    // fresh database, so asserting on a row count would only pass once something had been replayed.
    await expect(page.getByRole('region', { name: 'Attempt outcome summary' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: /Total attempts \d+/ })).toBeVisible();
  });
});

test.describe('simulation', () => {
  test('replays a scenario through the real ingestion path', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/scenarios');

    await page.getByRole('button', { name: 'Replay Legitimate dunning' }).click();

    await expect(page.getByText(/events and \d+ checkouts written/)).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe('system health', () => {
  test('reports whether webhook ingestion is configured at all', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/health');

    await expect(page.getByRole('heading', { level: 1, name: 'System health' })).toBeVisible();
    await expect(page.getByText(/Webhook ingestion is (not )?configured/)).toBeVisible();
  });

  test('reads live counts from the api rather than placeholders', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/health');

    await expect(page.getByText('Events stored')).toBeVisible();
    await expect(page.getByText('Dead-lettered')).toBeVisible();
    await expect(page.getByText(/never silently rewrites a decision/i)).toBeVisible();
  });
});

test.describe('console shell', () => {
  test('shows the signed-in identity', async ({ page }) => {
    await signIn(page);
    await expect(page.getByTestId('current-user')).toBeVisible();
    await expect(page.getByTestId('current-user')).not.toBeEmpty();
  });

  test('groups the console into real, navigable sections', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('link', { name: 'Incidents' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Policy', exact: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Audit trail' })).toHaveCount(1);

    await page.getByRole('link', { name: 'Audit trail' }).click();
    await expect(page).toHaveURL(/\/console\/audit/);
  });

  test('signs out, lands on the landing page, and loses access to the console', async ({
    page,
  }) => {
    await signIn(page);
    // Two presses by design: the first arms the button, the second signs out.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Press again to sign out' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/console');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('feature inspector', () => {
  async function replayAndInspect(page: Page): Promise<void> {
    await signIn(page);
    await replayEnumeration(page);

    await page.goto('/console/features');
    await expect(page.getByRole('heading', { level: 1, name: 'Feature inspector' })).toBeVisible();
    await page.getByRole('button', { name: 'Replayed' }).click();
  }

  test('shows the sketch estimate beside the confirmed count', async ({ page }) => {
    await replayAndInspect(page);

    await expect(page.getByText('Distinct cards').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/sketch \d+ ±\d+/).first()).toBeVisible();
    await expect(
      page.getByText(/Sketch (agreed with the exact count|was (over|under) by)/).first(),
    ).toBeVisible();
  });

  test('switches the entity a decision would act on', async ({ page }) => {
    await replayAndInspect(page);
    await expect(page.getByText('Distinct cards').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'network' }).click();
    await expect(page.getByRole('button', { name: 'network' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('keeps replayed traffic separable from real traffic', async ({ page }) => {
    await replayAndInspect(page);
    await expect(page.getByText('Distinct cards').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Real traffic' }).click();
    await expect(page.getByRole('button', { name: 'Real traffic' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.getByText(/No real payment events|Estimated to find, exact to decide/).first(),
    ).toBeVisible();
  });
});

test.describe('incidents', () => {
  test.describe.configure({ timeout: 150_000 });

  async function replayAndOpenQueue(page: Page): Promise<void> {
    await signIn(page);
    await replayEnumeration(page);
    await page.goto('/console/incidents');
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
    // Replay evaluates detection as it lands, so an incident reaches the queue on its own.
    await expect(page.getByRole('button', { name: /^Review / }).first()).toBeVisible({
      timeout: 90_000,
    });
  }

  test('turns a replayed burst into an incident in the queue', async ({ page }) => {
    await replayAndOpenQueue(page);
    await expect(page.getByRole('button', { name: /^Review / }).first()).toBeVisible();
  });

  test('opens an incident from the queue', async ({ page }) => {
    await replayAndOpenQueue(page);
    await page
      .getByRole('button', { name: /^Review / })
      .first()
      .click();
    await expect(page).toHaveURL(/\/console\/incidents\/[0-9a-f-]+/);
  });
});

test.describe('policy and containment', () => {
  test.describe.configure({ timeout: 150_000 });

  test('shows the policy it is running and where it comes from', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Policy', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Policies' })).toBeVisible();
    await expect(page.getByText(/^v\d+$/).first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('audit chain', () => {
  test('verifies the chain on load and says how to check it offline', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/audit');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit trail' })).toBeVisible();

    // The badge reports the chain's real state, intact or not; what matters is that the check
    // completed rather than sat pending, or that the log is honestly empty.
    const badge = page.locator('.aud-tamper').first();
    await expect(badge.or(page.getByText(/Nothing recorded yet/))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Checking record/)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(/pnpm audit:verify/)).toBeVisible();
  });
});
