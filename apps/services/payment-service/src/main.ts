// First, before anything else: see `instrumentation.ts` for why the order matters.
import { otel } from './instrumentation';
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  EXCHANGES,
  QUEUES,
  V1_RELEASE_MARGIN_MS,
  V1_TRANSFER_TTL_MS,
  validateMessage,
} from '@bank/contracts';
import type { MessageEnvelope, QueueDescriptor } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';
import { continueTrace, currentTraceparent, nestLoggerFor } from '@bank/observability';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { SimulationUseCase } from './application/manage-simulation.use-case';
import { InterbankUseCase } from './application/interbank.use-case';
import { SendInterbankDepositUseCase } from './application/send-interbank-deposit.use-case';
import { InterbankV1UseCase } from './application/interbank-v1.use-case';
import { ProcessPaymentUseCase } from './application/process-payment.use-case';
import { GetPaymentStatsUseCase } from './application/get-payment-stats.use-case';
import { QueryInterbankSendsUseCase } from './application/query-interbank-sends.use-case';
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
import { PostgresInterbankV1Repository } from './infrastructure/persistence/postgres-interbank-v1.repository';
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
  InterbankV1CancelHandler,
  InterbankV1ReconciliationHandler,
  InterbankV1ReversalQueryHandler,
  InterbankV1ReversalRequestHandler,
  InterbankV1ResultHandler,
  InterbankSendListHandler,
  InterbankSendQueryHandler,
  InterbankV1StatusHandler,
  InterbankV1TransferHandler,
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
  const interbankV1Repository = new PostgresInterbankV1Repository(pool);

  const broker = new MessageBroker({
    url: environment.RABBITMQ_URL,
    exchanges: [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies],
    errorExchange: EXCHANGES.errors,
  });

  const clock = { now: (): Date => new Date() };
  const ids = { next: (): string => randomUUID() };
  const publisherFactory = new BrokerEventPublisher(broker);
  const interbankMessenger = new BrokerInterbankMessenger(broker);
  const interbank = new InterbankUseCase({
    repository: interbankRepository,
    messenger: interbankMessenger,
    callback: new HttpPartnerCallback(
      environment.INTERBANK_PARTNER_BASE_URL,
      environment.INTERBANK_API_KEY_OUTBOUND,
      environment.INTERBANK_BANK_CODE,
      environment.INTERBANK_PARTNER_BANK_CODE,
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
   * `INTERBANK_PARTNER_BASE_URL` —el caso normal mientras el auxiliar no asigne
   * la pareja— paga como siempre: el bloque `interbank` de un pago se ignora y el
   * pago va al proveedor simulado. Es deliberado: un banco sin banco pareja
   * sigue siendo un banco, y arrancar con una URL vacía habría dejado todo
   * depósito fallando contra `http://`.
   */
  const interbankSend =
    environment.INTERBANK_PARTNER_BASE_URL.length === 0
      ? null
      : new SendInterbankDepositUseCase({
          repository: interbankSendRepository,
          partner: new HttpPartnerBankClient(
            environment.INTERBANK_PARTNER_BASE_URL,
            environment.INTERBANK_API_KEY_OUTBOUND,
            environment.INTERBANK_BANK_CODE,
          ),
          messenger: interbankMessenger,
          telemetry: new OtelInterbankSendTelemetry(logger),
          clock: clock.now,
          /*
           * Los dos plazos salen del CONTRATO y no del entorno (TD-095). Ver la
           * nota de `INTERBANK_CONFIRMATION_TIMEOUT_MS`, que ya no se lee: con
           * 30 s dábamos por muerto a los tres minutos un depósito al que el
           * otro banco tiene 24 horas para contestar, y devolvíamos dinero que
           * podían haber acreditado.
           */
          transferTtlMs: V1_TRANSFER_TTL_MS,
          releaseMarginMs: V1_RELEASE_MARGIN_MS,
          resolveRetryMs: environment.INTERBANK_RESOLVE_RETRY_MS,
          /*
           * La misma escalera que la de los pagos, y por el mismo motivo: si el
           * banco pareja no acusa recibo, esperar un segundo, luego cinco y
           * luego treinta es lo que distingue un blip de una caída. El
           * vencimiento de la confirmación es el que corta.
           */
          resendDelaysMs: delays,
          maxAmountMinor: environment.INTERBANK_MAX_AMOUNT_MINOR,
          trace: {
            current: () => currentTraceparent(),
            continue: (traceparent, spanName, correlationId, work) =>
              continueTrace(traceparent, spanName, { 'bank.correlation_id': correlationId }, work),
          },
          log: logger,
        });

  if (interbankSend === null) {
    logger.info('envio interbancario desactivado: falta INTERBANK_PARTNER_BASE_URL', {});
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
  const queryInterbankSends = new QueryInterbankSendsUseCase({
    repository: interbankSendRepository,
  });
  /**
   * El del barrido, aparte de los del router.
   *
   * El barrido no contesta a nadie: cierra filas y publica el callback por la
   * maquinaria que ya existe. Así que no necesita un publicador atado a un
   * mensaje entrante, y darle uno falso sería atribuirle a alguna correlación
   * un trabajo que nadie pidió.
   */
  const interbankV1Sweeper = new InterbankV1UseCase({
    repository: interbankV1Repository,
    messenger: interbankMessenger,
    reply: async () => {
      /* El barrido no responde: no hay nadie esperando. */
    },
    bankCode: environment.INTERBANK_BANK_CODE,
    maxAmountMinor: environment.INTERBANK_MAX_AMOUNT_MINOR,
    clock: clock.now,
    log: logger,
  });

  /**
   * A router per delivery, because the publisher is bound to the message being
   * handled. One shared router with a mutable "current cause" would attribute
   * one transfer's payment events to another's correlation the first time two
   * transfers were in flight at once.
   */
  const routerFor = (envelope: MessageEnvelope<unknown>): InboundMessageRouter => {
    const publisher = publisherFactory.forCause(envelope);
    /*
     * Un caso de uso del contrato **por entrega**, por lo mismo que el router:
     * contesta por el publicador atado al mensaje que se está atendiendo, y uno
     * compartido atribuiría la respuesta de una consulta a la correlación de
     * otra la primera vez que dos bancos preguntaran a la vez.
     */
    const interbankV1 = new InterbankV1UseCase({
      repository: interbankV1Repository,
      messenger: interbankMessenger,
      reply: async (messageType, payload) => {
        await publisher.reply({ messageType, payload });
      },
      bankCode: environment.INTERBANK_BANK_CODE,
      maxAmountMinor: environment.INTERBANK_MAX_AMOUNT_MINOR,
      clock: clock.now,
      log: logger,
    });

    return new InboundMessageRouter([
      new ProcessPaymentHandler(processPayment, publisher, interbankSend),
      new InterbankReceiveHandler(interbank),
      new InterbankEligibilityReplyHandler(interbank),
      new InterbankCreditedHandler(interbank),
      new InterbankCreditRejectedHandler(interbank),
      new InterbankV1TransferHandler(interbankV1),
      new InterbankV1StatusHandler(interbankV1),
      new InterbankV1CancelHandler(interbankV1),
      new InterbankV1ReversalRequestHandler(interbankV1),
      new InterbankV1ReversalQueryHandler(interbankV1),
      new InterbankV1ReconciliationHandler(interbankV1),
      ...(interbankSend === null
        ? []
        : [
            new InterbankCallbackHandler(interbankSend),
            new InterbankV1ResultHandler(interbankSend),
            new InterbankCompensatedHandler(interbankSend),
          ]),
      /*
       * Los dos de T-60 (B10) no dependen de `interbankSend`: leen la tabla de
       * depósitos enviados aunque este despliegue ya no envíe (la pantalla sigue
       * pudiendo mostrar el historial de lo que se envió).
       */
      new InterbankSendQueryHandler(queryInterbankSends, publisher),
      new InterbankSendListHandler(queryInterbankSends, publisher),
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
    /**
     * El vencimiento de los depósitos **recibidos** (T-56).
     *
     * Primero de todo, y es lo más importante de este barrido. El contrato
     * oficial prohíbe acreditar después de `expiresAt` «aunque el mensaje
     * llegue tarde (reintento, DLQ)» y añade que si se acredita «la
     * responsabilidad y la devolución son suyas». Un depósito que se quedó a
     * medias —una respuesta de Account que tardó, un pod que se reinició—
     * acabaría acreditándose cuando el otro banco ya liberó su reserva, y el
     * mismo dinero existiría dos veces.
     *
     * Es el único barrido de este servicio que previene una pérdida en vez de
     * recuperarse de una.
     */
    try {
      const vencidos = await interbankV1Sweeper.sweepExpired(SWEEP_BATCH);

      if (vencidos > 0) {
        logger.warn('barrido del contrato interbancario', {
          outcome: `${vencidos} depositos vencidos, rechazados con EXPIRED`,
        });
      }
    } catch (error) {
      logger.error('el barrido del contrato interbancario fallo', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

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

      /*
       * La reconciliación de los veredictos perdidos (TD-093).
       *
       * En el mismo barrido y no en un temporizador propio, por la misma razón
       * que el resto: un segundo temporizador es un segundo sitio donde mirar
       * cuando algo no corre. Y **después** del barrido normal, porque lo que
       * busca son filas que el barrido normal no puede ver — ya decididas, fuera
       * del alcance de `claimSendable` y `claimExpired`.
       *
       * En régimen normal no encuentra nada nunca: desde la migración 014 el
       * veredicto se escribe en la misma transacción que el estado. Si encuentra
       * algo, se registra en `warn` desde el caso de uso, porque significa que
       * hubo una caída entre decidir y encolar — y conviene verlo aunque el
       * sistema se haya recuperado solo.
       */
      try {
        const reconciliados = await interbankSend.reconcile(SWEEP_BATCH);

        if (reconciliados > 0) {
          logger.warn('veredictos interbancarios reconciliados', {
            outcome: `${reconciliados} recuperados del outbox`,
          });
        }
      } catch (error) {
        logger.error('la reconciliacion interbancaria fallo', {
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
