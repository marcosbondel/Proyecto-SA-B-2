/**
 * The simulated validation of the identity-document photo.
 *
 * The ticket is explicit that this is **simulated**: no OCR, no provider, no
 * face matching. What it does check is everything that can be checked without
 * looking at the picture — that the object exists, that it is an image of an
 * allowed type, that it is not larger than the ceiling, that the bytes hash to
 * the digest the reference claims, and that this exact photo does not already
 * belong to somebody else.
 *
 * The digest check is the one that earns its keep. The Gateway computes the
 * hash over the bytes it uploads and this service recomputes it over the bytes
 * it fetches; without that round trip the reference would be a claim nobody
 * verifies, and an object swapped in storage between the two would become an
 * accepted identity document.
 */

export const MAX_PHOTO_BYTES = 5_242_880;
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

export type IdentityRejectionReason =
  | 'IDENTITY_DOCUMENT_UNREADABLE'
  | 'IDENTITY_OBJECT_NOT_FOUND'
  | 'IDENTITY_DIGEST_MISMATCH';

/** What the reference claims about the object, before anything is fetched. */
export interface DeclaredPhoto {
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** What was actually found in object storage. */
export interface FetchedPhoto {
  readonly byteLength: number;
  readonly sha256: string;
  /** True when this digest is already another customer's document. */
  readonly digestBelongsToAnother: boolean;
}

export type IdentityVerdict =
  | { readonly outcome: 'VALIDATED' }
  | { readonly outcome: 'REJECTED'; readonly reason: IdentityRejectionReason };

/**
 * The verdict on one photo.
 *
 * A duplicated digest is reported as `IDENTITY_DOCUMENT_UNREADABLE`, and that
 * is a compromise worth naming: the catalogue has three identity rejection
 * codes and none of them means "this photo is already somebody else's". Adding
 * a fourth would change `customer.identity.rejected.v1`, which is a versioned
 * message T-05 closed, so the nearest existing code is used and the gap is
 * recorded as debt rather than papered over with a new code invented here.
 */
export function judgeIdentityPhoto(
  declared: DeclaredPhoto,
  fetched: FetchedPhoto | null,
): IdentityVerdict {
  if (fetched === null) {
    return { outcome: 'REJECTED', reason: 'IDENTITY_OBJECT_NOT_FOUND' };
  }

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(declared.contentType)) {
    return { outcome: 'REJECTED', reason: 'IDENTITY_DOCUMENT_UNREADABLE' };
  }

  if (fetched.byteLength === 0 || fetched.byteLength > MAX_PHOTO_BYTES) {
    return { outcome: 'REJECTED', reason: 'IDENTITY_DOCUMENT_UNREADABLE' };
  }

  /**
   * Both halves matter. A size that disagrees with the object is as much a
   * mismatch as a digest that does: the reference is a description of specific
   * bytes, and a description that is wrong about one field cannot be trusted
   * about the other.
   */
  if (fetched.sha256 !== declared.sha256 || fetched.byteLength !== declared.sizeBytes) {
    return { outcome: 'REJECTED', reason: 'IDENTITY_DIGEST_MISMATCH' };
  }

  if (fetched.digestBelongsToAnother) {
    return { outcome: 'REJECTED', reason: 'IDENTITY_DOCUMENT_UNREADABLE' };
  }

  return { outcome: 'VALIDATED' };
}
