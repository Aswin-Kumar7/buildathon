import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module.js';
import { loadEnv, resolvePort } from './config/env.js';
import { seedDemoUsers } from './auth/seed.js';
import { AuthService } from './auth/auth.service.js';
import { DrainService } from './webhooks/drain.service.js';

/**
 * Local-dev escape hatch for HTTPS interception. Some antivirus (e.g. Avast) MITMs outbound TLS with
 * a certificate Node does not trust, which breaks the live AI provider's fetch with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE. Opt in with ALLOW_INSECURE_TLS=1 in .env.local to accept it — this
 * is refused in production, where TLS verification must stay on.
 */
if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/**
 * Serves the console's built assets when they are in the image, and falls back to
 * index.html for any path the API did not claim — a client-routed application answers
 * `/console/health` from index.html, not from a file of that name.
 *
 * The regex excludes `/api`, so a mistyped API path still 404s as an API path instead of
 * silently returning HTML, which is a genuinely confusing thing to debug from the browser.
 */
function serveConsole(app: Awaited<ReturnType<typeof NestFactory.create>>): boolean {
  const dir = join(process.cwd(), 'public');
  if (!existsSync(join(dir, 'index.html'))) return false;

  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.use(express.static(dir, { index: false, maxAge: '1h' }));
  server.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
    response.sendFile(join(dir, 'index.html'));
  });

  return true;
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // rawBody keeps the exact bytes Razorpay sent alongside the parsed body. The webhook
  // signature is computed over those bytes, and re-serialising the parsed object reorders
  // keys and drops whitespace — which is why a valid event would fail verification.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });

  if (env.SEED_DEMO_USERS) {
    await seedDemoUsers(app.get(AuthService));
    console.warn(
      'seeded the demo accounts — their password is published, so this must never be a real deployment',
    );
  }

  // Started after the app is wired but before it listens, so no request can arrive while
  // the inbox is unattended.
  if (env.INBOX_WORKER_ENABLED) app.get(DrainService).start();

  const servingConsole = serveConsole(app);
  const port = resolvePort(env);

  // 0.0.0.0, not localhost: the platform routes to the container's external interface, and a
  // server bound to the loopback address is unreachable and fails its health check.
  await app.listen(port, '0.0.0.0');

  console.warn(
    `api listening on port ${port}` +
      (servingConsole ? ' (also serving the console)' : '') +
      ` — cors: ${env.WEB_ORIGIN.join(', ')}`,
  );
}

void bootstrap();
