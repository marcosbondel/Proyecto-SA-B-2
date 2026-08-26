import { createHash } from 'node:crypto';

import {
  customerActivationRequestedV1,
  customerIdentityRejectedV1,
  customerIdentityValidatedV1,
  customerRegisterRejectedV1,
  customerRegisteredV1,
} from '@bank/contracts';
import type { CustomerRegisterV1, PhotoReference } from '@bank/contracts';

import { DomainRejection } from '../domain/customer';
import type { IdentityStatus } from '../domain/customer';
import { judgeIdentityPhoto } from '../domain/identity-validation';
import type { IdentityVerdict } from '../domain/identity-validation';
import { usernameCandidates } from '../domain/username';
import type {
  ActivationTokenFactory,
  Clock,
  CustomerRepository,
  EventPublisher,
  IdentityDocumentReader,
  PasswordHasher,
} from './ports';

/** Twenty-four hours, the default `customer.activation.requested.v1` documents. */
export const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1_000;

const MESSAGE_TYPE = 'customer.register.v1';

/**
 * Registering a customer: one row, one document, one set of events.
 *
 * Three things happen here that are easy to get subtly wrong, so each is done
 * deliberately:
 *
 * **Idempotency comes first.** A redelivered command finds its own record and
 * returns without touching a row or publishing anything. Publishing again would
 * be worse than a duplicate row — the audit trail would show two registrations
 * where one happened.
 *
 * **The username is chosen inside the transaction.** The repository walks the
 * candidate sequence and lets the unique index decide, so two simultaneous
 * registrations of two people with the same name cannot both take it. Reading
 * first and writing second is the race the assignment asks this service to
 * survive (§4.1, p. 5).
 *
 * **A bad photo does not refuse the registration.** The two axes are
 * independent (`docs/domain/entities.md`): the customer exists with
 * `identityStatus = REJECTED` and can fix it by uploading another photo. Losing
 * the whole registration over a blurry JPEG would make people re-type
 * everything for a mistake the system can name precisely.
 */
