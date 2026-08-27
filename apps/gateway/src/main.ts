import 'reflect-metadata';

import { Logger } from '@nestjs/common';
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
  const logger = new Logger('gateway');

  const app = await NestFactory.create(AppModule.forRoot(environment), { bufferLogs: false });
  const runtime = app.get<GatewayRuntime>(GATEWAY_RUNTIME);

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
    logger.log(`listening for replies on ${runtime.replyQueue.queueName}`);
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
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().finally(() => process.exit(0));
    });
  }

  await app.listen(environment.PORT);
  logger.log(`gateway listening on port ${String(environment.PORT)}`);
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
