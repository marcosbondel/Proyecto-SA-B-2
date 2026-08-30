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
import { CommandsUseCase } from '../../src/application/routes/commands.use-case';
import { LoginUseCase } from '../../src/application/routes/login.use-case';
import { PasswordResetUseCase } from '../../src/application/routes/password-reset.use-case';
import { QueriesUseCase } from '../../src/application/routes/queries.use-case';
import { RegisterCustomerUseCase } from '../../src/application/routes/register-customer.use-case';
import { VerifyEmailUseCase } from '../../src/application/routes/verify-email.use-case';
import { SessionTokenService } from '../../src/infrastructure/auth/jwt.service';
import { GatewayExceptionFilter } from '../../src/interfaces/filters/gateway-exception.filter';
import { JwtGuard, SESSION_VERIFIER } from '../../src/interfaces/guards/jwt.guard';
import { RolesGuard } from '../../src/interfaces/guards/roles.guard';
import { BROKER_HEALTH } from '../../src/interfaces/health.controller';
import { CorrelationMiddleware } from '../../src/interfaces/middleware/correlation.middleware';
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
  #timeout = false;

  public answerWith(messageType: string, payload: unknown): void {
    this.#timeout = false;
    this.#next = (correlationId) =>
      createEnvelope(payload, {
        messageType,
        producer: 'customer-service',
        identity: null,
        correlationId,
      });
  }

  /** Nobody answers. The wait ends the way it does in production. */
  public staySilent(): void {
    this.#timeout = true;
  }

  public waitFor(correlationId: string): Promise<MessageEnvelope<unknown>> {
    if (this.#timeout) {
      return Promise.reject(GatewayError.replyTimeout());
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
}

export const TEST_SECRET = 'a-test-secret-of-at-least-32-chars!!';

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
      LoginUseCase,
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
