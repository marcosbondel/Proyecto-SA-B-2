import 'reflect-metadata';

import { EXCHANGES, QUEUES } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { AuthenticateCustomerUseCase } from './application/authenticate-customer.use-case';
import { RegisterCustomerUseCase } from './application/register-customer.use-case';
import { UpdateCustomerUseCase } from './application/update-customer.use-case';
import { ValidateIdentityUseCase } from './application/validate-identity.use-case';
import { VerifyEmailActivationUseCase } from './application/verify-email-activation.use-case';
import { AppModule } from './app.module';
import { loadDotEnvFile, loadEnvironment } from './infrastructure/config/environment';
import { BrokerEventPublisher } from './infrastructure/messaging/broker-event.publisher';
import { migrate } from './infrastructure/persistence/migrations';
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
  RegisterCustomerHandler,
  UpdateCustomerHandler,
  ValidateIdentityHandler,
  VerifyEmailHandler,
} from './interfaces/message-handlers';

/** The queue this service owns, as `@bank/contracts` declares it. */
const QUEUE = QUEUES.find((queue) => queue.owner === 'customer-service')!;

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
  const applied = await migrate(pool);

  if (applied.length > 0) {
    logger.info('schema migrations applied', { outcome: applied.join(', ') });
  }

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
      new AuthenticateCustomerHandler(
        new AuthenticateCustomerUseCase({ repository, publisher, hasher, tokens, clock }),
      ),
      new VerifyEmailHandler(
        new VerifyEmailActivationUseCase({ repository, publisher, tokens, clock }),
      ),
      new ValidateIdentityHandler(
        new ValidateIdentityUseCase({ repository, publisher, documents, clock }),
      ),
    ]);
  };

  await broker.start();
  await broker.subscribe({ queue: QUEUE.name, bindings: QUEUE.bindings }, async (envelope) => {
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
  });

  const application = await NestFactory.create(
    AppModule.withDependencies({
      isBrokerConnected: () => broker.isConnected(),
      isDatabaseReachable: async () => await repository.isReachable(),
    }),
  );

  await application.listen(environment.PORT);

  logger.info('customer-service listening', { outcome: `port ${String(environment.PORT)}` });

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
