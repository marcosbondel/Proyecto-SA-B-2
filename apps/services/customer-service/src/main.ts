import 'reflect-metadata';

import { EXCHANGES, QUEUES } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { AuthenticateCustomerUseCase } from './application/authenticate-customer.use-case';
import { ChangePasswordUseCase } from './application/change-password.use-case';
import { ConfirmPasswordResetUseCase } from './application/confirm-password-reset.use-case';
import { GetCustomerUseCase } from './application/get-customer.use-case';
import { GetPendingValidationUseCase } from './application/get-pending-validation.use-case';
import { RegisterCustomerUseCase } from './application/register-customer.use-case';
import { RequestPasswordResetUseCase } from './application/request-password-reset.use-case';
import { SetIdentityVerdictUseCase } from './application/set-identity-verdict.use-case';
import { UpdateCustomerUseCase } from './application/update-customer.use-case';
import { ValidateIdentityUseCase } from './application/validate-identity.use-case';
import { VerifyEmailActivationUseCase } from './application/verify-email-activation.use-case';
import { AppModule } from './app.module';
import { loadDotEnvFile, loadEnvironment } from './infrastructure/config/environment';
import { BrokerEventPublisher } from './infrastructure/messaging/broker-event.publisher';
import { migrate } from './infrastructure/persistence/migrations';
import { seedDemoUsers } from './infrastructure/persistence/seed-demo-data';
import { PostgresCustomerRepository } from './infrastructure/persistence/postgres-customer.repository';
import {
  RandomActivationTokenFactory,
  ScryptPasswordHasher,
} from './infrastructure/security/scrypt-password-hasher';
import { S3IdentityDocumentReader } from './infrastructure/storage/s3-identity-document.reader';
import { InboundMessageRouter } from './interfaces/inbound-message.handler';
import { StructuredLogger } from './interfaces/logging';
import {
  AuthenticateCustomerHandler,
  ChangePasswordHandler,
  ConfirmPasswordResetHandler,
  RegisterCustomerHandler,
  RequestPasswordResetHandler,
  GetCustomerHandler,
  GetPendingValidationHandler,
  SetIdentityVerdictHandler,
  UpdateCustomerHandler,
  ValidateIdentityHandler,
  VerifyEmailHandler,
} from './interfaces/message-handlers';

/** The queue this service owns, as `@bank/contracts` declares it. */
const QUEUE = QUEUES.find((queue) => queue.owner === 'customer-service')!;

/**
 * How long to wait before trying the database again when it is unreachable.
 *
 * Matched to the broker's own reconnect interval, so a stack coming up together
 * does not produce two unrelated retry rhythms in one log.
 */
const ATTACH_RETRY_DELAY_MS = 5_000;

/**
 * Composition: the one place allowed to see every layer at once.
 *
 * Everything above this file is wired through ports, which is what lets the use
 * cases be tested with fakes and what stops a domain rule from acquiring a
 * dependency on PostgreSQL by accident. Here, and only here, the real adapters
 * are chosen.
 *
 * The order matters. Migrations run **before** the queue is consumed: a replica
 * that starts taking commands against a schema that does not exist yet fails
 * every one of them into the retry ladder, which looks like an outage and is
 * really a race with its own boot.
 */
