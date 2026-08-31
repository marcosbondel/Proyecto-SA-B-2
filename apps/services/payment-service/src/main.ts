import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { EXCHANGES, QUEUES, validateMessage } from '@bank/contracts';
import type { MessageEnvelope, QueueDescriptor } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { ProcessPaymentUseCase } from './application/process-payment.use-case';
import { GetPaymentStatsUseCase } from './application/get-payment-stats.use-case';
import { QueryPaymentUseCase } from './application/query-payment.use-case';
import { AppModule } from './app.module';
import {
  loadDotEnvFile,
  loadEnvironment,
  parseRetryDelays,
} from './infrastructure/config/environment';
import { BrokerEventPublisher } from './infrastructure/messaging/broker-event.publisher';
import { migrate } from './infrastructure/persistence/migrations';
import { PostgresPaymentRepository } from './infrastructure/persistence/postgres-payment.repository';
import { OutboxRelay } from './infrastructure/scheduler/outbox.scheduler';
import { RetryScheduler } from './infrastructure/scheduler/retry.scheduler';
import { InboundMessageRouter } from './interfaces/inbound-message.handler';
import { StructuredLogger } from './interfaces/logging';
import {
  ListPaymentsHandler,
  PaymentStatsHandler,
  PaymentStatusHandler,
  ProcessPaymentHandler,
} from './interfaces/message-handlers';

/** The queue this service owns, as `@bank/contracts` declares it. */
const QUEUE: QueueDescriptor = QUEUES.find((queue) => queue.owner === 'payment-service')!;

/**
 * How long to wait before trying the database again when it is unreachable.
 *
 * Matched to the broker's own reconnect interval, so a stack coming up together
 * does not produce two unrelated retry rhythms in one log.
 */
const ATTACH_RETRY_DELAY_MS = 5_000;

/** How many due payments one sweep takes. Bounded so a backlog cannot stall a pod. */
const SWEEP_BATCH = 20;

/**
 * How often the outbox relay sweeps for events to publish. Short, because a
 * terminal event waiting here is a transfer waiting to finish or compensate.
 * Overridable with `OUTBOX_RELAY_MS`; a malformed value falls back rather than
 * turning `setInterval` into a busy loop.
 */
const OUTBOX_RELAY_INTERVAL_MS = ((): number => {
  const raw = Number(process.env.OUTBOX_RELAY_MS);

  return Number.isFinite(raw) && raw > 0 ? raw : 200;
})();

/**
 * Composition: the one place allowed to see every layer at once.
 *
 * Everything above this file is wired through ports, which is what lets the
 * retry ladder be tested with a fake clock and no broker in sight. Here, and
 * only here, the real adapters are chosen.
 *
 * The order matters three times. Migrations run **before** the queue is
 * consumed: a replica taking `payment.requested.v1` against a schema that does
 * not exist yet fails every one into the retry ladder, which for this service
 * means transfers stalled at `PAYMENT_PENDING` with the money already debited.
 * The sweeper starts **after** the broker, because an attempt it cannot
 * announce is a payment decided with nobody told — and the Saga waiting forever
 * on the event that never came. And all three happen **after** the port is
 * open, so a liveness probe can answer during an outage instead of causing a
 * restart loop (T-21).
 */
