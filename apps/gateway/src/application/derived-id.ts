import { createHmac } from 'node:crypto';

/**
 * A UUID v4-shaped identifier that is a **function of its inputs**.
 *
 * The Gateway mints some identifiers the caller cannot supply and the other
 * bank deduplicates on (the `interbankTransferId`). Minting them with
 * `randomUUID()` per request breaks idempotency in a way the transfer service
 * cannot repair: a retry of the same `Idempotency-Key` produces one debit, as
 * it should, but the response carries a **fresh** identifier that names
 * nothing (T-60, production 2026-10-19). Deriving it from the actor and the
 * idempotency key makes the retry return the identifier of the original.
 *
 * Keyed with a server secret (HMAC-SHA-256), not merely hashed: the identifier
 * is the key the partner bank deduplicates on, and one that anybody who knows a
 * customer id and a header value could compute is one that can be collided on
 * purpose. Without the secret the output is indistinguishable from random.
 *
 * The version and variant bits are forced so the result is a valid v4 UUID —
 * the contract declares `format: uuid` and `GET /api/interbank/transfers/:id`
 * validates `version: '4'`.
 *
 * `label` separates identifiers derived from the same inputs, so the
 * transaction id and the interbank id of one send are unrelated values.
 */
export function deriveUuidV4(secret: string, label: string, ...parts: readonly string[]): string {
  const digest = createHmac('sha256', secret)
    // Length-prefixed, so ("ab","c") and ("a","bc") cannot derive the same value.
    .update([label, ...parts].map((part) => `${String(part.length)}:${part}`).join('|'))
    .digest();

  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