async function bootstrap(): Promise<void> {
  loadDotEnvFile();
  const environment = loadEnvironment();
  const logger = new StructuredLogger();

  const pool = new Pool({ connectionString: environment.DATABASE_URL });
  const repository = new PostgresCustomerRepository(pool);
  const broker = new MessageBroker({
    url: environment.RABBITMQ_URL,
    exchanges: [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies],
    errorExchange: EXCHANGES.errors,
  });

  const documents = new S3IdentityDocumentReader({
    endpoint: environment.OBJECT_STORAGE_ENDPOINT,
    accessKey: environment.OBJECT_STORAGE_ACCESS_KEY,
    secretKey: environment.OBJECT_STORAGE_SECRET_KEY,
    bucket: environment.OBJECT_STORAGE_BUCKET,
    region: environment.OBJECT_STORAGE_REGION,
  });

  const hasher = new ScryptPasswordHasher();
  const tokens = new RandomActivationTokenFactory();
  const clock = { now: (): Date => new Date() };
  const publisherFactory = new BrokerEventPublisher(broker);

  /**
   * A router per delivery, because the publisher is bound to the message it is
   * answering. One shared router with a mutable "current cause" would attribute
   * one request's events to another's correlation the first time two commands
   * arrive at once.
   */
  const routerFor = (envelope: MessageEnvelope<unknown>): InboundMessageRouter => {
    const publisher = publisherFactory.forCause(envelope);

    return new InboundMessageRouter([
      new RegisterCustomerHandler(
        new RegisterCustomerUseCase({ repository, publisher, hasher, tokens, documents, clock }),
      ),
      new UpdateCustomerHandler(new UpdateCustomerUseCase({ repository, publisher, clock })),
      new GetCustomerHandler(new GetCustomerUseCase({ repository, publisher })),
      new GetPendingValidationHandler(
        new GetPendingValidationUseCase({ repository, publisher }),
      ),
      new SetIdentityVerdictHandler(
        new SetIdentityVerdictUseCase({ repository, publisher, clock }),
      ),
      new AuthenticateCustomerHandler(
        new AuthenticateCustomerUseCase({ repository, publisher, hasher, tokens, clock }),
      ),
      new VerifyEmailHandler(
        new VerifyEmailActivationUseCase({ repository, publisher, tokens, clock }),
      ),
      new ChangePasswordHandler(
        new ChangePasswordUseCase({ repository, publisher, hasher, clock }),
      ),
      new RequestPasswordResetHandler(
        new RequestPasswordResetUseCase({ repository, publisher, tokens, clock }),
      ),
      new ConfirmPasswordResetHandler(
        new ConfirmPasswordResetUseCase({ repository, publisher, hasher, tokens, clock }),
      ),
      new ValidateIdentityHandler(
        new ValidateIdentityUseCase({ repository, publisher, documents, clock }),
      ),
    ]);
  };

  const onDelivery = async (envelope: MessageEnvelope<unknown>): Promise<void> => {
    const startedAt = Date.now();

    try {
      const taken = await routerFor(envelope).route(envelope);

      logger.info(taken ? 'message handled' : 'message not claimed', {
        messageType: envelope.messageType,
        correlationId: envelope.correlationId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      /**
       * Logged and rethrown. The throw is what sends the message down the retry
       * ladder, and the log is what explains, three retries later, why it ended
       * up in the dead-letter queue.
       */
      logger.error('message failed', {
        messageType: envelope.messageType,
        correlationId: envelope.correlationId,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  };

  /**
   * Flipped once the queue is actually being consumed, and reported by
   * readiness.
   *
   * A replica that has reached its database and its broker but has not yet
   * attached to its queue can take no work. Without this field readiness would
   * say "ready" during that window — a lie introduced by the very reordering
   * below that keeps liveness honest.
   */
  let consuming = false;

  /**
   * Migrations, then the queue — in that order, and behind an open port.
   *
   * The order between the two is the old one and still matters: a replica that
   * starts taking commands against a schema that does not exist yet fails every
   * one of them into the retry ladder, which looks like an outage and is really
   * a race with its own boot.
   *
   * What T-21 changed is that neither happens *before* `listen`. Waiting on a
   * database or a broker in front of the port means that while either is
   * briefly unavailable the process never answers `/health`, the Docker
   * `HEALTHCHECK` reports it unhealthy, and Kubernetes restarts it — a crash
   * loop caused by a recoverable dependency, which is the one thing a liveness
   * probe must never cause. Now the port opens first, liveness answers from the
   * start, and readiness stays degraded until this function finishes.
   *
   * Retried rather than fatal: `migrate` throws while PostgreSQL is
   * unreachable, and dying there would be the same crash loop by another route.
   * A pod that is `Running` and never `Ready` names the problem; one in
   * `CrashLoopBackOff` hides it. `broker.start()` needs no retry of its own — it
   * does not reject while the broker is down, it waits, and the connection
   * manager reconnects underneath it.
   *
   * A *configuration* error is still fatal, and still happens before any of
   * this: `loadEnvironment()` exits non-zero naming the offending variables,
   * because no amount of retrying repairs a malformed `DATABASE_URL`.
   */
  const attach = async (): Promise<void> => {
    for (;;) {
      try {
        const applied = await migrate(pool);

        if (applied.length > 0) {
          logger.info('schema migrations applied', { outcome: applied.join(', ') });
        }

        /**
         * Demo users, right after the schema exists and before any command is
         * taken, so a fresh stack can be signed into at once. Gated and
         * idempotent — see `seedDemoUsers`.
         */
        if (environment.SEED_DEMO_DATA) {
          const seeded = await seedDemoUsers(pool, hasher, environment.SEED_PASSWORD);
          logger.info('demo users seeded', { outcome: seeded.join(', ') });
        }

        await broker.start();
        await broker.subscribe({ queue: QUEUE.name, bindings: QUEUE.bindings }, onDelivery);
        consuming = true;

        logger.info('consuming', { outcome: QUEUE.name });

        return;
      } catch (error) {
        logger.error('dependencies unavailable; staying alive and unready', {
          error: error instanceof Error ? error.message : String(error),
        });

        await new Promise((resolve) => setTimeout(resolve, ATTACH_RETRY_DELAY_MS));
      }
    }
  };

  const application = await NestFactory.create(
    AppModule.withDependencies({
      isBrokerConnected: () => broker.isConnected(),
      isDatabaseReachable: async () => await repository.isReachable(),
      isConsuming: () => consuming,
    }),
  );

  await application.listen(environment.PORT);

  logger.info('customer-service listening', { outcome: `port ${String(environment.PORT)}` });

  /** Not awaited: the port is already open and this is what fills it in. */
  void attach();

  const shutdown = async (): Promise<void> => {
    await application.close();
    await broker.stop();
    await pool.end();
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
