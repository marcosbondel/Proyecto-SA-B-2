import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { EXCHANGES, QUEUES } from '@bank/contracts';
import type { MessageEnvelope, QueueDescriptor } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { AdvanceSagaUseCase } from './application/advance-saga.use-case';
import { GetTransactionStatusUseCase } from './application/get-transaction-status.use-case';
import { GetTransactionStatsUseCase } from './application/get-transaction-stats.use-case';
import { ListTransactionsUseCase } from './application/list-transactions.use-case';
import { RecordPaymentAttemptUseCase } from './application/record-payment-attempt.use-case';
import { RequestTransferUseCase } from './application/request-transfer.use-case';
import { AppModule } from './app.module';
import { loadDotEnvFile, loadEnvironment } from './infrastructure/config/environment';
import { BrokerEventPublisher } from './infrastructure/messaging/broker-event.publisher';
import { migrate } from './infrastructure/persistence/migrations';
import { PostgresTransactionRepository } from './infrastructure/persistence/postgres-transaction.repository';
import { OutboxRelay } from './infrastructure/scheduler/outbox.scheduler';
import { OtelTransferTelemetry } from './infrastructure/telemetry/otel-transfer.telemetry';
import { InboundMessageRouter } from './interfaces/inbound-message.handler';
import { StructuredLogger } from './interfaces/logging';
import {
  PaymentAttemptFailedHandler,
  RequestTransferHandler,
  TransactionListHandler,
  TransactionStatsHandler,
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
 * How long to wait before trying the database again when it is unreachable.
 *
 * Matched to the broker's own reconnect interval, so a stack coming up together
 * does not produce two unrelated retry rhythms in one log.
 */
const ATTACH_RETRY_DELAY_MS = 5_000;

/**
 * How often the outbox relay sweeps for messages to publish. Short, because it
 * sits in the Saga's critical path — every hop waits at most this long between
 * the transition committing and its command being sent. Overridable with
 * `OUTBOX_RELAY_MS`; a malformed value falls back rather than turning
 * `setInterval` into a busy loop.
 */
const OUTBOX_RELAY_INTERVAL_MS = ((): number => {
  const raw = Number(process.env.OUTBOX_RELAY_MS);

  return Number.isFinite(raw) && raw > 0 ? raw : 200;
})();

/**
 * Composition: the one place allowed to see every layer at once.
 *
 * Everything above this file is wired through ports, which is what lets the use
 * cases be tested with fakes and what stops a transition rule from acquiring a
 * dependency on PostgreSQL by accident. Here, and only here, the real adapters
 * are chosen.
 *
 * The order matters twice. Migrations run **before** either queue is consumed:
 * a replica that starts taking `account.debited.v1` against a schema that does
 * not exist yet fails every one of them into the retry ladder — which looks
 * like an outage and is really a race with its own boot, and which for this
 * service means Sagas stalled after the money has already left. And since T-21
 * both happen **after** the port is open — see `attach` below for why.
 */
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

  const repository = new PostgresTransactionRepository(pool);
  const broker = new MessageBroker({
    url: environment.RABBITMQ_URL,
    exchanges: [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies],
    errorExchange: EXCHANGES.errors,
  });

  const clock = { now: (): Date => new Date() };
  const ids = { next: (): string => randomUUID() };
  // One instance for the process: the telemetry reads the correlation id off the
  // transaction itself, so there is no per-delivery state to bind.
  const telemetry = new OtelTransferTelemetry(logger);
  const publisherFactory = new BrokerEventPublisher(broker);

  /**
   * The relay that carries the outbox to the broker. The Saga writes each
   * command and event it orders into the outbox in the transition's own
   * transaction (TD-031); this is what finally publishes them, so nothing is
   * lost to a crash between the commit and a send.
   */
  const outboxRelay = new OutboxRelay({
    repository,
    broker,
    intervalMs: OUTBOX_RELAY_INTERVAL_MS,
    logger,
  });

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
    const saga = new AdvanceSagaUseCase({ repository, publisher, clock, ids, telemetry });

    return new InboundMessageRouter([
      new RequestTransferHandler(
        new RequestTransferUseCase({ repository, publisher, saga, clock, telemetry }),
        logger,
      ),
      new TransactionStatusHandler(new GetTransactionStatusUseCase({ repository, publisher })),
      new TransactionListHandler(new ListTransactionsUseCase({ repository, publisher })),
      new TransactionStatsHandler(new GetTransactionStatsUseCase({ repository, publisher })),
      new PaymentAttemptFailedHandler(new RecordPaymentAttemptUseCase({ repository, telemetry }), logger),
      ...sagaHandlers(saga, logger),
    ]);
  };

  /** Every queue this service owns, attached in one go. */
  const subscribeAll = async (): Promise<void> => {
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
        outboxRelay.start();
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

  logger.info('transaction-service listening', {
    outcome: `port ${String(environment.PORT)}, queues ${OWNED.map((q) => q.name).join(' and ')}`,
  });

  /** Not awaited: the port is already open and this is what fills it in. */
  void attach();

  const shutdown = async (): Promise<void> => {
    outboxRelay.stop();
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
