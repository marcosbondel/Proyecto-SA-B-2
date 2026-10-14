import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Role } from '@bank/contracts';

import { AppModule, GATEWAY_RUNTIME } from '../../src/app.module';
import type { GatewayRuntime } from '../../src/app.module';
import { loadEnvironment } from '../../src/infrastructure/config/environment';
import type { GatewayEnvironment } from '../../src/infrastructure/config/environment';
import { SessionTokenService } from '../../src/infrastructure/auth/jwt.service';

/**
 * A gateway wired to the **real** broker, for the suites under
 * `test/*.integration.spec.ts`.
 *
 * `test/support/harness.ts` doubles every port on purpose — that is what makes
 * the 321 existing cases fast and deterministic. This is the other half: it
 * boots the whole `AppModule` exactly as `main.ts` does, against a RabbitMQ
 * that is actually running, so a suite here can assert what a double
 * structurally cannot — the real exchange, the real routing key, the real
 * exclusive queue, and what the broker does when it is unreachable.
 *
 * `loadEnvironment` takes a `source` object instead of `process.env`
 * (environment.ts), so no `.env` file and no process-wide mutation are needed
 * to build one of these.
 */

/** A fixed, valid HS256 secret — same shape `test/support/harness.ts` uses. */
export const TEST_JWT_SECRET = 'a-real-broker-test-secret-of-32-chars!!';

/** The SLO webhook's shared secret in the real-broker harness (T-45). */
export const TEST_ALERT_WEBHOOK_TOKEN = 'a-real-broker-alert-token-of-32-chars!!';

/** The partner bank's shared secret for routes exercised against RabbitMQ. */
export const TEST_INTERBANK_PARTNER_TOKEN = 'a-real-broker-interbank-token-of-32-chars!!';

export interface BrokerHarness {
  readonly app: INestApplication;
  readonly environment: GatewayEnvironment;
  readonly runtime: GatewayRuntime;
  readonly tokens: SessionTokenService;
  /** This replica's instance id — what `gatewayReplyQueueName` is keyed on. */
  readonly instanceId: string;
}

export interface BrokerHarnessOptions {
  /** Overrides the five-second reply ceiling, so a timeout suite need not wait it out. */
  readonly replyTimeoutMs?: number;
  /** Overrides `RABBITMQ_URL`, for the outage suite's "pointed at a dead port" cases. */
  readonly rabbitmqUrl?: string;
  /** Pins the instance id, for the reply-queue suite's cross-instance cases. */
  readonly instanceId?: string;
  /**
   * When `false`, the module is constructed and initialised but the broker is
   * never started — the shape `main.ts` is in before `bootstrap()` calls
   * `within(...)`. Defaults to `true`.
   */
  readonly startBroker?: boolean;
}

function requireRabbitmqUrl(): string {
  const url = process.env.RABBITMQ_URL;
  if (url === undefined || url.length === 0) {
    throw new Error(
      'buildBrokerHarness() called without RABBITMQ_URL. Every *.integration.spec.ts file must ' +
        'gate its describe block on RABBITMQ_URL and never call this outside that gate.',
    );
  }
  return url;
}

/** Builds and boots a gateway against the real broker. Mirrors `main.ts`'s own sequence. */
export async function buildBrokerHarness(
  options: BrokerHarnessOptions = {},
): Promise<BrokerHarness> {
  const instanceId = options.instanceId ?? `gw-test-${randomUUID()}`;

  const environment = loadEnvironment({
    NODE_ENV: 'test',
    // Never actually opened — these suites never call `app.listen()`, only
    // `app.getHttpServer()` through `supertest`. A valid value is only here
    // to satisfy `GatewayEnvironment`'s `@Min(1)`.
    PORT: '3999',
    RABBITMQ_URL: options.rabbitmqUrl ?? requireRabbitmqUrl(),
    JWT_SECRET: TEST_JWT_SECRET,
    JWT_EXPIRES_IN: '3600',
    GATEWAY_INSTANCE_ID: instanceId,
    REPLY_TIMEOUT_MS: String(options.replyTimeoutMs ?? 5_000),
    // Never actually reached: every route exercised in these suites either
    // carries no upload or is asserted before the photo would be fetched.
    OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
    OBJECT_STORAGE_ACCESS_KEY: 'minio-app',
    OBJECT_STORAGE_SECRET_KEY: 'minio-app-secret',
    OBJECT_STORAGE_BUCKET: 'customer-identity-documents',
    OBJECT_STORAGE_REGION: 'us-east-1',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3010',
    ALERT_WEBHOOK_TOKEN: TEST_ALERT_WEBHOOK_TOKEN,
    INTERBANK_PARTNER_TOKEN: TEST_INTERBANK_PARTNER_TOKEN,
  });

  const app = await NestFactory.create(AppModule.forRoot(environment), {
    logger: false,
    bufferLogs: false,
  });
  await app.init();

  const runtime = app.get<GatewayRuntime>(GATEWAY_RUNTIME);

  if (options.startBroker ?? true) {
    await runtime.broker.start();
    await runtime.replyQueue.start();
  }

  const tokens = new SessionTokenService({ secret: TEST_JWT_SECRET, expiresInSeconds: 3600 });

  return { app, environment, runtime, tokens, instanceId };
}

/** Tears a harness down in the order `main.ts`'s shutdown hook uses. */
export async function closeBrokerHarness(harness: BrokerHarness): Promise<void> {
  harness.runtime.replyQueue.stop();
  await harness.runtime.broker.stop().catch(() => undefined);
  await harness.app.close();
}

/** A signed session for a role, over a fixed or random subject. */
export function tokenFor(
  harness: BrokerHarness,
  role: Role,
  customerId: string = randomUUID(),
): string {
  return harness.tokens.sign({ customerId, username: 'test-user', role });
}

export function bearerFor(harness: BrokerHarness, role: Role, customerId?: string): string {
  return `Bearer ${tokenFor(harness, role, customerId)}`;
}

/**
 * Runs `work`, reporting whether it finished within `milliseconds`.
 *
 * Copied in shape from `src/main.ts`'s own `within()` rather than imported —
 * that one is a private helper of `bootstrap()`, not an export, and duplicating
 * six lines is cheaper than widening `main.ts`'s surface for a test. Used by
 * `broker-outage.integration.spec.ts` to reproduce the exact bounded-wait shape
 * a gateway pointed at a dead broker is in at boot.
 */
export async function within(milliseconds: number, work: () => Promise<void>): Promise<boolean> {
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

/**
 * Starts a `supertest` request **now** and returns a promise for its
 * response, instead of the lazy `Test` object `supertest` hands back.
 *
 * A `supertest`/`superagent` `Test` does not go over the wire until something
 * calls `.then()` on it — which is exactly what `await` does, and exactly
 * what a suite must *not* do here: several suites need to build the request,
 * let it publish onto the broker, answer that publication from a
 * `ServiceDouble`, and only then see the HTTP response. Awaiting the `Test`
 * directly would deadlock, because nothing would have sent it yet. Wrapping
 * it in `Promise.resolve` calls `.then()` immediately (a thenable's `.then` is
 * invoked as soon as `Promise.resolve` adopts it) without blocking the caller,
 * so the request is in flight the moment this returns.
 */
export function fire<T>(test: PromiseLike<T>): Promise<T> {
  return Promise.resolve(test);
}

/** Polls `condition` until it is true, or throws after `timeoutMs`. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition not met within ${String(timeoutMs)}ms`);
}
