import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { EXCHANGES, QUEUES } from '@bank/contracts';
import type { MessageEnvelope, QueueDescriptor } from '@bank/contracts';
import {
  FAILURE_REASON_HEADER,
  MessageBroker,
  ORIGINAL_ROUTING_KEY_HEADER,
  parseEnvelope,
} from '@bank/messaging';
import type { ParkedMessage } from '@bank/messaging';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { ListNotificationsUseCase } from './application/list-notifications.use-case';
import { MarkNotificationsReadUseCase } from './application/mark-notifications-read.use-case';
import { ReadInboxUseCase } from './application/read-inbox.use-case';
import { GetAuditStatsUseCase } from './application/get-audit-stats.use-case';
import { QueryAuditUseCase } from './application/query-audit.use-case';
import { RecordEventUseCase } from './application/record-event.use-case';
import { AppModule } from './app.module';
import { loadDotEnvFile, loadEnvironment } from './infrastructure/config/environment';
import { BrokerReplyPublisher } from './infrastructure/messaging/broker-reply.publisher';
import { ResendNotificationAdapter } from './infrastructure/notification/resend-notification.adapter';
import { SimulatedNotificationAdapter } from './infrastructure/notification/simulated-notification.adapter';
import { migrate } from './infrastructure/persistence/migrations';
import { PostgresAuditRepository } from './infrastructure/persistence/postgres-audit.repository';
import { InboundMessageRouter } from './interfaces/inbound-message.handler';
import { StructuredLogger } from './interfaces/logging';
import {
  AuditQueryHandler,
  AuditStatsHandler,
  NotificationInboxHandler,
  NotificationListHandler,
  NotificationMarkReadHandler,
  RecordEventHandler,
} from './interfaces/message-handlers';

/** Every queue this service owns: four families of events, plus the questions. */
const OWNED: readonly QueueDescriptor[] = QUEUES.filter(
  (queue) => queue.owner === 'notification-audit-service',
);

/** The one that carries questions rather than things that happened. */
const QUERY_QUEUE = 'audit.query';

/**
 * The consumer name every drained parked message is recorded under. A name of
 * its own, distinct from the four family queues, so a message the system failed
 * to process is a *separate* fact keyed by `(eventId, error-drain)` — never a
 * duplicate of the copy this service already recorded on `audit.<family>`, and
 * never colliding with it.
 */
const ERROR_DRAIN_CONSUMER = 'error-drain';

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
/** One header value, but only when it really is a string. */
function headerString(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name];

  return typeof value === 'string' ? value : undefined;
}

/** The delivery body as an envelope, or `null` when it is not one at all. */
function tryParseEnvelope(content: Buffer): MessageEnvelope<unknown> | null {
  try {
    return parseEnvelope(content);
  } catch {
    return null;
  }
}

