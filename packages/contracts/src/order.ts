import { z } from 'zod';

export const catalogItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  pricePaise: z.number().int().positive(),
  /**
   * What shelf the item sits on, so the shop can group it.
   *
   * It lives here rather than in the storefront because a category invented in the client would
   * be a label with nothing behind it — the shop would be filtering on a fact only it believed.
   */
  category: z.string().min(1),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const cartLineSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
});
export type CartLine = z.infer<typeof cartLineSchema>;

/**
 * Note what the client does **not** send: an amount.
 *
 * A checkout that accepts a price from the browser can be charged one rupee for a
 * ten-thousand rupee order. The server resolves every SKU against its own catalogue and
 * computes the total itself, so the client's only influence is which items and how many.
 */
export const createOrderRequestSchema = z.object({
  lines: z.array(cartLineSchema).min(1).max(20),
  email: z.string().email().optional(),
  /** First-party identifier minted by the storefront, not a Razorpay concept. */
  clientSessionId: z.string().min(8).max(128),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const createOrderResponseSchema = z.object({
  razorpayOrderId: z.string().min(1),
  amountPaise: z.number().int().positive(),
  currency: z.literal('INR'),
  /** Publishable key. The secret never leaves the server. */
  razorpayKeyId: z.string().min(1),
});
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

export const catalogResponseSchema = z.object({
  items: z.array(catalogItemSchema).min(1),
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
