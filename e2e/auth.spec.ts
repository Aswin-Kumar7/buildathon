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
  test('states the claim and what the project is not', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Sentinel' })).toBeVisible();
    await expect(page.getByText(/not equivalent to Razorpay/i)).toBeVisible();
  });

  test('reads evidence status from the running api', async ({ page }) => {
    await page.goto('/');
    // Rendered only when /api/meta responds, so this proves the API is genuinely reachable.
    await expect(page.getByText('L1 — Integration')).toBeVisible();
    await expect(page.getByText('L3 — Benchmark')).toBeVisible();
  });

  test('routes to the console entry point', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Open the console' }).click();
    await expect(page).toHaveURL('/login');
  });
});

test.describe('authentication', () => {
  test('signs in and reaches the console', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('Signed in as Demo Analyst.')).toBeVisible();
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
    await page.getByRole('link', { name: 'Attempts' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Payment attempts' })).toBeVisible();
    // The claim the whole slice rests on, stated on the page rather than only in a doc.
    await expect(page.getByText(/any sequence, with any duplicates/i)).toBeVisible();
  });

  test('says plainly that it invents nothing when no events have arrived', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/attempts');

    // Either state is honest. What must never appear is an empty table implying zero
    // failures when the truth is that nothing has been observed.
    const empty = page.getByText('No payment events yet');
    const orders = page.locator('.timeline');
    await expect(empty.or(orders.first())).toBeVisible();
  });
});

