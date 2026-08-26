import type { PhotoReference } from '@bank/contracts';

/** The bytes and their declared type, as they arrived on the request. */
export interface PhotoUpload {
  readonly bytes: Buffer;
  readonly contentType: 'image/jpeg' | 'image/png';
}

/**
 * Parks an identity-document photo where the owning service can fetch it.
 *
 * This is the one thing the gateway writes, and it is deliberately not
 * persistence: ADR-012 defines the bucket as a **transfer buffer**. Nobody
 * queries it to decide anything, and the photo's owner remains Customer
 * Service. A gateway with real persistence would be a sixth service wearing a
 * different name.
 */
export interface ObjectStoragePort {
  /**
   * Stores the bytes and returns only what may travel on the broker: where the
   * object is, what it claims to be, how big it is, and its digest.
   *
   * The digest is the point of the whole shape — Customer Service recomputes it
   * after fetching and refuses anything that does not match, so a swapped or
   * truncated object cannot become an accepted identity document.
   *
   * @throws an `INTERNAL_ERROR` GatewayError, naming neither bucket nor
   * endpoint. The caller gets a failure, not a map of the infrastructure.
   */
  put(upload: PhotoUpload): Promise<PhotoReference>;
}

export const OBJECT_STORAGE = Symbol('ObjectStoragePort');