async function bootstrap(): Promise<void> {
  loadDotEnvFile();
  const environment = loadEnvironment();
  const logger = new StructuredLogger();

  const pool = new Pool({ connectionString: environment.DATABASE_URL });

  // Without this listener the process dies the first time the database drops a
  // connection it had already established. `pg`'s Pool emits 'error' on an idle
  // client — PostgreSQL sends "terminating connection due to administrator
  // command" on shutdown — and an unhandled 'error' event is a fatal exception
  // in Node, so the container exits 1 and kubelet restarts it.
  //
  // That is a different failure from the one the boot sequence already handles.
  // A database that is *absent* (ECONNREFUSED) leaves this service alive and
  // unready by design; a database that *goes away mid-connection* used to kill
  // it. Only the second one needed fixing: the pool discards the broken client
  // and dials again by itself, so all that was missing was somebody listening.
  pool.on('error', (error: Error) => {
    logger.error('idle database client errored; the pool will reconnect', {
      error: error.message,
    });
  });

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
  const simulated = new SimulatedNotificationAdapter(logger, environment.REVEAL_ACTIVATION_LINKS);

  /**
   * `resend` delivers the one email that carries a real address — activation —
   * for real, and falls back to the simulated channel for every other
   * notification, which has no real inbox by design. `simulated` (the default)
   * sends nothing and only logs. The choice is made once, here.
   */
  const sender =
    environment.NOTIFICATION_CHANNEL === 'resend'
      ? new ResendNotificationAdapter(
          {
            apiKey: environment.RESEND_API_KEY ?? '',
            from: environment.EMAIL_FROM ?? '',
            appBaseUrl: environment.APP_BASE_URL ?? '',
            endpoint: environment.RESEND_API_URL,
          },
          logger,
          simulated,
        )
      : simulated;
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
      new AuditStatsHandler(new GetAuditStatsUseCase({ repository, publisher })),
      new NotificationListHandler(new ListNotificationsUseCase({ repository, publisher })),
      new NotificationInboxHandler(new ReadInboxUseCase({ repository, publisher })),
      new NotificationMarkReadHandler(
        new MarkNotificationsReadUseCase({ repository, publisher, clock }),
      ),
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
   * The error exchange, drained. Every message that exhausted its retry ladder
   * or could not be parsed was published to `bank.errors` by the broker — and,
   * with no queue bound there, silently discarded. That is a hole in the one
   * service whose entire job is to record what arrived: the events most worth
   * investigating, the ones the system could not process, were the only ones it
   * never saw.
   *
   * Recorded `INVALID`, under a consumer of its own so the row is a distinct
   * fact and never a duplicate of the copy already on `audit.<family>`. A parked
   * message is never notified about (the recorder only notifies `PROCESSED`) and
   * never re-parked (the drain acknowledges whatever happens), so this closes the
   * hole without adding a new failure of its own.
   */
  const drainRecorder = new RecordEventUseCase({ repository, sender, clock, ids });

  const drainErrors = async (): Promise<void> => {
    await broker.drainErrors(async (parked: ParkedMessage): Promise<void> => {
      const reason = headerString(parked.headers, FAILURE_REASON_HEADER) ?? 'no reason recorded';
      const originalRoutingKey =
        headerString(parked.headers, ORIGINAL_ROUTING_KEY_HEADER) ?? parked.routingKey;

      /**
       * Best-effort: a parked delivery may be the very body that would not parse.
       * When it does parse, the row carries the real flow — its `messageId`,
       * `correlationId` and (redacted) payload. When it does not, only metadata
       * is stored, never the raw bytes: an unparseable body may carry anything,
       * and redaction hides values by field *name*, so raw text would slip past
       * it. The reason and the routing key are enough to investigate from.
       */
      const envelope = tryParseEnvelope(parked.content);

      const event =
        envelope === null
          ? {
              eventId: ids.next(),
              messageType: originalRoutingKey.length > 0 ? originalRoutingKey : 'unknown',
              messageVersion: 0,
              producer: 'unknown',
              occurredAt: clock.now(),
              correlationId: ids.next(),
              causationId: null,
              payload: { unparseable: true, failureReason: reason, originalRoutingKey },
              processingStatus: 'INVALID' as const,
              consumer: ERROR_DRAIN_CONSUMER,
            }
          : {
              eventId: envelope.messageId,
              messageType: envelope.messageType,
              messageVersion: envelope.messageVersion,
              producer: envelope.producer,
              occurredAt: new Date(envelope.occurredAt),
              correlationId: envelope.correlationId,
              causationId: envelope.causationId,
              payload: envelope.payload,
              processingStatus: 'INVALID' as const,
              consumer: ERROR_DRAIN_CONSUMER,
            };

      const outcome = await drainRecorder.execute({ event, customerId: null });

      logger.info('parked message recorded', {
        outcome: outcome.kind,
        consumer: ERROR_DRAIN_CONSUMER,
        messageType: event.messageType,
        correlationId: event.correlationId,
        reason,
      });
    });
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
        await drainErrors();
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