async function bootstrap(): Promise<void> {
  loadDotEnvFile();
  const environment = loadEnvironment();
  const logger = new StructuredLogger();
  const delays = parseRetryDelays(environment.PAYMENT_RETRY_DELAYS_MS);

  const pool = new Pool({ connectionString: environment.DATABASE_URL });
  const repository = new PostgresPaymentRepository(pool);

  const broker = new MessageBroker({
    url: environment.RABBITMQ_URL,
    exchanges: [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies],
    errorExchange: EXCHANGES.errors,
  });

  const clock = { now: (): Date => new Date() };
  const ids = { next: (): string => randomUUID() };
  const publisherFactory = new BrokerEventPublisher(broker);

  const processPayment = new ProcessPaymentUseCase({ repository, clock, ids, delays });
  const queryPayment = new QueryPaymentUseCase({ repository });

  /**
   * A router per delivery, because the publisher is bound to the message being
   * handled. One shared router with a mutable "current cause" would attribute
   * one transfer's payment events to another's correlation the first time two
   * transfers were in flight at once.
   */
  const routerFor = (envelope: MessageEnvelope<unknown>): InboundMessageRouter => {
    const publisher = publisherFactory.forCause(envelope);

    return new InboundMessageRouter([
      new ProcessPaymentHandler(processPayment, publisher),
      new ListPaymentsHandler(queryPayment, publisher),
      new PaymentStatusHandler(queryPayment, publisher),
      new PaymentStatsHandler(new GetPaymentStatsUseCase({ repository, publisher })),
    ]);
  };

  const onDelivery = async (envelope: MessageEnvelope<unknown>): Promise<void> => {
    const startedAt = Date.now();

    try {
      const taken = await routerFor(envelope).route(envelope);

      if (!taken) {
        /**
         * Not a failure. `payment.commands` is bound to `payment.#`, so a
         * command this service has no handler for is a queue doing what it was
         * declared to do.
         */
        logger.info('message not claimed', {
          messageType: envelope.messageType,
          correlationId: envelope.correlationId,
          durationMs: Date.now() - startedAt,
        });

        return;
      }

      logger.info('message handled', {
        messageType: envelope.messageType,
        correlationId: envelope.correlationId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      /**
       * Logged and rethrown. The throw is what sends the message down the retry
       * ladder, and the log is what explains, three retries later, why it ended
       * up in the dead-letter queue — which for this service is a transfer that
       * stopped moving after the money left.
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
   * One sweep: every payment the ladder currently owes an attempt.
   *
   * Each is caught on its own, because one payment whose provider call threw
   * must not leave the other nineteen unattempted — the sweep is the only thing
   * that will ever come back for them.
   */
  const sweepOnce = async (): Promise<number> => {
    const due = await repository.due(clock.now(), SWEEP_BATCH);
    let attempted = 0;

    for (const payment of due) {
      try {
        await processPayment.retry(
          payment,
          publisherFactory.forRetry(payment.originCorrelationId ?? randomUUID()),
        );
        attempted += 1;
      } catch (error) {
        logger.error('retry attempt failed', {
          paymentId: payment.paymentId,
          transactionId: payment.transactionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return attempted;
  };

  const scheduler = new RetryScheduler({
    job: { execute: sweepOnce },
    intervalMs: environment.PAYMENT_RETRY_SWEEP_MS,
    logger,
  });

  /**
   * The relay that carries the outbox to the broker. Each attempt writes the
   * event it produced into the outbox in the attempt's own transaction (TD-047);
   * this is what finally publishes them, so a terminal event is never lost to a
   * crash between the commit and a send.
   */
  const outboxRelay = new OutboxRelay({
    repository,
    broker,
    intervalMs: OUTBOX_RELAY_INTERVAL_MS,
    logger,
  });

  /**
   * Flipped once the queue is actually being consumed, and reported by
   * readiness. A replica that has reached its database and its broker but has
   * not yet attached can take no work.
   */
  let consuming = false;

  const attach = async (): Promise<void> => {
    for (;;) {
      try {
        const applied = await migrate(pool);

        if (applied.length > 0) {
          logger.info('schema migrations applied', { outcome: applied.join(', ') });
        }

        await broker.start();
        await broker.subscribe(
          { queue: QUEUE.name, bindings: QUEUE.bindings },
          onDelivery,
          /**
           * A message that is not a readable envelope is parked on the error
           * exchange before a handler sees it. Retrying something unparseable
           * produces the same answer three more times, and here each of those
           * costs a provider call and thirty-six seconds of a transfer sitting
           * at `PAYMENT_PENDING` with the money already debited.
           *
           * The other four services do **not** pass one, which is a divergence
           * from what `AGENTS.md` describes rather than a decision — recorded
           * as TD-046. This service passes it because it is the one where a
           * pointless retry is expensive.
           */
          validateMessage,
        );
        consuming = true;

        logger.info('consuming', { outcome: QUEUE.name });

        scheduler.start();
        logger.info('retry sweeper started', {
          outcome: `every ${String(environment.PAYMENT_RETRY_SWEEP_MS)} ms, ladder ${
            delays.length === 0 ? 'none' : delays.join('/')
          } ms`,
        });

        outboxRelay.start();
        logger.info('outbox relay started', {
          outcome: `every ${String(OUTBOX_RELAY_INTERVAL_MS)} ms`,
        });

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

  logger.info('payment-service listening', {
    outcome: `port ${String(environment.PORT)}, queue ${QUEUE.name}`,
  });

  /** Not awaited: the port is already open and this is what fills it in. */
  void attach();

  const shutdown = async (): Promise<void> => {
    scheduler.stop();
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
