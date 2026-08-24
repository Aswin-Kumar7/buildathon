import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createOrderRequestSchema,
  type CatalogResponse,
  type CreateOrderResponse,
} from '@sentinel/contracts';
import { CATALOG } from './catalog.js';
import { OrdersService } from './orders.service.js';
import { resolveClientIp } from '../telemetry/pseudonym.js';
import { loadEnv } from '../config/env.js';

const env = loadEnv();

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('catalog')
  catalog(): CatalogResponse {
    return { items: [...CATALOG] };
  }

  /**
   * Public by design: this is the merchant's storefront, where shoppers are anonymous.
   * The console's routes are the guarded ones.
   */
  @Post('orders')
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() request: Request): Promise<CreateOrderResponse> {
    const parsed = createOrderRequestSchema.parse(body);

    return this.orders.create(parsed, {
      // A forwarding header is only believed behind a proxy we configured; otherwise it
      // is a string the caller controls, and trusting it would let anyone forge the
      // correlation key the detector relies on.
      ip: resolveClientIp(
        request.socket.remoteAddress,
        request.header('x-forwarded-for'),
        env.TRUST_PROXY,
      ),
      userAgent: request.header('user-agent'),
    });
  }
}
