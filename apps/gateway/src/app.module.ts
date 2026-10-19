import { JsonLogger } from '@bank/observability';
import type { DynamicModule, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import type { MessageBroker } from '@bank/messaging';

import {
  MESSAGE_PUBLISHER,
  OBJECT_STORAGE,
  REPLY_WAITER,
  SESSION_SIGNER,
} from './application/ports';
import { AlertWebhookUseCase } from './application/routes/alert-webhook.use-case';
import { InterbankCallbackUseCase } from './application/routes/interbank-callback.use-case';
import { InterbankReceiveUseCase } from './application/routes/interbank-receive.use-case';
import { CommandsUseCase } from './application/routes/commands.use-case';
import { ChangePasswordUseCase } from './application/routes/change-password.use-case';
import { DepositUseCase } from './application/routes/deposit.use-case';
import { DashboardUseCase } from './application/routes/dashboard.use-case';
import { IdentityDocumentUseCase } from './application/routes/identity-document.use-case';
import { LoginUseCase } from './application/routes/login.use-case';
import { MarkNotificationsReadUseCase } from './application/routes/mark-read.use-case';
import { PasswordResetUseCase } from './application/routes/password-reset.use-case';
import { QueriesUseCase } from './application/routes/queries.use-case';
import { RegisterCustomerUseCase } from './application/routes/register-customer.use-case';
import { VerifyEmailUseCase } from './application/routes/verify-email.use-case';
import { DashboardController } from './interfaces/dashboard.controller';
import { NotificationsController } from './interfaces/notifications.controller';
import { AlertsController } from './interfaces/alerts.controller';
import { InterbankController } from './interfaces/interbank.controller';
import { InterbankV1Controller } from './interfaces/interbank-v1.controller';
import {
  INTERBANK_BANK_CODE,
  INTERBANK_ID_SECRET,
  INTERBANK_MAX_AMOUNT_MINOR,
  INTERBANK_PARTNER_BANK_CODE,
} from './interfaces/interbank-v1.tokens';
import { InterbankSendUseCase } from './application/routes/interbank-send.use-case';
import {
  INTERBANK_API_KEYS,
  InterbankApiKeyGuard,
} from './interfaces/guards/interbank-api-key.guard';
import { InterbankV1UseCase } from './application/routes/interbank-v1.use-case';
import { AuditController } from './interfaces/audit.controller';
import { AccountsController } from './interfaces/accounts.controller';
import { AuthController } from './interfaces/auth.controller';
import { CustomersController } from './interfaces/customers.controller';
import { PaymentsController } from './interfaces/payments.controller';
import { TransfersController } from './interfaces/transfers.controller';
import { SessionTokenService } from './infrastructure/auth/jwt.service';
import type { GatewayEnvironment } from './infrastructure/config/environment';
import { BrokerPublisherAdapter } from './infrastructure/messaging/broker-publisher.adapter';
import { createMessageBroker } from './infrastructure/messaging/broker.provider';
import { ReplyQueueAdapter } from './infrastructure/messaging/reply-queue.adapter';
import { S3ObjectStorageAdapter } from './infrastructure/storage/s3-object-storage.adapter';
import { GatewayExceptionFilter } from './interfaces/filters/gateway-exception.filter';
import { ALERT_WEBHOOK_TOKEN, AlertTokenGuard } from './interfaces/guards/alert-token.guard';
import {
  INTERBANK_PARTNER_TOKEN,
  InterbankTokenGuard,
} from './interfaces/guards/interbank-token.guard';
import { JwtGuard, SESSION_VERIFIER } from './interfaces/guards/jwt.guard';
import { RolesGuard } from './interfaces/guards/roles.guard';
import { BROKER_HEALTH, HealthController } from './interfaces/health.controller';
import { accessLogMiddleware } from './interfaces/middleware/access-log.middleware';
import { CorrelationMiddleware } from './interfaces/middleware/correlation.middleware';
import { validationExceptionFactory } from './interfaces/validation';

/** Everything with a lifecycle, so `main.ts` can start and stop it in order. */
export interface GatewayRuntime {
  readonly broker: MessageBroker;
  readonly replyQueue: ReplyQueueAdapter;
}

export const GATEWAY_RUNTIME = Symbol('GatewayRuntime');

/**
 * Where the layers meet.
 *
 * This is the one place allowed to see all four of them: `pnpm lint` stops
 * `interfaces` from importing `infrastructure` anywhere else, which is what
 * makes a controller testable against a port rather than against a broker.
 *
 * The broker is constructed here but **not connected** — `start()` opens the
 * socket and `main.ts` decides when. That ordering is what lets the process
 * report its own liveness while RabbitMQ is down, instead of failing to boot
 * and telling nobody why.
 */
@Module({})
export class AppModule implements NestModule {
  public static forRoot(environment: GatewayEnvironment): DynamicModule {
    const broker = createMessageBroker(environment.RABBITMQ_URL, environment.REPLY_TIMEOUT_MS);
    const replyQueue = new ReplyQueueAdapter(
      broker,
      environment.GATEWAY_INSTANCE_ID,
      environment.REPLY_TIMEOUT_MS,
    );

    const runtime: GatewayRuntime = { broker, replyQueue };

    // One object, two ports: it signs for the application layer and verifies
    // for the guard. Splitting it would put the secret in two places.
    const sessions = new SessionTokenService({
      secret: environment.JWT_SECRET,
      expiresInSeconds: environment.JWT_EXPIRES_IN,
    });

    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        CustomersController,
        AccountsController,
        TransfersController,
        PaymentsController,
        AuditController,
        AlertsController,
        InterbankController,
        InterbankV1Controller,
        NotificationsController,
        DashboardController,
      ],
      providers: [
        { provide: GATEWAY_RUNTIME, useValue: runtime },
        { provide: REPLY_WAITER, useValue: replyQueue },
        { provide: MESSAGE_PUBLISHER, useValue: new BrokerPublisherAdapter(broker) },
        {
          provide: OBJECT_STORAGE,
          useValue: new S3ObjectStorageAdapter({
            endpoint: environment.OBJECT_STORAGE_ENDPOINT,
            accessKey: environment.OBJECT_STORAGE_ACCESS_KEY,
            secretKey: environment.OBJECT_STORAGE_SECRET_KEY,
            bucket: environment.OBJECT_STORAGE_BUCKET,
            region: environment.OBJECT_STORAGE_REGION,
          }),
        },
        { provide: SESSION_VERIFIER, useValue: sessions },
        { provide: SESSION_SIGNER, useValue: sessions },
        // The webhook's secret, or `null` — and `null` means the webhook refuses everyone.
        { provide: ALERT_WEBHOOK_TOKEN, useValue: environment.ALERT_WEBHOOK_TOKEN ?? null },
        AlertTokenGuard,
        { provide: INTERBANK_PARTNER_TOKEN, useValue: environment.INTERBANK_PARTNER_TOKEN ?? null },
        InterbankTokenGuard,
        /*
         * El mapa de API keys del contrato oficial: **una por banco pareja**.
         * Hoy es una, la de `INTERBANK_PARTNER_BANK_CODE`; la forma admite más
         * sin cambiar el guardián, porque la clave es lo que identifica a quien
         * llama y con dos parejas una clave compartida no distingue.
         */
        {
          provide: INTERBANK_API_KEYS,
          useValue:
            environment.INTERBANK_API_KEY_INBOUND === undefined ||
            environment.INTERBANK_API_KEY_INBOUND.length === 0
              ? {}
              : {
                  [environment.INTERBANK_PARTNER_BANK_CODE]: environment.INTERBANK_API_KEY_INBOUND,
                },
        },
        InterbankApiKeyGuard,
        { provide: INTERBANK_BANK_CODE, useValue: environment.INTERBANK_BANK_CODE },
        { provide: INTERBANK_PARTNER_BANK_CODE, useValue: environment.INTERBANK_PARTNER_BANK_CODE },
        { provide: INTERBANK_MAX_AMOUNT_MINOR, useValue: environment.INTERBANK_MAX_AMOUNT_MINOR },
        { provide: INTERBANK_ID_SECRET, useValue: environment.JWT_SECRET },
        InterbankV1UseCase,
        InterbankSendUseCase,

        AlertWebhookUseCase,
        InterbankReceiveUseCase,
        InterbankCallbackUseCase,
        ChangePasswordUseCase,
        DepositUseCase,
        DashboardUseCase,
        IdentityDocumentUseCase,
        LoginUseCase,
        MarkNotificationsReadUseCase,
        PasswordResetUseCase,
        RegisterCustomerUseCase,
        CommandsUseCase,
        QueriesUseCase,
        VerifyEmailUseCase,

        /**
         * `whitelist` strips anything not declared on a DTO and
         * `forbidNonWhitelisted` refuses the request outright. Both matter for
         * an entry point: an undeclared field that survives to the broker is a
         * field some service will eventually be tempted to read.
         */
        {
          provide: APP_PIPE,
          useValue: new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            exceptionFactory: validationExceptionFactory,
          }),
        },
        { provide: BROKER_HEALTH, useValue: { isConnected: () => broker.isConnected() } },

        // Order matters. Authentication establishes *who*; authorization then
        // asks *whether*. Reversed, the second guard would be reasoning about a
        // role nobody had established yet.
        { provide: APP_GUARD, useClass: JwtGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: GatewayExceptionFilter },
      ],
    };
  }

  public configure(consumer: MiddlewareConsumer): void {
    // Every route, probes included: a response with no correlation identifier
    // is one nobody can trace afterwards, and errors are exactly when somebody
    // will try.
    //
    // The access log goes second: it reads the correlation identifier the first
    // one assigns, and writes one line per request when the response is done.
    consumer
      .apply(CorrelationMiddleware, accessLogMiddleware(new JsonLogger({ service: 'gateway' })))
      .forRoutes('*path');
  }
}
