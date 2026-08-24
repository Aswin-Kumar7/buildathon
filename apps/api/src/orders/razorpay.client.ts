import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { loadEnv } from '../config/env.js';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string | null;
}

/**
 * A deliberately thin wrapper over the Orders API rather than the official SDK.
 *
 * We use exactly one endpoint, the request is a plain POST with basic auth, and the
 * response shape we depend on is four fields. A direct call keeps the failure modes
 * visible — timeouts, 4xx bodies, malformed responses — where an SDK would smooth them
 * into something harder to reason about when the demo breaks.
 */
@Injectable()
export class RazorpayClient {
  private readonly env = loadEnv();
  private static readonly BASE = 'https://api.razorpay.com/v1';
  private static readonly TIMEOUT_MS = 10_000;

  get keyId(): string {
    return this.env.RAZORPAY_KEY_ID ?? '';
  }

  get isConfigured(): boolean {
    return (
      this.env.RAZORPAY_KEY_ID !== undefined &&
      this.env.RAZORPAY_KEY_ID !== '' &&
      this.env.RAZORPAY_KEY_SECRET !== undefined &&
      this.env.RAZORPAY_KEY_SECRET !== ''
    );
  }

  private authHeader(): string {
    const raw = `${this.env.RAZORPAY_KEY_ID ?? ''}:${this.env.RAZORPAY_KEY_SECRET ?? ''}`;
    return `Basic ${Buffer.from(raw).toString('base64')}`;
  }

  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<RazorpayOrder> {
    if (!this.isConfigured) {
      // Explicit rather than a confusing 401 from upstream.
      throw new ServiceUnavailableException(
        'Razorpay test keys are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RazorpayClient.TIMEOUT_MS);

    try {
      const response = await fetch(`${RazorpayClient.BASE}/orders`, {
        method: 'POST',
        headers: { authorization: this.authHeader(), 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: 'INR',
          receipt: input.receipt,
          notes: input.notes ?? {},
        }),
        signal: controller.signal,
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        const description =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: { description?: string } }).error.description ?? 'unknown')
            : 'unknown';
        throw new ServiceUnavailableException(`Razorpay rejected the order: ${description}`);
      }

      const order = body as RazorpayOrder;
      if (typeof order.id !== 'string' || typeof order.amount !== 'number') {
        throw new ServiceUnavailableException('Razorpay returned an unexpected order shape');
      }

      return order;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException('Razorpay did not respond within 10 seconds');
      }
      throw new ServiceUnavailableException('Could not reach Razorpay');
    } finally {
      clearTimeout(timeout);
    }
  }
}
