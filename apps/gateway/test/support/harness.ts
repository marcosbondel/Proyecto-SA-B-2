import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { MessageEnvelope } from '@bank/contracts';
import { createEnvelope } from '@bank/contracts';
import type { PhotoReference } from '@bank/contracts';

import {
  MESSAGE_PUBLISHER,
  OBJECT_STORAGE,
  REPLY_WAITER,
  SESSION_SIGNER,
} from '../../src/application/ports';
import type {
  MessagePublisherPort,
  ObjectStoragePort,
  PhotoUpload,
  ReplyWaiterPort,
} from '../../src/application/ports';
import { GatewayError } from '../../src/application/errors/gateway-error';
import type { ReplyKind } from '../../src/application/errors/gateway-error';
import { AlertWebhookUseCase } from '../../src/application/routes/alert-webhook.use-case';
import { InterbankCallbackUseCase } from '../../src/application/routes/interbank-callback.use-case';
import { InterbankReceiveUseCase } from '../../src/application/routes/interbank-receive.use-case';
import { CommandsUseCase } from '../../src/application/routes/commands.use-case';
import { ChangePasswordUseCase } from '../../src/application/routes/change-password.use-case';
import { DepositUseCase } from '../../src/application/routes/deposit.use-case';
import { DashboardUseCase } from '../../src/application/routes/dashboard.use-case';
import { IdentityDocumentUseCase } from '../../src/application/routes/identity-document.use-case';
import { LoginUseCase } from '../../src/application/routes/login.use-case';
import { MarkNotificationsReadUseCase } from '../../src/application/routes/mark-read.use-case';
import { PasswordResetUseCase } from '../../src/application/routes/password-reset.use-case';
import { QueriesUseCase } from '../../src/application/routes/queries.use-case';
import { RegisterCustomerUseCase } from '../../src/application/routes/register-customer.use-case';
import { VerifyEmailUseCase } from '../../src/application/routes/verify-email.use-case';
import { SessionTokenService } from '../../src/infrastructure/auth/jwt.service';
import { GatewayExceptionFilter } from '../../src/interfaces/filters/gateway-exception.filter';
import { ALERT_WEBHOOK_TOKEN } from '../../src/interfaces/guards/alert-token.guard';
import { INTERBANK_PARTNER_TOKEN } from '../../src/interfaces/guards/interbank-token.guard';
import { InterbankV1UseCase } from '../../src/application/routes/interbank-v1.use-case';
import {
  INTERBANK_API_KEYS,
  InterbankApiKeyGuard,
} from '../../src/interfaces/guards/interbank-api-key.guard';
import {
  INTERBANK_BANK_CODE,
  INTERBANK_MAX_AMOUNT_MINOR,
  INTERBANK_PARTNER_BANK_CODE,
} from '../../src/interfaces/interbank-v1.tokens';
import { InterbankSendUseCase } from '../../src/application/routes/interbank-send.use-case';
import { JwtGuard, SESSION_VERIFIER } from '../../src/interfaces/guards/jwt.guard';
import { RolesGuard } from '../../src/interfaces/guards/roles.guard';
import { BROKER_HEALTH } from '../../src/interfaces/health.controller';
import { CorrelationMiddleware } from '../../src/interfaces/middleware/correlation.middleware';
import { validationExceptionFactory } from '../../src/interfaces/validation';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

/**
 * A gateway wired to fakes instead of a broker.
 *
 * The ports exist precisely so this is possible: every test in this suite
 * exercises the real controllers, guards, filter and middleware, and only the
 * three things that cross a process boundary are replaced. A test that needed a
 * live RabbitMQ to check that a `401` publishes nothing would be slow, flaky,
 * and no more convincing.
 */

/** Records what the gateway published, so a test can assert on silence too. */
export class RecordingPublisher implements MessagePublisherPort {
  public readonly published: MessageEnvelope<unknown>[] = [];
  public failWith: GatewayError | undefined;

  public publish(envelope: MessageEnvelope<unknown>): Promise<void> {
    if (this.failWith !== undefined) {
      return Promise.reject(this.failWith);
    }

    this.published.push(envelope);
    return Promise.resolve();
  }

  public get lastType(): string | undefined {
    return this.published[this.published.length - 1]?.messageType;
  }

  public reset(): void {
    this.published.length = 0;
    this.failWith = undefined;
  }
}

/** Answers a question, refuses to, or never answers at all. */
export class ScriptedReplier implements ReplyWaiterPort {
  #next: ((correlationId: string) => MessageEnvelope<unknown>) | undefined;
  #queue: { readonly messageType: string; readonly payload: unknown }[] = [];
  #timeout = false;

  public answerWith(messageType: string, payload: unknown): void {
    this.#timeout = false;
    this.#queue = [];
    this.#next = (correlationId) =>
      createEnvelope(payload, {
        messageType,
        producer: 'customer-service',
        identity: null,
        correlationId,
      });
  }

  /**
   * A different answer per question, in order.
   *
   * Needed once the Gateway started asking **two** services to build one
   * response — the accounts listing composes Account Service's rows with
   * Customer Service's names (TD-026). A single scripted reply cannot express
   * that, and a test that could not tell the two apart would pass against a
   * Gateway that asked the wrong service.
   */
  public answerInOrder(answers: readonly { messageType: string; payload: unknown }[]): void {
    this.#timeout = false;
    this.#queue = [...answers];
    this.#next = undefined;
  }

  /** Nobody answers. The wait ends the way it does in production. */
  public staySilent(): void {
    this.#timeout = true;
  }

