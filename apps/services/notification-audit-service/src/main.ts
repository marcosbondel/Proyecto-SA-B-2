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
 * How long to wait before trying the database again when it is unreachable.
 *
 * Matched to the broker's own reconnect interval, so a stack coming up together
 * does not produce two unrelated retry rhythms in one log.
 */
const ATTACH_RETRY_DELAY_MS = 5_000;

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
 * own boot. Since T-21 both happen *after* the port is open — see `attach`
 * below for why.
 */
async function bootstrap(): Promise<void> {
  loadDotEnvFile();
  const environment = loadEnvironment();
  const logger = new StructuredLogger();

  const pool = new Pool({ connectionString: environment.DATABASE_URL });

  const repository = new PostgresAuditRepository(pool);
  /**
   * The simulated channel prints the activation link when — and only when —
   * `REVEAL_ACTIVATION_LINKS` says so. It defaults to on outside production and
   * off inside it, which is what a local mail catcher does and what makes
   * signing up on your own machine possible at all: this service drains the
   * queue the token used to be readable from.
   *
   * It is a flag of its own rather than a reading of `NODE_ENV` because the
   * production images are what a kind deployment runs, and with the link closed
   * there is no way to complete a sign-up anywhere in the system. See the
   * adapter, TD-043 and TD-044.
   */
  const sender = new SimulatedNotificationAdapter(logger, environment.REVEAL_ACTIVATION_LINKS);
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

  /** Every queue this service owns, attached in one go. */
  const subscribeAll = async (): Promise<void> => {
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
  };

  /**
   * Flipped once the queues are actually being consumed, and reported by
   * readiness.
   *
   * A replica that has reached its database and its broker but has not yet
   * attached to its queues can take no work. Without this field readiness would
   * say "ready" during that window — a lie introduced by the very reordering
   * below that keeps liveness honest.
   */
  let consuming = false;

  /**
   * Everything that needs a database or a broker, behind an already-open port.
   *
   * Until T-21 this ran *before* `listen`, which meant that while PostgreSQL or
   * RabbitMQ was briefly unavailable the process never answered `/health`, the
   * Docker `HEALTHCHECK` reported it unhealthy, and Kubernetes restarted it — a
   * crash loop caused by a recoverable dependency, which is the one thing a
   * liveness probe must never cause. Now the port opens first and readiness
   * stays degraded until this finishes.
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

        await broker.start();
        await subscribeAll();
        consuming = true;

        logger.info('consuming', { outcome: OWNED.map((queue) => queue.name).join(', ') });

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

  logger.info('notification-audit-service listening', {
    outcome: `port ${String(environment.PORT)}, queues ${OWNED.map((q) => q.name).join(', ')}`,
  });

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
