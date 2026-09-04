import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Shop } from './Shop.js';

const catalog = {
  items: [
    {
      sku: 'mug-01',
      name: 'Insulated mug',
      description: '350ml',
      pricePaise: 49_900,
      category: 'Drinkware',
    },
    {
      sku: 'filter-02',
      name: 'Filter papers',
      description: 'Pack of 100',
      pricePaise: 19_900,
      category: 'Supplies',
    },
  ],
};

/** The full shop section, where every catalogue item appears exactly once. */
function shopSection(): HTMLElement {
  return screen.getByRole('region', { name: 'Shop' });
}

async function findInShop(text: string): Promise<HTMLElement> {
  return within(shopSection()).findByText(text);
}

const openCheckout = vi.hoisted(() => vi.fn());
vi.mock('./checkout.js', () => ({ openCheckout }));

function stubFetch(orderHandler?: (body: unknown) => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/catalog') {
        return { ok: true, json: async () => catalog } as unknown as Response;
      }
      if (url === '/api/orders') {
        const parsed: unknown = JSON.parse(String(init?.body ?? '{}'));
        if (orderHandler) return orderHandler(parsed);
        return {
          ok: true,
          json: async () => ({
            razorpayOrderId: 'order_TEST123',
            amountPaise: 49_900,
            currency: 'INR',
            razorpayKeyId: 'rzp_test_key',
          }),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  openCheckout.mockResolvedValue({ kind: 'paid', paymentId: 'pay_TEST' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  openCheckout.mockReset();
});

describe('Shop', () => {
  it('renders the catalogue from the api', async () => {
    stubFetch();
    render(<Shop />);
    expect(await findInShop('Insulated mug')).toBeInTheDocument();
    expect(within(shopSection()).getByText('Filter papers')).toBeInTheDocument();
  });

  it('formats prices in rupees from paise', async () => {
    stubFetch();
    render(<Shop />);
    expect(await within(shopSection()).findByText('₹499.00')).toBeInTheDocument();
  });

  it('cannot check out with an empty cart', async () => {
    stubFetch();
    render(<Shop />);
    await findInShop('Insulated mug');
    await userEvent.click(screen.getByRole('button', { name: /see cart/i }));
    expect(screen.getByRole('button', { name: 'Pay with Razorpay' })).toBeDisabled();
  });

  it('totals the cart as items are added', async () => {
    stubFetch();
    render(<Shop />);
    await findInShop('Insulated mug');

    await userEvent.click(
      within(shopSection()).getByRole('button', { name: 'Add Insulated mug to cart' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add one Insulated mug' }));

    // Two mugs at ₹499 — the cart total reflects it. Named, because the line total for the
    // same two mugs reads ₹998.00 as well.
    expect(screen.getByLabelText('Cart total')).toHaveTextContent('₹998.00');
  });

  it('never sends an amount to the server', async () => {
    let captured: unknown;
    stubFetch((body) => {
      captured = body;
      return {
        ok: true,
        json: async () => ({
          razorpayOrderId: 'order_TEST123',
          amountPaise: 49_900,
          currency: 'INR',
          razorpayKeyId: 'rzp_test_key',
        }),
      } as unknown as Response;
    });

    render(<Shop />);
    await findInShop('Insulated mug');
    await userEvent.click(
      within(shopSection()).getByRole('button', { name: 'Add Insulated mug to cart' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay with Razorpay' }));

    await waitFor(() => expect(captured).toBeDefined());
    // The server prices the cart. A client-supplied amount would be a way to pay ₹1
    // for a ₹10,000 order.
    expect(captured).not.toHaveProperty('amount');
    expect(captured).not.toHaveProperty('amountPaise');
    expect(captured).toHaveProperty('lines');
    expect(captured).toHaveProperty('clientSessionId');
  });

  it('sends a stable client session id', async () => {
    let captured: { clientSessionId?: string } = {};
    stubFetch((body) => {
      captured = body as { clientSessionId?: string };
      return {
        ok: true,
        json: async () => ({
          razorpayOrderId: 'order_TEST123',
          amountPaise: 49_900,
          currency: 'INR',
          razorpayKeyId: 'rzp_test_key',
        }),
      } as unknown as Response;
    });

    render(<Shop />);
    await findInShop('Insulated mug');
    await userEvent.click(
      within(shopSection()).getByRole('button', { name: 'Add Insulated mug to cart' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay with Razorpay' }));

    await waitFor(() => expect(captured.clientSessionId).toBeDefined());
    expect(captured.clientSessionId).toBe(sessionStorage.getItem('sentinel.storefront.session'));
  });

  it('reports a captured payment', async () => {
    stubFetch();
    render(<Shop />);
    await findInShop('Insulated mug');
    await userEvent.click(
      within(shopSection()).getByRole('button', { name: 'Add Insulated mug to cart' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay with Razorpay' }));

    expect(await screen.findByText(/pay_TEST/)).toBeInTheDocument();
  });

  it('distinguishes a dismissed checkout from a failure', async () => {
    stubFetch();
    openCheckout.mockResolvedValue({ kind: 'dismissed' });

    render(<Shop />);
    await findInShop('Insulated mug');
    await userEvent.click(
      within(shopSection()).getByRole('button', { name: 'Add Insulated mug to cart' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay with Razorpay' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/closed the payment window/i);
  });

  it('surfaces a declined payment', async () => {
    stubFetch();
    openCheckout.mockResolvedValue({ kind: 'failed', reason: 'insufficient funds' });

    render(<Shop />);
    await findInShop('Insulated mug');
    await userEvent.click(
      within(shopSection()).getByRole('button', { name: 'Add Insulated mug to cart' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay with Razorpay' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('insufficient funds');
  });

  it('surfaces a rejected order without opening checkout', async () => {
    stubFetch(
      () =>
        ({
          ok: false,
          json: async () => ({ message: 'Unknown item: ghost' }),
        }) as unknown as Response,
    );

    render(<Shop />);
    await findInShop('Insulated mug');
    await userEvent.click(
      within(shopSection()).getByRole('button', { name: 'Add Insulated mug to cart' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay with Razorpay' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Unknown item: ghost');
    expect(openCheckout).not.toHaveBeenCalled();
  });
});
