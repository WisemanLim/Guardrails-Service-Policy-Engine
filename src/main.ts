import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 8082);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Policy Engine listening on :${port}`);
}
bootstrap();
