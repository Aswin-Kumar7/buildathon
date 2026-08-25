import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ContainmentService } from './containment.service.js';

/**
 * Lifts containments that have reached their expiry, without anybody asking.
 *
 * The whole point of the expiry is that it does not need a person. An action that has to be
 * remembered and undone is one that will still be in place next month, protecting nothing and
 * blocking somebody — and the failure is silent, because nothing errors when a block simply
 * stays.
 *
 * Deliberately dull: a timer, a query, a status change, an audit line. The interesting property
 * is that it runs whether or not anyone is watching.
 */
@Injectable()
export class ExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly containment: ContainmentService) {}

  onModuleInit(): void {
    // Frequent, because the cost of being late is a customer who cannot pay for longer than the
    // policy said, and the cost of running is one indexed query.
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.containment.expireDue();
      if (expired > 0) this.logger.log(`expired ${expired} action(s)`);
    } catch (error) {
      this.logger.warn(`expiry pass failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }
}
