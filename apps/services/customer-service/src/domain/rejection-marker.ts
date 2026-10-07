/**
 * What a rejected identity leaves behind in the three unique columns.
 *
 * Rejecting an identity releases the person's document, email and username so
 * they can register again, and does it by appending `#rejected#<customerId>`
 * to each (see `saveIdentityVerdict`). The marker is storage bookkeeping: it is
 * not part of what the customer typed, and it is not a valid email, so a reply
 * built from the stored value would fail its own contract.
 */
export const REJECTION_MARKER = '#rejected#';

/** The value as the customer submitted it, with the marker (and the id after it) removed. */
export function withoutRejectionMarker(stored: string): string {
  const at = stored.indexOf(REJECTION_MARKER);

  return at === -1 ? stored : stored.slice(0, at);
}
