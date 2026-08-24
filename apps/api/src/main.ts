import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { seedDemoUsers } from './auth/seed.js';
import { AuthService } from './auth/auth.service.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });

  await seedDemoUsers(app.get(AuthService));

  await app.listen(env.API_PORT);
  console.warn(`api listening on http://localhost:${env.API_PORT}/api`);
}

void bootstrap();
