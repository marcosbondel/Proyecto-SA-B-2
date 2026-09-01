import { customerIdentityDocumentRepliedV1 } from '@bank/contracts';
import type { CustomerIdentityDocumentQueryV1, Identity } from '@bank/contracts';

import { mayValidateIdentity } from '../domain/customer';
import type { CustomerRepository, EventPublisher, IdentityDocumentStager } from './ports';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

/**
 * The photo behind a pending validation — what a teller could not see before
 * this, and the reason `validaciones/[id].vue` carried a placeholder instead
 * of the document it asked the cajero to compare.
 *
 * Staff only, checked here and not just at the Gateway, the same reason
 * `SetIdentityVerdictUseCase` re-checks its own permission: an enforcement
 * that lives only at the edge holds only until a second producer appears.
 * Answered `NOT_FOUND` / `CUSTOMER_NOT_FOUND` rather than a distinguishable
 * refusal, exactly as `GetCustomerUseCase` answers an unauthorised or unknown
 * id — a query that could tell the two apart would be a way to discover which
 * customer ids exist.
 *
 * `FOUND` never carries the bytes. It stages them into the object store and
 * replies with a `PhotoReference`, the same shape and the same reason
 * ADR-012 gives the write path: no message in this system carries image
 * bytes, and a reply is not an exception to that.
 *
 * Not idempotency-guarded, like every other query here: a redelivery must
 * produce a fresh reply (and a fresh staged copy) rather than a silence that
 * leaves the Gateway waiting out its five seconds.
 */
export class GetIdentityDocumentUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #stager: IdentityDocumentStager;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly stager: IdentityDocumentStager;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#stager = dependencies.stager;
  }

  public async execute(
    query: CustomerIdentityDocumentQueryV1,
    identity: Identity | null,
  ): Promise<void> {
    if (!mayValidateIdentity(identity)) {
      await this.#notFound('CUSTOMER_NOT_FOUND');
      return;
    }

    const customer = await this.#repository.findById(query.customerId);

    if (customer === null) {
      await this.#notFound('CUSTOMER_NOT_FOUND');
      return;
    }

    const document = await this.#repository.findLatestIdentityDocument(query.customerId);

    if (document === null) {
      await this.#notFound('IDENTITY_OBJECT_NOT_FOUND');
      return;
    }

    // Guards the cast below. Every document this service ever stores passed
    // `judgeIdentityPhoto`'s `ALLOWED_MIME_TYPES` check at write time, so this
    // is defensive rather than expected — but a stager that trusted the
    // column blindly would be the one place a bad value from anywhere else
    // could reach the object store as a false content type.
    if (!ALLOWED_MIME_TYPES.has(document.mimeType)) {
      await this.#notFound('IDENTITY_OBJECT_NOT_FOUND');
      return;
    }

    const photo = await this.#stager.stage({
      content: document.content,
      mimeType: document.mimeType as 'image/jpeg' | 'image/png',
      sha256: document.sha256,
      sizeBytes: document.sizeBytes,
    });

    await this.#publisher.reply({
      messageType: customerIdentityDocumentRepliedV1.name,
      payload: { outcome: 'FOUND', photo },
    });
  }

  async #notFound(reason: 'CUSTOMER_NOT_FOUND' | 'IDENTITY_OBJECT_NOT_FOUND'): Promise<void> {
    await this.#publisher.reply({
      messageType: customerIdentityDocumentRepliedV1.name,
      payload: { outcome: 'NOT_FOUND', reason },
    });
  }
}
