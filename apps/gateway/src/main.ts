// First, before anything else: see `instrumentation.ts` for why the order matters.
import { otel } from './instrumentation';
import 'reflect-metadata';

import { JsonLogger, nestLoggerFor } from '@bank/observability';
import { NestFactory } from '@nestjs/core';

import { AppModule, GATEWAY_RUNTIME } from './app.module';
import type { GatewayRuntime } from './app.module';
import { loadDotEnvFile, loadEnvironment } from './infrastructure/config/environment';

/**
 * The environment is validated before Nest boots, so a missing variable fails
 * the process immediately with a non-zero exit code instead of surfacing later
 * as a runtime error.
 */
async function bootstrap(): Promise<void> {
  loadDotEnvFile();
  const environment = loadEnvironment();
  const logger = new JsonLogger({ service: 'gateway' });

  // Nest's own lines — and every `new Logger(...)` in the filter and the
  // controllers — through the same JSON as everything else (T-48).
  const app = await NestFactory.create(AppModule.forRoot(environment), {
    bufferLogs: false,
    logger: nestLoggerFor(logger),
  });
  const runtime = app.get<GatewayRuntime>(GATEWAY_RUNTIME);

  /**
   * The frontend is a different origin, so every call it makes is cross-origin
   * and the browser will discard the response unless the gateway names the
   * origin back. `curl` never needed this — a browser does, for every screen.
   *
   * The origins are an allow-list, never `*`: the API answers to the frontend,
   * not to any page on the internet. `X-Correlation-Id` is exposed because the
   * client reads it off the response to correlate an asynchronous outcome, and
   * a browser hides every response header that is not exposed by name.
   */
  const allowedOrigins = environment.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id', 'X-Trace-Id'],
    maxAge: 600,
  });
  logger.info('CORS configured', { allowedOrigins });

  /**
   * The broker is brought up before the port opens, but **not waited on
   * indefinitely**.
   *
   * `waitForConnect()` does not reject when the broker is unreachable — it
   * waits, forever, while the connection manager retries in the background. A
   * plain `await` here therefore means the process never finishes booting and
   * never opens its port, so the one endpoint that could explain the outage is
   * the one nobody can reach, and an orchestrator sees a container that failed
   * to start rather than one reporting itself unready.
   *
   * So the wait is bounded. Either the connection is up within the window, or
   * the gateway comes up anyway: it answers `/health`, reports `/ready` as
   * degraded, refuses writes with `BROKER_UNAVAILABLE`, and picks the
   * connection up on its own when RabbitMQ returns.
   */
  const connected = await within(BOOT_CONNECT_TIMEOUT_MS, async () => {
    await runtime.broker.start();
    await runtime.replyQueue.start();
  });

  if (connected) {
    logger.info('listening for replies', { queue: runtime.replyQueue.queueName });
  } else {
    logger.warn(
      'broker not reachable at boot; serving health and refusing writes until it returns',
    );
  }

  /**
   * Every outstanding wait is failed on the way out. Without this, shutdown
   * blocks on promises whose answers can no longer arrive — the process looks
   * hung when it is merely polite.
   */
  app.enableShutdownHooks();
  const shutdown = async (): Promise<void> => {
    runtime.replyQueue.stop();
    await runtime.broker.stop();
    // Last: flushes the spans and metrics the shutdown itself produced.
    await otel.shutdown();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().finally(() => process.exit(0));
    });
  }

  await app.listen(environment.PORT);
  logger.info('gateway listening', { port: environment.PORT });
}

/** How long boot waits for the broker before coming up degraded. */
const BOOT_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Runs `work`, reporting whether it finished within the window.
 *
 * The work is **not cancelled** on timeout — it cannot be, and it should not
 * be: the connection manager is still retrying, and when it succeeds the
 * channels are set up exactly as they would have been. This only stops the
 * caller from waiting for that to happen.
 */
async function within(milliseconds: number, work: () => Promise<void>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;

  const expiry = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, milliseconds);
    timer.unref();
  });

  try {
    return await Promise.race([work().then(() => true), expiry]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

bootstrap().catch((error: unknown) => {
  // JSON like every other line: the one that explains a crash is the one the
  // collection agent most needs to parse.
  new JsonLogger({ service: 'gateway' }).error('boot failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
