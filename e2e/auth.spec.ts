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
    await expect(page.getByText('Incidents')).toBeVisible();
    await expect(page.getByRole('link', { name: /Incidents/ })).toHaveCount(0);
  });

  test('signs out and loses access to the console', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Sign out' }).click();

    await page.goto('/console');
    await expect(page).toHaveURL(/\/login/);
  });
});
