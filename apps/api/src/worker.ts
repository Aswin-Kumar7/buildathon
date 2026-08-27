import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DrainService } from './webhooks/drain.service.js';

/**
 * Worker entrypoint for deployments that split HTTP ingress from asynchronous processing.
 * The API still owns the inbox write/ack path; this process owns drain and detection timers.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const drain = app.get(DrainService);
  drain.start();
  console.warn('inbox worker started');

  const shutdown = async (): Promise<void> => {
    drain.stop();
    await app.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

void bootstrap();
