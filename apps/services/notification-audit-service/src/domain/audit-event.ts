import type { EventSeverity } from './classification';

/**
 * One message, as this service wrote it down.
 *
 * The trail is **append-only**. Nothing in this service updates a row and
 * nothing deletes one: an audit record that can be edited is not evidence, it
 * is a second opinion. The consequence is that a message which arrived twice
 * must be refused *before* the insert rather than corrected after it, which is
 * what `deduplication.ts` is for.
 */
export type AuditProcessingStatus = 'PROCESSED' | 'INVALID' | 'ERROR';

export interface AuditEvent {
  /** The envelope's `messageId`. This system's `eventId`. */
  readonly eventId: string;
  readonly messageType: string;
  readonly messageVersion: number;
  readonly producer: string;
  /** When the producer says it happened. Not when this service heard it. */
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly correlationId: string;
  readonly causationId: string | null;
  /** Already redacted. The raw payload is never stored (see `redaction.ts`). */
  readonly payload: Record<string, unknown>;
  readonly processingStatus: AuditProcessingStatus;
  /** Which family queue delivered it. Half of the deduplication key. */
  readonly consumer: string;
  /**
   * §4.1's classification, computed once by `classify()` and written down
   * rather than recomputed on read. `null` for a row written before T-30 —
   * that is the honest answer for a row nobody classified, not a value to
   * paper over with a default (see `migrations.ts`).
   */
  readonly severity: EventSeverity | null;
}

/**
 * The order a trail is read in, and the tie-break that makes it deterministic.
 *
 * `occurredAt` is the producer's clock, so two services acting inside the same
 * millisecond can produce equal timestamps — and across five processes on five
 * machines they can even arrive out of order. Sorting by `occurredAt` alone
 * would then let the same trail render in two different orders on two loads,
 * which is exactly the property that makes somebody stop trusting an audit
 * screen.
 *
 * `causationId` would be the causally correct ordering, and it is deliberately
 * not used as the sort key: a trail containing a message whose cause was never
 * recorded — the service was down when it passed — would have no total order at
 * all, and the screen has to draw something. So the chain is *shown* per row
 * and the *order* is the clock plus a stable tie-break.
 */
export function orderTrail<T extends { occurredAt: Date; eventId: string }>(
  events: readonly T[],
): readonly T[] {
  return [...events].sort((left, right) => {
    const byTime = left.occurredAt.getTime() - right.occurredAt.getTime();

    return byTime !== 0 ? byTime : left.eventId.localeCompare(right.eventId);
  });
}

/**
 * How this service fared with a message, as a value rather than an exception.
 *
 * The three outcomes are what criterion 3 asks to be visible: `PROCESSED` for
 * the ordinary case, `INVALID` when the envelope arrived but its payload did
 * not match the contract it claimed, and `ERROR` when this service itself
 * failed while recording it.
 *
 * **None of them is reported back to the producer.** That is the point of the
 * ticket's third criterion and of the whole service: a bank that stops
 * transferring money because its audit trail choked on one malformed message
 * has the dependency backwards.
 */
export function statusForRejection(kind: string): AuditProcessingStatus {
  /*
   * `invalid-payload`, `unknown-type` and `unsupported-version` are all "the
   * message is not what this consumer can read", and none of them becomes valid
   * by waiting. `ERROR` is reserved for a failure on *this* side, because
   * mixing the two would make "the producer sent rubbish" and "our database was
   * down" look like the same incident on the screen that is supposed to tell
   * them apart.
   */
  return kind === 'error' ? 'ERROR' : 'INVALID';
}
