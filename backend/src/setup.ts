import { INestApplication, ValidationPipe } from '@nestjs/common';

export function setup(app: INestApplication) {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  return app;
}
