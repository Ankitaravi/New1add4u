import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertProductionConfig } from './config';
import { setup } from './setup';

async function bootstrap() {
  assertProductionConfig();
  // rawBody is needed to verify Razorpay webhook signatures.
  const app = setup(await NestFactory.create(AppModule, { rawBody: true }));
  const origins = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim());
  app.enableCors({ origin: origins ?? true });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
