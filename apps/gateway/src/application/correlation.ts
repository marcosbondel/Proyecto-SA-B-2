import { randomUUID } from 'node:crypto';

/** The header a caller may use to name their own correlation. */
export const CORRELATION_HEADER = 'x-correlation-id';

/** The header a caller may use to mark two requests as the same intention. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * A version-4 UUID, which is what every identifier in this system is.
 *
 * Accepting an arbitrary string would let a caller push whatever they liked
 * into the audit record and into every log line of the resulting Saga.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Decides the correlation identifier for one request.
 *
 * Keeps the caller's when they brought one, mints one when they did not. That
 * asymmetry is the whole feature: a client retrying a failed operation can
 * carry the same correlation across attempts and read one coherent story out
 * of the audit record afterwards.
 *
 * A malformed value is **replaced rather than rejected**. The correlation
 * identifier is a diagnostic aid, not an instruction, and failing a legitimate
 * banking request over a mistyped trace header would trade something valuable
 * for something cosmetic.
 */
export function correlationIdFrom(header: unknown): string {
  return typeof header === 'string' && UUID_V4.test(header) ? header.toLowerCase() : randomUUID();
}

/**
 * Reads the caller's idempotency key, or mints one.
 *
 * The gateway never interprets it. Recognising that two requests mean the same
 * thing is the receiving service's decision (constitution V): the gateway would
 * have to know what the payload *means* to do it, and it deliberately does not.
 *
 * Bounded at 128 characters so a caller cannot turn a header into a payload of
 * their own.
 */
export function idempotencyKeyFrom(header: unknown): string {
  if (typeof header === 'string') {
    const trimmed = header.trim();
    if (trimmed.length > 0 && trimmed.length <= 128) {
      return trimmed;
    }
  }

  return randomUUID();
}
