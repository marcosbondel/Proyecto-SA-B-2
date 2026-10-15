// First, before anything else: see `instrumentation.ts` for why the order matters.
import { otel } from './instrumentation';
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { EXCHANGES, QUEUES, validateMessage } from '@bank/contracts';
import type { MessageEnvelope, QueueDescriptor } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';
import { continueTrace, nestLoggerFor } from '@bank/observability';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { SimulationUseCase } from './application/manage-simulation.use-case';
import { InterbankUseCase } from './application/interbank.use-case';
import { SendInterbankDepositUseCase } from './application/send-interbank-deposit.use-case';
import { ProcessPaymentUseCase } from './application/process-payment.use-case';
import { GetPaymentStatsUseCase } from './application/get-payment-stats.use-case';
import { QueryPaymentUseCase } from './application/query-payment.use-case';
import { AppModule } from './app.module';
import {
  loadDotEnvFile,
  loadEnvironment,
  parseRetryDelays,
  simulationDefaults,
} from './infrastructure/config/environment';
import { BrokerEventPublisher } from './infrastructure/messaging/broker-event.publisher';
import { BrokerInterbankMessenger } from './infrastructure/messaging/broker-interbank.messenger';
import { HttpPartnerBankClient, HttpPartnerCallback } from './infrastructure/http/partner-callback';
import { migrate } from './infrastructure/persistence/migrations';
import { PostgresPaymentRepository } from './infrastructure/persistence/postgres-payment.repository';
import { PostgresInterbankRepository } from './infrastructure/persistence/postgres-interbank.repository';
import { PostgresInterbankSendRepository } from './infrastructure/persistence/postgres-interbank-send.repository';
import { OutboxRelay } from './infrastructure/scheduler/outbox.scheduler';
import { OtelProviderTelemetry } from './infrastructure/telemetry/otel-provider.telemetry';
import {
  OtelInterbankSendTelemetry,
  OtelInterbankTelemetry,
} from './infrastructure/telemetry/otel-interbank.telemetry';
import { RetryScheduler } from './infrastructure/scheduler/retry.scheduler';
import { InboundMessageRouter } from './interfaces/inbound-message.handler';
import { StructuredLogger } from './interfaces/logging';
import {
  ListPaymentsHandler,
  InterbankCallbackHandler,
  InterbankCompensatedHandler,
  InterbankReceiveHandler,
  InterbankEligibilityReplyHandler,
  InterbankCreditedHandler,
  InterbankCreditRejectedHandler,
  PaymentStatsHandler,
  PaymentStatusHandler,
  ProcessPaymentHandler,
  SimulationQueryHandler,
  SimulationUpdateHandler,
} from './interfaces/message-handlers';