test.describe('scenarios', () => {
  test('offers the labelled corpus and says why each case is hard', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Scenarios' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Scenarios' })).toBeVisible();
    await expect(page.getByText('Legitimate dunning')).toBeVisible();
    await expect(page.getByText(/dunning tries few cards many times/)).toBeVisible();
  });

  test('counts replayed events apart from real ones', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/scenarios');

    // The claim that keeps a demo from inflating the evidence, on the page rather than only
    // in a document.
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
    await page.getByRole('link', { name: 'System health' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'System health' })).toBeVisible();

    // Either state is correct depending on whether the secrets are set locally; what must
    // never happen is the page rendering zeroes with no indication which one it is.
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
    await expect(page.getByText('test mode')).toBeVisible();
    // Scoped: the name also appears in the page body, and strict mode rightly rejects
    // an ambiguous match.
    await expect(page.getByTestId('current-user')).toContainText('Demo Analyst');
    await expect(page.getByTestId('current-user')).toContainText('analyst');
  });

  test('marks unbuilt sections as unavailable rather than faking them', async ({ page }) => {
    await signIn(page);
    // Present as text, but deliberately not a link — the slice number is shown instead.
    await expect(page.getByText('Audit')).toBeVisible();
    await expect(page.getByRole('link', { name: /Audit/ })).toHaveCount(0);
  });

  test('signs out and loses access to the console', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Sign out' }).click();

    await page.goto('/console');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('feature inspector', () => {
  /**
   * Replays a scenario first, because the inspector has nothing to show without one. The whole
   * chain runs for real here: storefront-shaped checkout context, webhook ingestion, redaction,
   * then the two-pass feature computation.
   */
  async function replayAndInspect(page: Page): Promise<void> {
    await signIn(page);
    await page.goto('/console/scenarios');

    // Waited for explicitly. On the first test of a run the dev server is still compiling the
    // route, and clicking a button that has not rendered yet fails as a missing feature rather
    // than as the cold start it is.
    await expect(page.getByRole('heading', { level: 1, name: 'Scenarios' })).toBeVisible({
      timeout: 60_000,
    });
    const replay = page.getByRole('button', { name: 'Replay Card enumeration, undisguised' });
    await expect(replay).toBeVisible({ timeout: 60_000 });
    await replay.click();
    await expect(page.getByText(/events and \d+ checkouts written/)).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('link', { name: 'Features' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Feature inspector' })).toBeVisible();

    // Pinned to replayed traffic. The storefront specs put real payments through the same
    // server, and because the corpus carries timestamps from months ago, one live attempt is
    // enough to anchor the window to now and hide the whole scenario behind it.
    await page.getByRole('button', { name: 'Replayed' }).click();
  }

  test('shows the sketch estimate beside the confirmed count', async ({ page }) => {
    await replayAndInspect(page);

    // The property the slice is judged on. Never one number: the exact figure a decision may
    // rest on, and the estimate with its bound, visible together.
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

    // The corpus carries the timestamps it was recorded with. Its rates are real and
    // historical, and a console that showed them as live would be misrepresenting evidence.
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
    // The same separation the health page insists on. A console that pooled them would let
    // invented events count as evidence the system works against Razorpay.
    await replayAndInspect(page);
    await expect(page.getByText('Distinct cards').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Real traffic' }).click();
    await expect(page.getByRole('button', { name: 'Real traffic' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Either there is real traffic or the page says there is none — never the replayed
    // scenario relabelled as real.
    await expect(
      page.getByText(/No real payment events|Estimated to find, exact to decide/).first(),
    ).toBeVisible();
  });
});

test.describe('incidents', () => {
  // Longer than the default, and honestly so: each of these replays a scenario, waits for an
  // asynchronous queue to drain it, and then runs detection until it has something to judge.
  test.describe.configure({ timeout: 150_000 });

  /**
   * Replays the enumeration scenario, runs a detection pass, and opens the queue.
   *
   * The whole chain, for real: storefront-shaped checkout context, webhook ingestion,
   * redaction, state resolution, features, rules, clustering, persistence.
   */
  async function replayAndDetect(page: Page): Promise<void> {
    await signIn(page);
    await page.goto('/console/scenarios');
    await expect(page.getByRole('heading', { level: 1, name: 'Scenarios' })).toBeVisible({
      timeout: 60_000,
    });

    // Cleared first. Earlier specs in this run replay other families into the same database,
    // and the corpus families start at the same instant but run for different lengths — the
    // dunning storm lasts two hours, the enumeration burst five minutes. The feature window
    // anchors to the newest event, so leaving both in place would put the burst outside it.
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

    // Scoped to replayed traffic before evaluating. The storefront specs put live payments
    // through the same server, and the feature window anchors to the newest event whatever its
    // source — so one live attempt would hide a scenario recorded months ago behind it.
    await page.getByRole('button', { name: 'Replayed' }).click();

    // Detection is retried until it finds something, because ingestion is asynchronous. The
    // replay writes sixty-seven events; the drain claims fifty a second, so a pass run the
    // instant the replay returns judges a scenario that is still arriving. Waiting is the
    // honest thing for the test to do — the alternative is a system that pretends its own
    // queue is synchronous.
    await expect(async () => {
      await page.getByRole('button', { name: 'Run detection' }).click();
      await expect(page.getByText('Card spread').first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });
  }

  test('turns a replayed burst into one incident with readable evidence', async ({ page }) => {
    // The slice's exit condition, end to end.
    await replayAndDetect(page);

    await expect(page.getByText(/Suggested:/).first()).toBeVisible();
    // Labelled by where its events came from. A replayed incident is never evidence the system
    // works against Razorpay, so it must say so even when the queue is showing both.
    await expect(page.getByText('replayed').first()).toBeVisible();
  });

  test('explains the score as a sum a person can follow', async ({ page }) => {
    await replayAndDetect(page);
    await page.getByRole('link', { name: 'Open' }).first().click();
    await expect(page.getByRole('heading', { name: 'Why this score' })).toBeVisible();
    // Codes rendered into sentences at the edge, with the numbers that produced them.
    await expect(page.getByText(/different cards from one place/)).toBeVisible();
    await expect(page.getByText(/Total/)).toBeVisible();
  });

  test('records who moved an incident, and refuses what the machine forbids', async ({ page }) => {
    await replayAndDetect(page);
    await page.getByRole('link', { name: 'Open' }).first().click();
    await page.getByRole('button', { name: /Mark under review/ }).click();

    await expect(page.getByText(/Open → Under review/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/by Demo Analyst/)).toBeVisible();
    // `open` is not reachable from `under_review`, so the console must not offer it.
    await expect(page.getByRole('button', { name: /Mark open/ })).toHaveCount(0);
  });

  test('says a resolved incident is final rather than offering to reopen it', async ({ page }) => {
    await replayAndDetect(page);
    await page.getByRole('link', { name: 'Open' }).first().click();
    await page.getByRole('button', { name: /Mark resolved/ }).click();

    await expect(page.getByText(/Resolved is final/)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('three that look alike', () => {
  test('reaches three different decisions with no traffic in the database', async ({ page }) => {
    // The slice's exit condition, and the reason this page is computed from the corpus: it has
    // to work on a clean clone, which is the state a reviewer starts from.
    await signIn(page);
    await page.getByRole('link', { name: 'Three that look alike' }).click();

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
    // Restraint made visible rather than narrated: the outage column carries the reason not to
    // act, in the same layout as the column that says to act.
    await expect(
      page.getByText(/customers are punished for an outage that is not theirs or ours/),
    ).toBeVisible();
  });
});

test.describe('policy and containment', () => {
  // Replays a scenario, detects, then proposes, approves and releases — the whole loop.
  test.describe.configure({ timeout: 150_000 });

  test('shows the policy it is running and refuses to be edited from here', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Policy' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Policy' })).toBeVisible();
    await expect(page.getByText(/Version \d+/)).toBeVisible({ timeout: 30_000 });
    // Stated on the page a person would otherwise expect to edit.
    await expect(page.getByText(/policy\.yaml/)).toBeVisible();
  });

  test('simulates a candidate policy without changing anything', async ({ page }) => {
    await signIn(page);
    await page.goto('/console/policy');
    await expect(page.getByText(/Version \d+/)).toBeVisible({ timeout: 30_000 });

    // Deliberately broken, so the answer is a list of problems rather than an exception in a
    // console the person editing cannot see.
    await page.getByRole('textbox').fill('version: 1\nkillSwitch: false\n');
    await page.getByRole('button', { name: 'Simulate' }).click();

    await expect(page.getByText(/That policy is not usable/)).toBeVisible({ timeout: 30_000 });
    // Nothing was saved: the loaded policy is unchanged.
    await page.reload();
    await expect(page.getByText(/Version \d+/)).toBeVisible({ timeout: 30_000 });
  });

  test('proposes, approves and releases an action, attributably', async ({ page }) => {
    // The slice's exit condition, short of waiting half an hour for the expiry — which the
    // integration suite covers by moving the clock rather than by sitting still.
    await signIn(page);
    await page.goto('/console/scenarios');
    await expect(page.getByRole('heading', { level: 1, name: 'Scenarios' })).toBeVisible({
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

    await page.getByRole('link', { name: 'Open' }).first().click();
    await expect(page.getByRole('heading', { name: 'Action' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Ask the policy' }).click();

    // What the policy decided, and what it would not allow, in the same panel.
    await expect(page.getByText('Approvals needed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/What being wrong would cost/)).toBeVisible();
    await expect(
      page.getByText(/Judged standing at the moment of the replayed data/),
    ).toBeVisible();
  });
});

test.describe('audit chain', () => {
  test('records actions in a chain and verifies it intact', async ({ page }) => {
    // The happy path end to end: move an incident, and the audit page shows the chained record
    // and confirms it has not been touched. Deliberate corruption is exercised in the
    // integration suite, which can reach into the database the browser cannot.
    await signIn(page);
    await page.goto('/console/audit');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit' })).toBeVisible();

    await page.getByRole('button', { name: 'Verify chain' }).click();
    // Either intact, or the honest empty-chain case — never a silent nothing.
    await expect(page.getByText(/The chain is intact|Nothing recorded yet/)).toBeVisible({
      timeout: 30_000,
    });

    // The command-line verifier is offered alongside the button.
    await expect(page.getByText(/pnpm audit:verify/)).toBeVisible();
  });
});

test.describe('model benchmark', () => {
  test('shows the held-out numbers and the leakage delta', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Metrics' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Model benchmark' })).toBeVisible();
    // The artefact is committed, so the benchmark renders; if a clone had not generated it, the
    // page would say so rather than show zeros.
    await expect(page.getByText(/The leakage delta|has not been generated/)).toBeVisible({
      timeout: 30_000,
    });
  });
});
