// First, before anything else: see `instrumentation.ts` for why the order matters.
import { otel } from './instrumentation';
import 'reflect-metadata';

import { EXCHANGES, QUEUES, validateMessage } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import { MessageBroker } from '@bank/messaging';
import { nestLoggerFor } from '@bank/observability';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { ActivityMonitor } from './application/activity-monitor';
import { CompensateDebitUseCase } from './application/compensate-debit.use-case';
import { CreateAccountUseCase } from './application/create-account.use-case';
import { CreditAccountUseCase } from './application/credit-account.use-case';
import { InterbankAccountUseCase } from './application/interbank-account.use-case';
import { DepositUseCase } from './application/deposit.use-case';
import { GetAccountStatsUseCase } from './application/get-account-stats.use-case';
import { ListBillersUseCase } from './application/list-billers.use-case';
import { DeactivateInactiveAccountsUseCase } from './application/deactivate-inactive-accounts.use-case';
import { DebitAccountUseCase } from './application/debit-account.use-case';
import { GetBalanceUseCase } from './application/get-balance.use-case';
import { GetOperationsUseCase } from './application/get-operations.use-case';
import { ListAccountsUseCase } from './application/list-accounts.use-case';
import { SetAccountStatusUseCase } from './application/set-account-status.use-case';
import { AppModule } from './app.module';
import { loadDotEnvFile, loadEnvironment } from './infrastructure/config/environment';
import { BrokerEventPublisher } from './infrastructure/messaging/broker-event.publisher';
import { migrate } from './infrastructure/persistence/migrations';
import { seedBillerAccounts } from './infrastructure/persistence/seed-billers';
import { seedSettlementAccount } from './infrastructure/persistence/seed-settlement';
import { seedDemoAccounts } from './infrastructure/persistence/seed-demo-data';
import { PostgresAccountRepository } from './infrastructure/persistence/postgres-account.repository';
import { PostgresSweepLease } from './infrastructure/persistence/postgres-sweep-lease';
import { DeactivationScheduler } from './infrastructure/scheduler/deactivation.scheduler';
import { OtelActivityTelemetry } from './infrastructure/telemetry/otel-activity.telemetry';
import { InboundMessageRouter } from './interfaces/inbound-message.handler';
import { StructuredLogger } from './interfaces/logging';
import {
  CompensateDebitHandler,
  CreateAccountHandler,
  CreditAccountHandler,
  InterbankEligibilityHandler,
  InterbankCreditHandler,
  DepositHandler,
  GetAccountStatsHandler,
  ListBillersHandler,
  DebitAccountHandler,
  GetBalanceHandler,
  GetOperationsHandler,
  ListAccountsHandler,
  SetAccountStatusHandler,
} from './interfaces/message-handlers';