/** The queue this service owns, as `@bank/contracts` declares it. */
const QUEUE: QueueDescriptor = QUEUES.find((queue) => queue.name === 'payment.commands')!;
const INTERBANK_QUEUE: QueueDescriptor = QUEUES.find(
  (queue) => queue.name === 'payment.interbank',
)!;

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
  const repository = new PostgresPaymentRepository(pool);
  const interbankRepository = new PostgresInterbankRepository(pool);
  const interbankSendRepository = new PostgresInterbankSendRepository(pool);

  const broker = new MessageBroker({
    url: environment.RABBITMQ_URL,
    exchanges: [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies],
    errorExchange: EXCHANGES.errors,
  });

  const clock = { now: (): Date => new Date() };
  const ids = { next: (): string => randomUUID() };
  const publisherFactory = new BrokerEventPublisher(broker);
  const interbank = new InterbankUseCase({
    repository: interbankRepository,
    messenger: new BrokerInterbankMessenger(broker),
    callback: new HttpPartnerCallback(
      environment.INTERBANK_CALLBACK_URL,
      environment.INTERBANK_PARTNER_TOKEN,
    ),
    bankCode: environment.INTERBANK_BANK_CODE,
    partnerBankCode: environment.INTERBANK_PARTNER_BANK_CODE,
    maxAmountMinor: environment.INTERBANK_MAX_AMOUNT_MINOR,
    clock,
    telemetry: new OtelInterbankTelemetry(logger),
    trace: {
      continue: (traceparent, spanName, correlationId, work) =>
        continueTrace(traceparent, spanName, { 'bank.correlation_id': correlationId }, work),
    },
  });

  /**
   * El envío de depósitos al banco pareja (T-47).
   *
   * **`null` cuando no hay a dónde enviar.** Un despliegue sin
   * `INTERBANK_SEND_URL` —el caso normal mientras el auxiliar no asigne la
   * pareja— paga como siempre: el bloque `interbank` de un pago se ignora y el
   * pago va al proveedor simulado. Es deliberado: un banco sin banco pareja
   * sigue siendo un banco, y arrancar con una URL vacía habría dejado todo
   * depósito fallando contra `http://`.
   */
  const interbankSend =
    environment.INTERBANK_SEND_URL.length === 0
      ? null
      : new SendInterbankDepositUseCase({
          repository: interbankSendRepository,
          partner: new HttpPartnerBankClient(
            environment.INTERBANK_SEND_URL,
            environment.INTERBANK_PARTNER_TOKEN,
            environment.INTERBANK_BANK_CODE,
          ),
          messenger: new BrokerInterbankMessenger(broker),
          telemetry: new OtelInterbankSendTelemetry(logger),
          clock: clock.now,
          confirmationTimeoutMs: environment.INTERBANK_CONFIRMATION_TIMEOUT_MS,
          /*
           * La misma escalera que la de los pagos, y por el mismo motivo: si el
           * banco pareja no acusa recibo, esperar un segundo, luego cinco y
           * luego treinta es lo que distingue un blip de una caída. El
           * vencimiento de la confirmación es el que corta.
           */
          resendDelaysMs: delays,
          log: logger,
        });

  if (interbankSend === null) {
    logger.info('envio interbancario desactivado: falta INTERBANK_SEND_URL', {});
  }

  const telemetry = new OtelProviderTelemetry(logger);
  const simulation = new SimulationUseCase({
    repository,
    defaults: simulationDefaults(environment),
    clock,
    telemetry,
  });
  const processPayment = new ProcessPaymentUseCase({
    repository,
    clock,
    ids,
    delays,
    simulation,
    random: { next: (): number => Math.random() },
    sleeper: { sleep: async (ms: number): Promise<void> => await delay(ms) },
    telemetry,
  });
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
      new ProcessPaymentHandler(processPayment, publisher, interbankSend),
      new InterbankReceiveHandler(interbank),
      new InterbankEligibilityReplyHandler(interbank),
      new InterbankCreditedHandler(interbank),
      new InterbankCreditRejectedHandler(interbank),
      ...(interbankSend === null
        ? []
        : [
            new InterbankCallbackHandler(interbankSend),
            new InterbankCompensatedHandler(interbankSend),
          ]),
      new ListPaymentsHandler(queryPayment, publisher),
      new PaymentStatusHandler(queryPayment, publisher),
      new PaymentStatsHandler(new GetPaymentStatsUseCase({ repository, publisher })),
      new SimulationUpdateHandler(simulation, publisher),
      new SimulationQueryHandler(simulation, publisher),
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
    /**
     * Lo primero del barrido, antes de la escalera de pagos (T-47).
     *
     * Antes y no después porque los dos comparten el mismo intervalo y el mismo
     * lote: veinte pagos en cola no pueden dejar sin atender un depósito que ya
     * venció, porque el vencimiento es lo único que devuelve el dinero de un
     * cliente cuyo banco pareja dejó de contestar. Y va en el mismo barrido en
     * vez de en un `setInterval` propio porque un segundo temporizador es un
     * segundo sitio donde olvidarse de `unref`.
     *
     * Su error se traga aquí mismo: un depósito que falla al reintentarse no
     * puede dejar sin intento a los pagos que vienen detrás.
     */
    if (interbankSend !== null) {
      try {
        const interbankSwept = await interbankSend.sweep(SWEEP_BATCH);

        if (interbankSwept.expired > 0 || interbankSwept.resent > 0) {
          // `outcome` y no dos campos nuevos: el tipo del logger es la lista de
          // lo que este servicio puede decir, y ampliarla por una línea de
          // barrido no vale la pena.
          logger.info('barrido interbancario', {
            outcome: `${interbankSwept.expired} vencidos, ${interbankSwept.resent} reenviados`,
          });
        }
      } catch (error) {
        logger.error('el barrido interbancario fallo', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const due = await repository.due(clock.now(), SWEEP_BATCH);
    let attempted = 0;

    for (const payment of due) {
      /**
       * The column is populated unconditionally when a payment opens, from
       * the command envelope's own `correlationId` (`ProcessPaymentHandler`) —
       * so a `NULL` here is not a variant this service ever writes, it is a
       * row that should not exist. Minting a fresh correlation for it would
       * file this attempt under an identifier nothing else in the trail
       * carries, which is exactly what constitution VIII forbids ("never
       * regenerated"): the attempt, and the terminal event it may produce,
       * would be unreachable from the correlation everyone else is watching.
       * Failing loudly and skipping is the safer choice — the payment stays
       * `PENDING` and due, so it is retried, and this same branch logged
       * again, on every sweep until a human repairs the row, instead of
       * silently forking the audit trail.
       */
      if (payment.originCorrelationId === null) {
        logger.error('payment has no origin correlation; refusing to invent one', {
          paymentId: payment.paymentId,
          transactionId: payment.transactionId,
        });

        continue;
      }

      try {
        const correlationId = payment.originCorrelationId;
        // A later rung of the ladder is a step of the Saga's trace, not a new
        // trace of its own (T-48): rejoin the context the payment was opened in.
        await continueTrace(
          await repository.traceContextOf(payment.paymentId),
          'payment.retry',
          {
            'bank.correlation_id': correlationId,
            'bank.payment.attempt': (payment.attempt ?? 0) + 1,
          },
          () => processPayment.retry(payment, publisherFactory.forRetry(correlationId)),
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
  let interbankTimer: ReturnType<typeof setInterval> | null = null;
  let interbankSweeping = false;
  const sweepInterbank = async (): Promise<void> => {
    if (interbankSweeping) return;
    interbankSweeping = true;
    try {
      await interbank.sweep();
    } catch (error) {
      logger.error('interbank sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      interbankSweeping = false;
    }
  };

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
        await broker.subscribe(
          { queue: INTERBANK_QUEUE.name, bindings: INTERBANK_QUEUE.bindings },
          onDelivery,
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
        interbankTimer = setInterval(() => void sweepInterbank(), 500);

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
    { logger: nestLoggerFor(logger) },
  );

  await application.listen(environment.PORT);

  logger.info('payment-service listening', {
    outcome: `port ${String(environment.PORT)}, queue ${QUEUE.name}`,
  });

  /** Not awaited: the port is already open and this is what fills it in. */
  void attach();

  const shutdown = async (): Promise<void> => {
    if (interbankTimer !== null) clearInterval(interbankTimer);
    scheduler.stop();
    outboxRelay.stop();
    await application.close();
    await broker.stop();
    await pool.end();
    // Last: flushes the spans and metrics the shutdown itself produced.
    await otel.shutdown();
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

bootstrap().catch((error: unknown) => {
  // JSON like every other line: the one that explains a crash is the one the
  // collection agent most needs to parse.
  new StructuredLogger().error('boot failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
