import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedactAppModule } from './redact/redact-app.module';

/**
 * Guardrails-Service-Policy-Engine — single process, two HTTP listeners.
 *
 *   PORT        (8082)  /policies, /domains, /whitelist, /health
 *   PORT_REDACT (8085)  /redact,                          /health
 *
 * The Redact tier is an isolated NestJS app (no shared DB/Redis); the MCP
 * Server calls it remotely for HTTP redaction. It boots from the same
 * process but binds its own port.
 */
async function bootstrap() {
  const log = new Logger('Bootstrap');

  const policyPort = Number(process.env.PORT ?? 8082);
  const redactPort = Number(process.env.PORT_REDACT ?? 8085);

  const [policyApp, redactApp] = await Promise.all([
    NestFactory.create(AppModule, { bufferLogs: false }),
    NestFactory.create(RedactAppModule, { bufferLogs: false }),
  ]);

  policyApp.enableShutdownHooks();
  redactApp.enableShutdownHooks();

  await Promise.all([
    policyApp.listen(policyPort, '0.0.0.0'),
    redactApp.listen(redactPort, '0.0.0.0'),
  ]);

  log.log(`Policy Engine listening on :${policyPort}`);
  log.log(`Redact tier   listening on :${redactPort}`);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('bootstrap failed', e);
  process.exit(1);
});
