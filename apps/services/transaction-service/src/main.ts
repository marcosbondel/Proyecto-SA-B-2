import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { EXCHANGES, QUEUES } from '@bank/contracts';
import type { MessageEnvelope, QueueDescriptor } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { AdvanceSagaUseCase } from './application/advance-saga.use-case';
import { GetTransactionStatusUseCase } from './application/get-transaction-status.use-case';
import { RequestTransferUseCase } from './application/request-transfer.use-case';
import { AppModule } from './app.module';
import { loadDotEnvFile, loadEnvironment } from './infrastructure/config/environment';
import { BrokerEventPublisher } from './infrastructure/messaging/broker-event.publisher';
import { migrate } from './infrastructure/persistence/migrations';
import { PostgresTransactionRepository } from './infrastructure/persistence/postgres-transaction.repository';
import { InboundMessageRouter } from './interfaces/inbound-message.handler';
import { StructuredLogger } from './interfaces/logging';
import {
  RequestTransferHandler,
  TransactionStatusHandler,
  sagaHandlers,
} from './interfaces/message-handlers';

/**
 * The two queues this service owns.
 *
 * Two and not one, deliberately, and the split is the catalogue's:
 * `transaction.commands` carries what somebody asked for, `transaction.saga`
 * carries what happened elsewhere. A single queue would put a status query
 * behind a backlog of Saga events — the fast question waiting on the slow
 * flow — and would make the two impossible to scale or to drain separately.
 */
const OWNED: readonly QueueDescriptor[] = QUEUES.filter(
  (queue) => queue.owner === 'transaction-service',
);

/**
 * Composition: the one place allowed to see every layer at once.
 *
 * Everything above this file is wired through ports, which is what lets the use
 * cases be tested with fakes and what stops a transition rule from acquiring a
 * dependency on PostgreSQL by accident. Here, and only here, the real adapters
 * are chosen.
 *
 * The order matters: migrations run **before** either queue is consumed. A
 * replica that starts taking `account.debited.v1` against a schema that does
 * not exist yet fails every one of them into the retry ladder — which looks
 * like an outage and is really a race with its own boot, and which for this
 * service means Sagas stalled after the money has already left.
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

  const repository = new PostgresTransactionRepository(pool);
  const broker = new MessageBroker({
    url: environment.RABBITMQ_URL,
    exchanges: [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies],
    errorExchange: EXCHANGES.errors,
  });

  const clock = { now: (): Date => new Date() };
  const ids = { next: (): string => randomUUID() };
  const publisherFactory = new BrokerEventPublisher(broker);

  /**
   * A router per delivery, because the publisher is bound to the message it is
   * reacting to. One shared router with a mutable "current cause" would
   * attribute one transfer's commands to another's correlation the first time
   * two transfers were in flight at once — and for a service whose entire
   * output is one correlated flow, that is the trail becoming unreadable
   * exactly when somebody needs it.
   */
  const routerFor = (envelope: MessageEnvelope<unknown>): InboundMessageRouter => {
    const publisher = publisherFactory.forCause(envelope);
    const saga = new AdvanceSagaUseCase({ repository, publisher, clock, ids });

    return new InboundMessageRouter([
      new RequestTransferHandler(
        new RequestTransferUseCase({ repository, publisher, saga, clock }),
        logger,
      ),
      new TransactionStatusHandler(new GetTransactionStatusUseCase({ repository, publisher })),
      ...sagaHandlers(saga, logger),
    ]);
  };

  await broker.start();

  for (const queue of OWNED) {
    await broker.subscribe({ queue: queue.name, bindings: queue.bindings }, async (envelope) => {
      const startedAt = Date.now();

      try {
        const taken = await routerFor(envelope).route(envelope);

        if (!taken) {
          logger.info('message not claimed', {
            messageType: envelope.messageType,
            correlationId: envelope.correlationId,
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (error) {
        /**
         * Logged and rethrown. The throw is what sends the message down the
         * retry ladder, and the log is what explains, three retries later, why
         * it ended up in the dead-letter queue — which for this service is a
         * Saga that stopped moving.
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
  }

  const application = await NestFactory.create(
    AppModule.withDependencies({
      isBrokerConnected: () => broker.isConnected(),
      isDatabaseReachable: async () => await repository.isReachable(),
    }),
  );

  await application.listen(environment.PORT);

  logger.info('transaction-service listening', {
    outcome: `port ${String(environment.PORT)}, queues ${OWNED.map((q) => q.name).join(' and ')}`,
  });

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
