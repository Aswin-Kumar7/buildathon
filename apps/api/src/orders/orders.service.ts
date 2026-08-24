import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { checkoutSessions, type DbHandle } from '@sentinel/db';
import type { CreateOrderRequest, CreateOrderResponse } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';
import { pseudonymise, pseudonymiseIp } from '../telemetry/pseudonym.js';
import { priceCart, UnknownSkuError } from './catalog.js';
import { RazorpayClient } from './razorpay.client.js';

/**
 * Ordered most-specific-first, and the order is load-bearing: Edge's user-agent contains
 * "chrome", and Chrome's contains "safari". A lookup that checked them alphabetically
 * would report every Edge visitor as Chrome.
 */
const UA_FAMILIES: readonly (readonly [readonly string[], string])[] = [
  [['bot', 'crawler', 'spider'], 'bot'],
  [['curl', 'wget', 'python'], 'tool'],
  [['headless'], 'headless'],
  [['android'], 'android'],
  [['iphone', 'ipad'], 'ios'],
  [['firefox'], 'firefox'],
  [['edg/'], 'edge'],
  [['chrome'], 'chrome'],
  [['safari'], 'safari'],
];

/**
 * Coarse family only. The full user-agent string is close to a fingerprint on its own,
 * and the detector needs "roughly what kind of client" rather than "exactly which build".
 */
export function userAgentFamily(raw: string | undefined): string {
  if (raw === undefined || raw === '') return 'unknown';
  const ua = raw.toLowerCase();
  const match = UA_FAMILIES.find(([needles]) => needles.some((needle) => ua.includes(needle)));
  return match?.[1] ?? 'other';
}

export interface RequestContext {
  ip: string;
  userAgent: string | undefined;
}

@Injectable()
export class OrdersService {
  private readonly env = loadEnv();

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly razorpay: RazorpayClient,
  ) {}

  private get pseudonymConfig() {
    return { key: this.env.PSEUDONYM_KEY_V1, version: this.env.PSEUDONYM_KEY_VERSION };
  }

  async create(request: CreateOrderRequest, context: RequestContext): Promise<CreateOrderResponse> {
    let priced;
    try {
      priced = priceCart(request.lines);
    } catch (error) {
      if (error instanceof UnknownSkuError) {
        throw new BadRequestException(`Unknown item: ${error.sku}`);
      }
      throw error;
    }

    // A unique receipt is Razorpay's de-facto idempotency key on this endpoint; there is
    // no global idempotency header. Retrying with the same receipt is how a duplicate
    // submission stays one order.
    const receipt = `sentinel-${randomUUID()}`;

    const order = await this.razorpay.createOrder({
      amountPaise: priced.amountPaise,
      receipt,
      notes: { source: 'sentinel-storefront' },
    });

    // The sensor's record. Written after the order exists so it can be keyed on the
    // Razorpay id — that key is the only thing that will join this context to the
    // payment events which arrive later carrying none of it.
    await this.handle.db.insert(checkoutSessions).values({
      razorpayOrderId: order.id,
      ipPseudonym: pseudonymiseIp(context.ip, this.pseudonymConfig),
      devicePseudonym: pseudonymise(
        `${context.userAgent ?? 'unknown'}|${request.clientSessionId}`,
        this.pseudonymConfig,
      ),
      emailPseudonym:
        request.email !== undefined ? pseudonymise(request.email, this.pseudonymConfig) : null,
      sessionPseudonym: pseudonymise(request.clientSessionId, this.pseudonymConfig),
      userAgentFamily: userAgentFamily(context.userAgent),
      amountPaise: priced.amountPaise,
      currency: 'INR',
      itemCount: priced.itemCount,
    });

    return {
      razorpayOrderId: order.id,
      amountPaise: priced.amountPaise,
      currency: 'INR',
      razorpayKeyId: this.razorpay.keyId,
    };
  }
}