export class RegisterCustomerUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #hasher: PasswordHasher;
  readonly #tokens: ActivationTokenFactory;
  readonly #documents: IdentityDocumentReader;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly hasher: PasswordHasher;
    readonly tokens: ActivationTokenFactory;
    readonly documents: IdentityDocumentReader;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#hasher = dependencies.hasher;
    this.#tokens = dependencies.tokens;
    this.#documents = dependencies.documents;
    this.#clock = dependencies.clock;
  }

  public async execute(command: CustomerRegisterV1, idempotencyKey: string): Promise<void> {
    const seen = await this.#repository.findProcessed(idempotencyKey, MESSAGE_TYPE);

    if (seen !== null) {
      return;
    }

    const now = this.#clock.now();

    /**
     * The object is fetched **once**. Reading it twice — once to judge it, once
     * to store it — would let a swap between the two reads store bytes that
     * were never the ones judged.
     */
    const fetched = await this.#readPhoto(command.photo);
    const verdict =
      command.photo === null
        ? null
        : judgeIdentityPhoto(
            command.photo,
            fetched === null
              ? null
              : {
                  byteLength: fetched.bytes.byteLength,
                  sha256: fetched.sha256,
                  digestBelongsToAnother: await this.#repository.isDocumentDigestTaken(
                    fetched.sha256,
                    command.customerId,
                  ),
                },
          );

    const identityStatus: IdentityStatus =
      verdict === null ? 'PENDING' : verdict.outcome === 'VALIDATED' ? 'VALIDATED' : 'REJECTED';

    const activation = this.#tokens.issue();
    const expiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS).toISOString();

    let customer;

    try {
      customer = await this.#repository.registerCustomer({
        registration: {
          customerId: command.customerId,
          fullName: command.fullName,
          identityDocument: command.identityDocument,
          email: command.email,
          dateOfBirth: command.dateOfBirth,
          address: command.address,
          role: command.role,
        },
        usernameCandidates: usernameCandidates(command.fullName),
        credentialHash: await this.#hasher.hash(command.credential),
        document:
          fetched === null || command.photo === null
            ? null
            : {
                originalFilename: command.photo.objectKey,
                mimeType: command.photo.contentType,
                sizeBytes: fetched.bytes.byteLength,
                sha256: fetched.sha256,
                content: fetched.bytes,
                // A rejected photo is stored too: a teller asked why an
                // identity was refused needs to see what was uploaded, and a
                // rejection with no evidence is unarguable in both directions.
                validationStatus: identityStatus,
              },
        activation: { tokenHash: activation.tokenHash, expiresAt },
        identityStatus,
        idempotency: {
          idempotencyKey,
          messageType: MESSAGE_TYPE,
          resultSummary: { outcome: 'REGISTERED', customerId: command.customerId },
        },
        now,
      });
    } catch (error) {
      if (error instanceof DomainRejection) {
        await this.#refuse(error, idempotencyKey, now);
        return;
      }

      throw error;
    }

    await this.#publisher.publish({
      messageType: customerRegisteredV1.name,
      payload: {
        customerId: customer.customerId,
        username: customer.username,
        email: customer.email,
        role: customer.role,
        status: customer.status,
        identityStatus: customer.identityStatus,
        registeredAt: customer.createdAt,
      },
    });

    /**
     * The activation email is triggered by an event, not by an SMTP call. This
     * service owns customers; delivering mail is Notification & Audit's job,
     * and the clear token travels in this one message and nowhere else.
     */
    await this.#publisher.publish({
      messageType: customerActivationRequestedV1.name,
      payload: {
        customerId: customer.customerId,
        email: customer.email,
        expiresAt,
        // The clear value travels here and nowhere else; the database holds
        // only its digest.
        activationToken: activation.token,
      },
    });

    if (verdict !== null) {
      await this.#publishVerdict(customer.customerId, verdict, now);
    }
  }

  /**
   * The bytes behind the reference, with their digest, or `null`.
   *
   * Unreachable storage and a missing key are the same fact from here: the
   * bytes this reference describes could not be read, and an identity cannot be
   * validated against something nobody can see.
   */
  async #readPhoto(
    photo: PhotoReference | null,
  ): Promise<{ readonly bytes: Buffer; readonly sha256: string } | null> {
    if (photo === null) {
      return null;
    }

    try {
      const bytes = await this.#documents.read(photo);

      return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
    } catch {
      return null;
    }
  }

  /** Records the refusal and says so, since the caller was told `202` long ago. */
  async #refuse(rejection: DomainRejection, idempotencyKey: string, now: Date): Promise<void> {
    const reason = REGISTRATION_REJECTIONS.has(rejection.code)
      ? (rejection.code as 'DOCUMENT_ALREADY_REGISTERED' | 'EMAIL_ALREADY_REGISTERED' | 'INVALID_BIRTH_DATE')
      : 'INVALID_BIRTH_DATE';

    await this.#repository.recordProcessed({
      idempotencyKey,
      messageType: MESSAGE_TYPE,
      resultSummary: { outcome: 'REJECTED', reason },
    });

    await this.#publisher.publish({
      messageType: customerRegisterRejectedV1.name,
      payload: { reason, rejectedAt: now.toISOString() },
    });
  }

  async #publishVerdict(customerId: string, verdict: IdentityVerdict, now: Date): Promise<void> {
    if (verdict.outcome === 'VALIDATED') {
      await this.#publisher.publish({
        messageType: customerIdentityValidatedV1.name,
        payload: {
          customerId,
          identityStatus: 'VALIDATED',
          validatedAt: now.toISOString(),
        },
      });
      return;
    }

    await this.#publisher.publish({
      messageType: customerIdentityRejectedV1.name,
      payload: {
        customerId,
        identityStatus: 'REJECTED',
        reason: verdict.reason,
        rejectedAt: now.toISOString(),
      },
    });
  }
}

const REGISTRATION_REJECTIONS = new Set([
  'DOCUMENT_ALREADY_REGISTERED',
  'EMAIL_ALREADY_REGISTERED',
  'INVALID_BIRTH_DATE',
]);