  public waitFor(correlationId: string, kind?: ReplyKind): Promise<MessageEnvelope<unknown>> {
    if (this.#timeout) {
      return Promise.reject(GatewayError.replyTimeout(kind));
    }

    const scripted = this.#queue.shift();

    if (scripted !== undefined) {
      return Promise.resolve(
        createEnvelope(scripted.payload, {
          messageType: scripted.messageType,
          producer: 'customer-service',
          identity: null,
          correlationId,
        }),
      );
    }

    if (this.#next === undefined) {
      return Promise.reject(GatewayError.internal('no scripted reply'));
    }

    return Promise.resolve(this.#next(correlationId));
  }
}

/** Accepts the bytes, or refuses to, without touching a network. */
export class FakeObjectStorage implements ObjectStoragePort {
  public readonly stored: PhotoUpload[] = [];
  public fail = false;
  /** What `get` hands back for a given key, so a test can script a document. */
  public readonly objects = new Map<string, Buffer>();

  public put(upload: PhotoUpload): Promise<PhotoReference> {
    if (this.fail) {
      return Promise.reject(GatewayError.internal('No se pudo procesar la imagen del documento.'));
    }

    this.stored.push(upload);

    return Promise.resolve({
      objectKey: 'fake-object-key.jpg',
      contentType: upload.contentType,
      sizeBytes: upload.bytes.byteLength,
      sha256: 'a'.repeat(64),
    });
  }

  public get(objectKey: string): Promise<Buffer> {
    if (this.fail) {
      return Promise.reject(GatewayError.internal('No se pudo leer la imagen del documento.'));
    }

    const content = this.objects.get(objectKey);

    return content === undefined
      ? Promise.reject(GatewayError.internal('No se pudo leer la imagen del documento.'))
      : Promise.resolve(content);
  }
}

export const TEST_SECRET = 'a-test-secret-of-at-least-32-chars!!';

/** The SLO webhook's shared secret in every harness (T-45). */
export const TEST_ALERT_TOKEN = 'an-alert-webhook-token-of-32-chars!!';
export const TEST_INTERBANK_TOKEN = 'an-interbank-partner-token-of-32-chars!!';
/** La API key del contrato oficial (`X-Api-Key`), que identifica al banco (T-56). */
export const TEST_INTERBANK_API_KEY = 'an-interbank-api-key-of-32-characters!!';
export const TEST_PARTNER_BANK_CODE = 'BANK99';
export const TEST_OWN_BANK_CODE = 'BANK02';
/** El límite por operación del contrato: Q10 000,00 (T-60). */
export const TEST_MAX_AMOUNT_MINOR = 1_000_000;

export interface Harness {
  readonly app: INestApplication;
  readonly publisher: RecordingPublisher;
  readonly replier: ScriptedReplier;
  readonly storage: FakeObjectStorage;
  readonly tokens: SessionTokenService;
  readonly brokerUp: { value: boolean };
}

export async function buildHarness(
  controllers: readonly unknown[],
  providers: readonly unknown[] = [],
): Promise<Harness> {
  const publisher = new RecordingPublisher();
  const replier = new ScriptedReplier();
  const storage = new FakeObjectStorage();
  const tokens = new SessionTokenService({ secret: TEST_SECRET, expiresInSeconds: 3600 });
  const brokerUp = { value: true };

  const moduleRef = await Test.createTestingModule({
    controllers: controllers as never[],
    providers: [
      ...(providers as never[]),

      /**
       * All four use cases, always.
       *
       * They depend only on the ports this harness already fakes, so providing
       * them costs nothing — and it removes a trap: a controller that grows a
       * dependency would otherwise break every suite that had not listed it,
       * with a DI error that says nothing about the actual change.
       */
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
      { provide: MESSAGE_PUBLISHER, useValue: publisher },
      { provide: REPLY_WAITER, useValue: replier },
      { provide: OBJECT_STORAGE, useValue: storage },
      { provide: SESSION_VERIFIER, useValue: tokens },
      { provide: SESSION_SIGNER, useValue: tokens },
      { provide: ALERT_WEBHOOK_TOKEN, useValue: TEST_ALERT_TOKEN },
      { provide: INTERBANK_PARTNER_TOKEN, useValue: TEST_INTERBANK_TOKEN },
      InterbankV1UseCase,
      InterbankApiKeyGuard,
      {
        provide: INTERBANK_API_KEYS,
        useValue: { [TEST_PARTNER_BANK_CODE]: TEST_INTERBANK_API_KEY },
      },
      { provide: INTERBANK_BANK_CODE, useValue: TEST_OWN_BANK_CODE },
      { provide: INTERBANK_PARTNER_BANK_CODE, useValue: TEST_PARTNER_BANK_CODE },
      { provide: INTERBANK_MAX_AMOUNT_MINOR, useValue: TEST_MAX_AMOUNT_MINOR },
      InterbankSendUseCase,
      { provide: BROKER_HEALTH, useValue: { isConnected: () => brokerUp.value } },
      { provide: APP_GUARD, useClass: JwtGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_FILTER, useClass: GatewayExceptionFilter },
      {
        provide: APP_PIPE,
        useValue: new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          exceptionFactory: validationExceptionFactory,
        }),
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();

  // The middleware is applied by AppModule in production; a testing module has
  // no `configure`, so it is attached here to keep the request shape identical.
  const correlation = new CorrelationMiddleware();
  app.use(correlation.use.bind(correlation));
  await app.init();

  return { app, publisher, replier, storage, tokens, brokerUp };
}
