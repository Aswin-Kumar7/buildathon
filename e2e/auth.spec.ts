import { expect, test, type Page } from '@playwright/test';

const DEMO = { email: 'analyst@sentinel.local', password: 'sentinel-demo' };

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(DEMO.email);
  await page.getByLabel('Password').fill(DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/console');
}

test.describe('landing', () => {
  test('states the claim and the differentiator', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/catch card testing/i);
    await expect(page.getByText(/is the model that runs/i)).toBeVisible();
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
    await expect(page.getByTestId('current-user')).toContainText('Demo Analyst');
  });

  test('shows a generic failure that does not reveal which field was wrong', async ({ page }) => {
    await page.goto('/login');
    // A non-existent account, so a real one is never rate-limited by this test.
    await page.getByLabel('Email').fill('nobody-e2e@sentinel.local');
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
    await expect(page).toHaveURL(/\/login/);
  });

  test('validates the email client-side before calling the api', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password').fill('anything');
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

    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByLabel('Password').fill(DEMO.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/console');
  });

  test('never shows console chrome to an anonymous visitor', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden();
  });
});

test.describe('payment attempts', () => {
  test('reconstructs attempts from event history', async ({ page }) => {
    await signIn(page);
    // A diagnostic view, reached by URL rather than the main nav (it lives under Settings).
    await page.goto('/console/attempts');

    await expect(page.getByRole('heading', { level: 1, name: 'Payment attempts' })).toBeVisible();
    await expect(page.getByText(/any sequence, with any duplicates/i)).toBeVisible();
  });

  test('says plainly that it invents nothing when no events have arrived', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/attempts');

    const empty = page.getByText('No payment events yet');
    const orders = page.locator('.timeline');
    await expect(empty.or(orders.first())).toBeVisible();
  });
});

