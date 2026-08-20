import { z } from 'zod';

import { sha256Hex } from '../schemas/primitives';

/** Five megabytes, the cap T-05 fixed for an identity-document photo. */
export const MAX_PHOTO_BYTES = 5_242_880;

/**
 * How the identity-document photo travels: as a reference, never as bytes.
 *
 * ADR-012 puts the image in object storage because a 5 MB payload is two
 * orders of magnitude larger than every other message in the system, and one
 * parked in a dead-letter queue would hold broker memory for the whole
 * demonstration.
 *
 * The digest is the point of the whole shape. Customer Service recomputes it
 * after fetching the object and refuses to persist anything that does not
 * match, so a swapped or truncated object cannot become an accepted identity
 * document.
 */
export const photoReference = z.object({
  /** Key inside the `customer-identity-documents` bucket. */
  objectKey: z.string().min(1).max(512),

  contentType: z.enum(['image/jpeg', 'image/png']),

  /** Size as written. Checked against the object actually fetched. */
  sizeBytes: z.int().positive().max(MAX_PHOTO_BYTES),

  /** SHA-256 of the bytes, recomputed on read before anything is persisted. */
  sha256: sha256Hex,
});

export type PhotoReference = z.infer<typeof photoReference>;
