import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { EXCHANGES, QUEUES } from '@bank/contracts';
import type { MessageEnvelope, QueueDescriptor } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { ListNotificationsUseCase } from './application/list-notifications.use-case';
import { QueryAuditUseCase } from './application/query-audit.use-case';
import { RecordEventUseCase } from './application/record-event.use-case';
import { AppModule } from './app.module';
import { loadDotEnvFile, loadEnvironment } from './infrastructure/config/environment';
import { BrokerReplyPublisher } from './infrastructure/messaging/broker-reply.publisher';
import { SimulatedNotificationAdapter } from './infrastructure/notification/simulated-notification.adapter';
import { migrate } from './infrastructure/persistence/migrations';
import { PostgresAuditRepository } from './infrastructure/persistence/postgres-audit.repository';
import { InboundMessageRouter } from './interfaces/inbound-message.handler';
import { StructuredLogger } from './interfaces/logging';
import {
  AuditQueryHandler,
  NotificationListHandler,
  RecordEventHandler,
} from './interfaces/message-handlers';

/** Every queue this service owns: four families of events, plus the questions. */
const OWNED: readonly QueueDescriptor[] = QUEUES.filter(
  (queue) => queue.owner === 'notification-audit-service',
);

/** The one that carries questions rather than things that happened. */
const QUERY_QUEUE = 'audit.query';

/**
 * Composition: the one place allowed to see every layer at once.
 *
 * Two decisions here are worth reading before changing anything.
 *
 * **No validator is passed to `subscribe`.** Every other service in the bank
 * hands `messageValidator` to the broker, which parks anything that fails it
 * onto the error exchange before the handler runs. Doing that here would mean
 * the malformed message never reaches the service whose entire job is to record
 * that it arrived — criterion 3 would be unsatisfiable by construction. So this
 * service takes everything its queues carry and decides for itself, in
 * `RecordEventHandler`, writing `PROCESSED` or `INVALID` and telling the
 * producer nothing either way.
 *
 * **Migrations run before any queue is consumed.** A replica that starts taking
 * events against a schema that does not exist yet fails every one of them into
 * the retry ladder, which looks like an outage and is really a race with its
 * own boot.
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

  const repository = new PostgresAuditRepository(pool);
  /**
   * Outside production the simulated channel prints the activation link it was
   * given, which is what a local mail catcher does and what makes signing up on
   * your own machine possible at all — this service now drains the queue the
   * token used to be readable from. In production the link is never written
   * anywhere. See the adapter, and TD-043.
   */
  const sender = new SimulatedNotificationAdapter(
    logger,
    environment.NODE_ENV !== 'production',
  );
  const broker = new MessageBroker({
    url: environment.RABBITMQ_URL,
    exchanges: [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies],
    errorExchange: EXCHANGES.errors,
  });

  const clock = { now: (): Date => new Date() };
  const ids = { next: (): string => randomUUID() };
  const publisherFactory = new BrokerReplyPublisher(broker);

  const recorderFor = (consumer: string): RecordEventHandler =>
    new RecordEventHandler(
      new RecordEventUseCase({ repository, sender, clock, ids }),
      consumer,
      logger,
    );

  /**
   * A router per delivery, because the publisher is bound to the question being
   * answered. One shared router with a mutable "current cause" would answer one
   * administrator's audit query with another's correlation the first time two
   * people looked something up at once.
   */
  const routerFor = (envelope: MessageEnvelope<unknown>): InboundMessageRouter => {
    const publisher = publisherFactory.forCause(envelope);

    return new InboundMessageRouter([
      new AuditQueryHandler(new QueryAuditUseCase({ repository, publisher })),
      new NotificationListHandler(new ListNotificationsUseCase({ repository, publisher })),
    ]);
  };

  await broker.start();

  for (const queue of OWNED) {
    const recorder = queue.name === QUERY_QUEUE ? null : recorderFor(queue.name);

    await broker.subscribe({ queue: queue.name, bindings: queue.bindings }, async (envelope) => {
      const startedAt = Date.now();

      try {
        if (recorder === null) {
          const taken = await routerFor(envelope).route(envelope);

          if (!taken) {
            logger.info('question not claimed', {
              messageType: envelope.messageType,
              correlationId: envelope.correlationId,
              consumer: queue.name,
              durationMs: Date.now() - startedAt,
            });
          }

          return;
        }

        await recorder.handle(envelope);
      } catch (error) {
        /**
         * Logged and rethrown. The throw is what sends the message down the
         * retry ladder, and the log is what explains, three retries later, why
         * it ended up in the dead-letter queue.
         *
         * Only a failure of *this* service reaches here. A malformed payload
         * does not: it is recorded as `INVALID` and acknowledged, because
         * retrying a message that cannot be parsed produces the same answer
         * three more times and criterion 3 says the producer must not be
         * affected either way.
         */
        logger.error('message failed', {
          messageType: envelope.messageType,
          correlationId: envelope.correlationId,
          consumer: queue.name,
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

  logger.info('notification-audit-service listening', {
    outcome: `port ${String(environment.PORT)}, queues ${OWNED.map((q) => q.name).join(', ')}`,
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