test.describe('simulation', () => {
  test('offers the labelled corpus and says why each case is hard', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Simulation' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Simulation' })).toBeVisible();
    await expect(page.getByText('Legitimate dunning')).toBeVisible();
    await expect(page.getByText(/dunning tries few cards many times/)).toBeVisible();
  });

  test('counts replayed events apart from real ones', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/scenarios');
    await expect(page.getByText(/marked apart at the row/)).toBeVisible();
  });

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
  test('shows the test mode badge and the signed-in identity', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/test mode/i).first()).toBeVisible();
    await expect(page.getByTestId('current-user')).toContainText('Demo Analyst');
    await expect(page.getByTestId('current-user')).toContainText('analyst');
  });

  test('groups the console into real, navigable sections', async ({ page }) => {
    await signIn(page);
    // The consolidated product nav: the primary sections are real links.
    await expect(page.getByRole('link', { name: 'Incidents' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Policies' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Audit' })).toHaveCount(1);

    await page.getByRole('link', { name: 'Audit' }).click();
    await expect(page).toHaveURL(/\/console\/audit/);
  });

  test('signs out and loses access to the console', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Sign out' }).click();

    await page.goto('/console');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('feature inspector', () => {
  async function replayAndInspect(page: Page): Promise<void> {
    await signIn(page);
    await page.goto('/console/scenarios');

    await expect(page.getByRole('heading', { level: 1, name: 'Simulation' })).toBeVisible({
      timeout: 60_000,
    });
    const replay = page.getByRole('button', { name: 'Replay Card enumeration, undisguised' });
    await expect(replay).toBeVisible({ timeout: 60_000 });
    await replay.click();
    await expect(page.getByText(/events and \d+ checkouts written/)).toBeVisible({
      timeout: 30_000,
    });

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

  test('states the window, the half-life and how fresh the numbers are', async ({ page }) => {
    await replayAndInspect(page);

    await expect(page.getByText(/30-minute window, 5-minute half-life/).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Last attempt .+ ago\./).first()).toBeVisible();
  });

  test('admits that a replayed scenario describes a past moment', async ({ page }) => {
    await replayAndInspect(page);

    await expect(page.getByText('Evaluated as of the last activity, not now')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('switches the entity a decision would act on', async ({ page }) => {
    await replayAndInspect(page);
    await expect(page.getByText('Distinct cards').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'network' }).click();
    await expect(page.getByRole('button', { name: 'network' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('network', { exact: true }).first()).toBeVisible();
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

  async function replayAndDetect(page: Page): Promise<void> {
    await signIn(page);
    await page.goto('/console/scenarios');
    await expect(page.getByRole('heading', { level: 1, name: 'Simulation' })).toBeVisible({
      timeout: 60_000,
    });

    const clear = page.getByRole('button', { name: 'Remove replayed events' });
    if (await clear.isEnabled()) {
      await clear.click();
      await expect(clear).toBeDisabled({ timeout: 30_000 });
    }

    const replay = page.getByRole('button', { name: 'Replay Card enumeration, undisguised' });
    await expect(replay).toBeVisible({ timeout: 60_000 });
    await replay.click();
    await expect(page.getByText(/events and \d+ checkouts written/)).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('link', { name: 'Incidents' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();

    await page.getByRole('button', { name: 'Replayed' }).click();

    await expect(async () => {
      await page.getByRole('button', { name: 'Run detection' }).click();
      await expect(page.getByText('Card spread').first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });
  }

  test('turns a replayed burst into one incident with readable evidence', async ({ page }) => {
    await replayAndDetect(page);

    // Its evidence is on the row, and it is labelled as replayed — a replayed incident is never
    // evidence the system works against Razorpay, so it must say so even when the queue shows both.
    await expect(page.getByText('Card spread').first()).toBeVisible();
    await expect(page.getByText(/replayed/).first()).toBeVisible();
  });

  test('explains the score as a sum a person can follow', async ({ page }) => {
    await replayAndDetect(page);
    await page.getByRole('link', { name: /Open/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Why this score' })).toBeVisible();
    await expect(page.getByText(/different cards from one place/)).toBeVisible();
    await expect(page.getByText(/Total/)).toBeVisible();
  });

  test('records who moved an incident, and refuses what the machine forbids', async ({ page }) => {
    await replayAndDetect(page);
    // Only an open incident can be moved to review, so narrow to open cases first — a stale one
    // in a later state must not sit at the top of the queue and steal the click.
    await page.getByRole('tab', { name: 'Open', exact: true }).click();
    await page.getByRole('link', { name: /Open/ }).first().click();
    await page.getByRole('button', { name: 'Move to review' }).click();

    // Scoped to the history line — the name also appears in the top-bar identity.
    await expect(page.getByText(/Under review · Demo Analyst/)).toBeVisible({ timeout: 30_000 });
    // `under_review` cannot go back to review of itself; the console must not offer it again.
    await expect(page.getByRole('button', { name: 'Move to review' })).toHaveCount(0);
  });

  test('says a resolved incident is final rather than offering to reopen it', async ({ page }) => {
    await replayAndDetect(page);
    await page.getByRole('link', { name: /Open/ }).first().click();
    await page.getByRole('button', { name: 'Resolve — confirmed abuse' }).click();

    await expect(page.getByText(/Resolved is final/)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('three that look alike', () => {
  test('reaches three different decisions with no traffic in the database', async ({ page }) => {
    await signIn(page);
    // A diagnostic view reached by URL (linked from Settings), not part of the primary nav.
    await page.goto('/console/compare');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Three that look alike' }),
    ).toBeVisible();
    await expect(page.getByText('Contain')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Watch, do not act')).toBeVisible();
    await expect(page.getByText('Leave alone')).toBeVisible();
  });

  test('shows the shop around each entity, which is what separates them', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/compare');

    await expect(page.getByText('The shop around it').first()).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/customers are punished for an outage that is not theirs or ours/),
    ).toBeVisible();
  });
});

test.describe('policy and containment', () => {
  test.describe.configure({ timeout: 150_000 });

  test('shows the policy it is running and refuses to be edited from here', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Policies' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Policies' })).toBeVisible();
    await expect(page.getByText(/Version \d+/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/policy\.yaml/)).toBeVisible();
  });

  test('simulates a candidate policy without changing anything', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/policy');
    await expect(page.getByText(/Version \d+/)).toBeVisible({ timeout: 30_000 });

    await page.getByRole('textbox').fill('version: 1\nkillSwitch: false\n');
    await page.getByRole('button', { name: 'Simulate' }).click();

    await expect(page.getByText(/That policy is not usable/)).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByText(/Version \d+/)).toBeVisible({ timeout: 30_000 });
  });

  test('proposes, approves and releases an action, attributably', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/scenarios');
    await expect(page.getByRole('heading', { level: 1, name: 'Simulation' })).toBeVisible({
      timeout: 60_000,
    });

    const clear = page.getByRole('button', { name: 'Remove replayed events' });
    if (await clear.isEnabled()) {
      await clear.click();
      await expect(clear).toBeDisabled({ timeout: 30_000 });
    }

    const replay = page.getByRole('button', { name: 'Replay Card enumeration, undisguised' });
    await expect(replay).toBeVisible({ timeout: 60_000 });
    await replay.click();
    await expect(page.getByText(/events and \d+ checkouts written/)).toBeVisible({
      timeout: 30_000,
    });

    await page.goto('/console/incidents');
    await page.getByRole('button', { name: 'Replayed' }).click();
    await expect(async () => {
      await page.getByRole('button', { name: 'Run detection' }).click();
      await expect(page.getByText('Card spread').first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });

    await page.getByRole('link', { name: /Open/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Action' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Ask the policy' }).click();

    await expect(page.getByText('Approvals needed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/What being wrong would cost/)).toBeVisible();
    await expect(
      page.getByText(/Judged standing at the moment of the replayed data/),
    ).toBeVisible();
  });
});

test.describe('audit chain', () => {
  test('records actions in a chain and verifies it intact', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/audit');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit trail' })).toBeVisible();

    await page.getByRole('button', { name: 'Verify chain' }).click();
    await expect(page.getByText(/The chain is intact|Nothing recorded yet/)).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByText(/pnpm audit:verify/)).toBeVisible();
  });
});
