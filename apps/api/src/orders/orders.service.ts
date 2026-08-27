import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { checkoutSessions, type DbHandle } from '@sentinel/db';
import type { CreateOrderRequest, CreateOrderResponse } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';
import { pseudonymise, pseudonymiseIp } from '../telemetry/pseudonym.js';
import { ContainmentService } from '../containment/containment.service.js';
import { priceCart, UnknownSkuError } from './catalog.js';
import { RazorpayClient } from './razorpay.client.js';
import { TransactionRiskService } from './risk.service.js';

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
    private readonly containment: ContainmentService,
    private readonly risk: TransactionRiskService,
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

    // The same pseudonyms the sensor records, computed up front because containment is asked
    // *before* an order exists. Refusing after creating the order at Razorpay would mean the
    // merchant had already opened the very thing it means to refuse.
    const sessionPseudonym = pseudonymise(request.clientSessionId, this.pseudonymConfig);
    const devicePseudonym = pseudonymise(
      `${context.userAgent ?? 'unknown'}|${request.clientSessionId}`,
      this.pseudonymConfig,
    );
    const ipPseudonym = pseudonymiseIp(context.ip, this.pseudonymConfig);
    const riskAssessment = await this.risk.assess({
      session: sessionPseudonym,
      device: devicePseudonym,
      network: ipPseudonym,
      amountPaise: priced.amountPaise,
    });

    // Where `contain` becomes a refusal rather than a label. An entity is contained by a block
    // on any of its keys, so all three are checked. The shopper is told nothing about why — the
    // reason lives in the audit trail, not in a message an attacker could probe.
    const blocked = await this.containment.blocking([
      { kind: 'session', key: sessionPseudonym },
      { kind: 'device', key: devicePseudonym },
      { kind: 'network', key: ipPseudonym },
    ]);
    if (blocked !== null) {
      throw new ForbiddenException('This payment could not be started. Please try again later.');
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
      ipPseudonym,
      devicePseudonym,
      emailPseudonym:
        request.email !== undefined ? pseudonymise(request.email, this.pseudonymConfig) : null,
      sessionPseudonym,
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
      riskAssessment,
    };
  }
}