/** The queue this service owns, as `@bank/contracts` declares it. */
const QUEUE = QUEUES.find((queue) => queue.owner === 'account-service')!;

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
 * cases be tested with fakes and what stops a balance rule from acquiring a
 * dependency on PostgreSQL by accident. Here, and only here, the real adapters
 * are chosen.
 *
 * The order matters three times. Migrations run **before** the queue is
 * consumed: a replica that starts taking debits against a schema that does not
 * exist yet fails every one of them into the retry ladder, which looks like an
 * outage and is really a race with its own boot. The scheduler starts **after**
 * the broker: a deactivation it cannot announce is a row changed with nobody
 * told. And since T-21 all three happen **after** the port is open — see
 * `attach` below for why.
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
  const repository = new PostgresAccountRepository(pool);
  const broker = new MessageBroker({
    url: environment.RABBITMQ_URL,
    exchanges: [EXCHANGES.commands, EXCHANGES.events, EXCHANGES.replies],
    errorExchange: EXCHANGES.errors,
  });

  const clock = { now: (): Date => new Date() };
  const publisherFactory = new BrokerEventPublisher(broker);
  const activityTelemetry = new OtelActivityTelemetry(logger);
  const activityRule = {
    maxOperations: environment.ANOMALY_MAX_OPERATIONS,
    windowMinutes: environment.ANOMALY_WINDOW_MINUTES,
  };

  /**
   * A router per delivery, because the publisher is bound to the message it is
   * answering. One shared router with a mutable "current cause" would attribute
   * one request's events to another's correlation the first time two commands
   * arrive at once.
   */
  const routerFor = (envelope: MessageEnvelope<unknown>): InboundMessageRouter => {
    const publisher = publisherFactory.forCause(envelope);

    /**
     * Per delivery, like the publisher: the monitor reports with the
     * correlation id of the command that caused the movement, and a shared
     * instance would hand one request's id to another under any concurrency.
     */
    const activity = new ActivityMonitor({
      repository,
      publisher,
      clock,
      telemetry: activityTelemetry.forCorrelation(envelope.correlationId),
      rule: activityRule,
    });

    return new InboundMessageRouter([
      new CreateAccountHandler(new CreateAccountUseCase({ repository, publisher, clock })),
      new GetBalanceHandler(new GetBalanceUseCase({ repository, publisher })),
      new ListAccountsHandler(new ListAccountsUseCase({ repository, publisher })),
      new GetOperationsHandler(new GetOperationsUseCase({ repository, publisher })),
      new DebitAccountHandler(new DebitAccountUseCase({ repository, publisher, clock, activity })),
      new CreditAccountHandler(
        new CreditAccountUseCase({ repository, publisher, clock, activity }),
      ),
      new InterbankEligibilityHandler(
        new InterbankAccountUseCase({ repository, publisher, clock }),
      ),
      new InterbankCreditHandler(new InterbankAccountUseCase({ repository, publisher, clock })),
      new DepositHandler(new DepositUseCase({ repository, publisher, clock, activity })),
      new ListBillersHandler(new ListBillersUseCase({ repository, publisher })),
      new GetAccountStatsHandler(new GetAccountStatsUseCase({ repository, publisher })),
      new CompensateDebitHandler(
        new CompensateDebitUseCase({ repository, publisher, clock, activity }),
      ),
      new SetAccountStatusHandler(new SetAccountStatusUseCase({ repository, publisher, clock })),
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

  const scheduler = new DeactivationScheduler({
    intervalMs: environment.DEACTIVATION_INTERVAL_MS,
    logger,
    /**
     * Con mas de una replica, el barrido lo ejecuta la que consiga el cerrojo
     * consultivo de PostgreSQL; las demas se saltan su turno. Es lo que permite
     * que este servicio tenga HPA como los otros seis en vez de quedarse fijo
     * en una replica para que el barrido no corriera N veces.
     */
    lease: new PostgresSweepLease(pool),
    job: {
      /**
       * A fresh publisher per run, bound to that run's correlation. The job is
       * nobody's request, so it is its own correlation root with a `null`
       * identity — attributing an automatic deactivation to whoever logged in
       * last would be a lie written into an append-only trail.
       */
      execute: async (runId) =>
        await new DeactivateInactiveAccountsUseCase({
          repository,
          publisher: publisherFactory.forSystem(runId),
          clock,
          criteria: {
            minBalanceMinor: environment.INACTIVITY_MIN_BALANCE_MINOR,
            inactivityMonths: environment.INACTIVITY_MONTHS,
          },
        }).execute(runId),
    },
  });

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

        /**
         * The billers' collection accounts, **not** gated on `SEED_DEMO_DATA`.
         *
         * These are product data: a bank that offers "pago de servicios" has an
         * account per biller whether or not anybody is demonstrating anything,
         * and gating them on a development flag would leave `G-01` with an
         * empty dropdown in the one environment where it matters.
         */
        const billers = await seedBillerAccounts(pool);
        // La cuenta donde entra lo que sale hacia el banco pareja (T-47).
        const settlement = await seedSettlementAccount(pool);
        logger.info('biller accounts ready', { outcome: billers.join(', ') });
        logger.info('interbank settlement account ready', { outcome: settlement });

        /** The demo client's accounts, gated and idempotent — see `seedDemoAccounts`. */
        if (environment.SEED_DEMO_DATA) {
          const seeded = await seedDemoAccounts(pool);
          logger.info('demo accounts seeded', {
            outcome: seeded.length === 0 ? 'already present, nothing touched' : seeded.join(', '),
          });
        }

        await broker.start();
        await broker.subscribe(
          { queue: QUEUE.name, bindings: QUEUE.bindings },
          onDelivery,
          /**
           * TD-046, closed for this service: every producer that can reach
           * `account.commands` builds its envelope through `createEnvelope` /
           * `followUpEnvelope` and checks the payload against this same
           * `@bank/contracts` schema before publishing (the Gateway's
           * `CommandsUseCase#publish` and every service's `BrokerEventPublisher`
           * both `safeParse` first) — so a message that fails this check is not
           * a producer this system trusts, and three redeliveries could never
           * have made it parse.
           */
          validateMessage,
        );
        consuming = true;

        logger.info('consuming', { outcome: QUEUE.name });

        if (environment.DEACTIVATION_ENABLED) {
          scheduler.start();
          logger.info('deactivation scheduler started', {
            outcome: `every ${String(environment.DEACTIVATION_INTERVAL_MS)} ms`,
          });
        } else {
          logger.info('deactivation scheduler disabled by configuration');
        }

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

  logger.info('account-service listening', { outcome: `port ${String(environment.PORT)}` });

  /** Not awaited: the port is already open and this is what fills it in. */
  void attach();

  const shutdown = async (): Promise<void> => {
    scheduler.stop();
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
