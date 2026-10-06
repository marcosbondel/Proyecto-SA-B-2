import { createHash } from 'node:crypto';

import { customerIdentityRejectedV1, customerIdentityValidatedV1 } from '@bank/contracts';
import type { CustomerValidateIdentityV1 } from '@bank/contracts';

import { DomainRejection, recordIdentityVerdict } from '../domain/customer';
import { judgeIdentityPhoto } from '../domain/identity-validation';
import type { IdentityVerdict } from '../domain/identity-validation';
import type {
  Clock,
  CustomerRepository,
  EventPublisher,
  IdentityDocumentReader,
  LifecycleTelemetry,
} from './ports';

const MESSAGE_TYPE = 'customer.validate-identity.v1';

/**
 * A second look at somebody's identity document.
 *
 * This is the path a customer takes after a rejection: upload another photo,
 * and the verdict is recomputed against the new bytes. `REJECTED → PENDING →
 * VALIDATED` is the intended cycle, and the domain refuses to re-open an
 * identity that is already `VALIDATED` — letting a second document quietly
 * replace an accepted one is how an approved identity stops meaning anything.
 *
 * The validation is simulated, as the ticket requires: no OCR and no provider,
 * but every check that does not need to look at the picture — the object
 * exists, the type is allowed, the size is within the ceiling, the digest
 * matches the bytes, and the photo is not already somebody else's.
 */
export class ValidateIdentityUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #documents: IdentityDocumentReader;
  readonly #clock: Clock;
  readonly #telemetry: LifecycleTelemetry;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly documents: IdentityDocumentReader;
    readonly clock: Clock;
    readonly telemetry: LifecycleTelemetry;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#documents = dependencies.documents;
    this.#clock = dependencies.clock;
    this.#telemetry = dependencies.telemetry;
  }

  public async execute(command: CustomerValidateIdentityV1, idempotencyKey: string): Promise<void> {
    const seen = await this.#repository.findProcessed(idempotencyKey, MESSAGE_TYPE);

    if (seen !== null) {
      return;
    }

    const now = this.#clock.now();
    const customer = await this.#repository.findById(command.customerId);

    if (customer === null) {
      // Retrying cannot make the customer appear; the dead-letter queue is for
      // failures that repair themselves, and this is not one.
      await this.#repository.recordProcessed({
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: { outcome: 'IGNORED', reason: 'UNKNOWN_CUSTOMER' },
      });
      this.#telemetry.ignored({
        transition: 'rejected',
        customerId: command.customerId,
        reason: 'UNKNOWN_CUSTOMER',
      });
      return;
    }

    const fetched = await this.#readPhoto(command);
    const verdict: IdentityVerdict = judgeIdentityPhoto(
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

    let updated;

    try {
      updated = recordIdentityVerdict(
        customer,
        verdict.outcome === 'VALIDATED' ? 'VALIDATED' : 'REJECTED',
        now,
      );
    } catch (error) {
      if (error instanceof DomainRejection) {
        await this.#repository.recordProcessed({
          idempotencyKey,
          messageType: MESSAGE_TYPE,
          resultSummary: { outcome: 'IGNORED', reason: error.code },
        });
        this.#telemetry.ignored({
          transition: verdict.outcome === 'VALIDATED' ? 'verified' : 'rejected',
          customerId: command.customerId,
          reason: error.code,
        });
        return;
      }

      throw error;
    }

    await this.#repository.saveIdentityVerdict({
      customer: updated,
      document:
        fetched === null
          ? null
          : {
              originalFilename: command.photo.objectKey,
              mimeType: command.photo.contentType,
              sizeBytes: fetched.bytes.byteLength,
              sha256: fetched.sha256,
              content: fetched.bytes,
              validationStatus: updated.identityStatus,
            },
      idempotency: {
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        resultSummary: {
          outcome: updated.identityStatus,
          customerId: updated.customerId,
        },
      },
    });

    // `recordIdentityVerdict` moves the KYC status with the identity one, so
    // this path decides a KYC verdict too and must be counted like the others.
    this.#telemetry.record({
      transition: verdict.outcome === 'VALIDATED' ? 'verified' : 'rejected',
      customerId: updated.customerId,
      path: 'review',
      createdAt: customer.createdAt,
      at: now,
      creationTrace: await this.#repository.findCreationTrace(command.customerId),
    });

    if (verdict.outcome === 'VALIDATED') {
      await this.#publisher.publish({
        messageType: customerIdentityValidatedV1.name,
        payload: {
          customerId: updated.customerId,
          identityStatus: 'VALIDATED',
          validatedAt: now.toISOString(),
        },
      });
      return;
    }

    await this.#publisher.publish({
      messageType: customerIdentityRejectedV1.name,
      payload: {
        customerId: updated.customerId,
        identityStatus: 'REJECTED',
        reason: verdict.reason,
        rejectedAt: now.toISOString(),
      },
    });
  }

  async #readPhoto(
    command: CustomerValidateIdentityV1,
  ): Promise<{ readonly bytes: Buffer; readonly sha256: string } | null> {
    try {
      const bytes = await this.#documents.read(command.photo);

      return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
    } catch {
      return null;
    }
  }
}
