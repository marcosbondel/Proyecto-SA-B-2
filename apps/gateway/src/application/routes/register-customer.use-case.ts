import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { MAX_PHOTO_BYTES, customerRegisterV1 } from '@bank/contracts';
import type { PhotoReference, Role } from '@bank/contracts';

import { GatewayError } from '../errors/gateway-error';
import {
  MESSAGE_PUBLISHER,
  OBJECT_STORAGE,
  type MessagePublisherPort,
  type ObjectStoragePort,
  type PhotoUpload,
} from '../ports';
import { envelopeForRequest } from '../request-envelope';

const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);

export interface RegisterCustomerRequest {
  readonly fullName: string;
  readonly identityDocument: string;
  readonly email: string;
  readonly dateOfBirth: string;
  readonly address: string;
  readonly role: Role;
  readonly credential: string;
  readonly photo?: { readonly bytes: Buffer; readonly mimetype: string };
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface AcceptedCommand {
  readonly correlationId: string;
}

export interface RegisterCustomerResult extends AcceptedCommand {
  readonly customerId: string;
}

@Injectable()
export class RegisterCustomerUseCase {
  readonly #publisher: MessagePublisherPort;
  readonly #storage: ObjectStoragePort;

  constructor(
    @Inject(MESSAGE_PUBLISHER) publisher: MessagePublisherPort,
    @Inject(OBJECT_STORAGE) storage: ObjectStoragePort,
  ) {
    this.#publisher = publisher;
    this.#storage = storage;
  }

  /**
   * Validate, hash, upload, publish — and never in another order.
   *
   * Publishing first would leave a reference to an object that does not exist
   * yet, and Customer Service would reject the registration with
   * `IDENTITY_OBJECT_NOT_FOUND` *after* the caller had been told `202`. The
   * upload failing is a failure of the whole request, not a half-done one.
   */
  public async execute(request: RegisterCustomerRequest): Promise<RegisterCustomerResult> {
    const photo = await this.#storePhoto(request.photo);
    const customerId = randomUUID();

    const payload = {
      customerId,
      fullName: request.fullName,
      identityDocument: request.identityDocument,
      email: request.email,
      dateOfBirth: request.dateOfBirth,
      address: request.address,
      role: request.role,
      credential: request.credential,
      photo,
    };

    // Parsed against the contract before it can reach the broker. The DTO
    // already checked shape; this checks it against the thing that actually
    // defines the message, so the two cannot drift.
    const parsed = customerRegisterV1.schema.safeParse(payload);
    if (!parsed.success) {
      throw GatewayError.validation(
        parsed.error.issues[0]?.message ?? 'La solicitud no cumple el contrato de registro.',
        parsed.error.issues[0]?.path.join('.'),
      );
    }

    await this.#publisher.publish(
      envelopeForRequest(
        parsed.data,
        customerRegisterV1.name,
        // Registration is self-service: nobody is authenticated yet.
        null,
        request.correlationId,
        /**
         * The caller's key, carried untouched.
         *
         * It was accepted by the controller and then dropped here, which made
         * this the one write route whose retries were not idempotent: every
         * attempt minted a fresh key, so Customer Service saw two different
         * intentions and refused the second on the document's unique index.
         * A caller retrying after a timeout got a rejection for a registration
         * that had in fact succeeded.
         */
        { idempotencyKey: request.idempotencyKey },
      ),
    );

    return { customerId, correlationId: request.correlationId };
  }

  /**
   * Puts the bytes where Customer Service can fetch them, or refuses.
   *
   * A registration without a photo is legitimate — the contract makes the
   * reference nullable — and identity validation happens separately.
   */
  async #storePhoto(
    photo: RegisterCustomerRequest['photo'],
  ): Promise<PhotoReference | null> {
    if (photo === undefined) {
      return null;
    }

    if (photo.bytes.byteLength > MAX_PHOTO_BYTES) {
      throw GatewayError.validation('La foto del documento supera los 5 MB.', 'photo');
    }

    if (!ALLOWED_PHOTO_TYPES.has(photo.mimetype)) {
      throw GatewayError.validation('La foto del documento debe ser JPEG o PNG.', 'photo');
    }

    const upload: PhotoUpload = {
      bytes: photo.bytes,
      contentType: photo.mimetype as PhotoUpload['contentType'],
    };

    return await this.#storage.put(upload);
  }
}
