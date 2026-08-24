import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173', credentials: true });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.warn(`api listening on http://localhost:${port}/api`);
}

void bootstrap();
