import { expect, test, type Page } from '@playwright/test';

const STOREFRONT = 'http://localhost:5174';

/**
 * The storefront is a separate origin from the console, so these navigate absolutely
 * rather than using baseURL.
 *
 * Nothing here completes a payment. That would mean driving Razorpay's hosted checkout,
 * which lives on their domain, needs live test credentials and would leave real test-mode
 * orders behind on every run — so these tests stop at the point where the browser would
 * hand over. The order-creation path itself is covered by the API integration suite.
 *
 * The cart is a drawer, closed until something is added or "See cart" is pressed, so the
 * assertions about its contents open it first.
 */
async function openCart(page: Page): Promise<void> {
  await page.getByRole('button', { name: /see cart/i }).click();
  await expect(page.getByRole('dialog', { name: 'Your cart' })).toBeVisible();
}

test.describe('storefront', () => {
  test('renders the catalogue from the api', async ({ page }) => {
    await page.goto(STOREFRONT);
    await expect(page.getByRole('link', { name: 'Sentinel Coffee' }).first()).toBeVisible();
    await expect(page.getByText('Electric kettle').first()).toBeVisible();
    await expect(page.getByText('₹1,499.00').first()).toBeVisible();
  });

  test('says plainly that card details never reach it, and that Sentinel watches', async ({
    page,
  }) => {
    await page.goto(STOREFRONT);
    await expect(page.getByText(/Watched by Sentinel/i)).toBeVisible();
    await openCart(page);
    await expect(page.getByText(/never here/i)).toBeVisible();
  });

  test('will not check out an empty cart', async ({ page }) => {
    await page.goto(STOREFRONT);
    await openCart(page);
    await expect(page.getByRole('button', { name: 'Pay with Razorpay' })).toBeDisabled();
  });

  test('totals the cart as items are added and removed', async ({ page }) => {
    await page.goto(STOREFRONT);
    await expect(page.getByText('Electric kettle').first()).toBeVisible();

    // Adding from the catalogue opens the drawer; the stepper inside it does the rest.
    await page.getByRole('button', { name: 'Add Electric kettle to cart' }).click();
    await page.getByRole('button', { name: 'Add one Electric kettle' }).click();

    await expect(page.locator('.cart-total strong')).toHaveText('₹2,998.00');
    await expect(page.getByRole('button', { name: 'Pay with Razorpay' })).toBeEnabled();

    const remove = page.getByRole('button', { name: 'Remove one Electric kettle' });
    await remove.click();
    await remove.click();

    await expect(page.getByRole('button', { name: 'Pay with Razorpay' })).toBeDisabled();
  });

  test('mints a session id that survives a reload', async ({ page }) => {
    await page.goto(STOREFRONT);
    // Wait for a rendered item: the id is minted in an effect, so reading storage the
    // instant navigation resolves would race the first render.
    await expect(page.getByText('Electric kettle').first()).toBeVisible();

    const first = await page.evaluate(() => sessionStorage.getItem('sentinel.storefront.session'));
    expect(first).toMatch(/^[0-9a-f-]{36}$/);

    await page.reload();
    const second = await page.evaluate(() => sessionStorage.getItem('sentinel.storefront.session'));
    expect(second).toBe(first);
  });
});
