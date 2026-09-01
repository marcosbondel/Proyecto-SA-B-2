import { Inject, Injectable } from '@nestjs/common';
import { customerIdentityDocumentQueryV1, customerIdentityDocumentRepliedV1 } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import { GatewayError } from '../errors/gateway-error';
import {
  MESSAGE_PUBLISHER,
  OBJECT_STORAGE,
  REPLY_WAITER,
  type MessagePublisherPort,
  type ObjectStoragePort,
  type ReplyWaiterPort,
} from '../ports';
import { askAndWait } from '../request-reply';
import { envelopeForRequest } from '../request-envelope';

export interface IdentityDocumentContext {
  readonly actor: Identity;
  readonly correlationId: string;
}

/** What the route needs to set the response's headers and body. */
export interface IdentityDocument {
  readonly contentType: string;
  readonly content: Buffer;
}

/**
 * The photo behind a pending identity — the read the placeholder in
 * `validaciones/[id].vue` was waiting on.
 *
 * Two hops, neither of which puts image bytes on the broker. First a tiny
 * question over the broker (`customerIdentityDocumentQueryV1`, a
 * `customerId` and nothing else), answered with a `PhotoReference` rather
 * than the bytes themselves — Customer Service stages its own stored document
 * into the object store for this one answer, the reverse of what it does at
 * registration. Then a read from that same object store, the second half of
 * the trip `ObjectStoragePort.put` makes for an upload. The gateway composes
 * the two; it decides nothing about the image itself (constitution V).
 */
@Injectable()
export class IdentityDocumentUseCase {
  readonly #publisher: MessagePublisherPort;
  readonly #replies: ReplyWaiterPort;
  readonly #storage: ObjectStoragePort;

  constructor(
    @Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort,
    @Inject(REPLY_WAITER) replies: ReplyWaiterPort,
    @Inject(OBJECT_STORAGE) storage: ObjectStoragePort,
  ) {
    this.#publisher = publisher;
    this.#replies = replies;
    this.#storage = storage;
  }

  public async fetch(customerId: string, context: IdentityDocumentContext): Promise<IdentityDocument> {
    const reply = await askAndWait(
      this.#publisher,
      this.#replies,
      envelopeForRequest(
        { customerId },
        customerIdentityDocumentQueryV1.name,
        context.actor,
        context.correlationId,
      ),
      'read',
    );

    const parsed = customerIdentityDocumentRepliedV1.schema.safeParse(reply.payload);

    if (!parsed.success) {
      throw GatewayError.internal();
    }

    if (parsed.data.outcome === 'NOT_FOUND') {
      // Customer Service's own code, carried untouched (FR-030) — the same
      // rule `QueriesUseCase` follows for every other reply.
      throw GatewayError.businessRejection(
        parsed.data.reason,
        parsed.data.reason === 'IDENTITY_OBJECT_NOT_FOUND'
          ? 'Este cliente no tiene una foto de documento cargada.'
          : 'El cliente consultado no existe.',
      );
    }

    const content = await this.#storage.get(parsed.data.photo.objectKey);

    return { contentType: parsed.data.photo.contentType, content };
  }
}
