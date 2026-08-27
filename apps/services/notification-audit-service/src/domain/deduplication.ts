/**
 * What "the same message, again" means here.
 *
 * The broker guarantees *at least once*. A redelivery after a retry, a
 * reconnection mid-acknowledgement, or a replica restarting on a queue it had
 * not finished draining all produce the same envelope a second time — and the
 * envelope's `messageId` is stable across every one of them, because
 * `createEnvelope` mints it once at the producer and the retry ladder in
 * `@bank/messaging` re-publishes the message unchanged.
 *
 * So `messageId` is the deduplication key, and criterion 2 — "un evento
 * duplicado no genera segundo registro ni segunda notificación" — is a unique
 * constraint rather than a check-then-insert. The difference is not
 * stylistic: two replicas draining the same queue can both find nothing and
 * both insert, and only the database can arbitrate that.
 */

/**
 * The key a record is unique by: the message, and which consumer recorded it.
 *
 * Two parts and not one, because T-20 split this service into five queues by
 * family. A message can legitimately be delivered to more than one of them —
 * nothing in the topology stops a future binding from overlapping — and a
 * single-column key would then silently drop the second recording and make the
 * overlap invisible. Keyed by the pair, the trail shows exactly what each
 * consumer saw, and the duplicate that matters (the same queue, twice) is still
 * refused.
 *
 * The ticket asks for precisely this: "`event_id` UUID — única por
 * (`event_id`, consumidor) para deduplicar".
 */
export interface DeduplicationKey {
  readonly eventId: string;
  readonly consumer: string;
}

export function deduplicationKey(eventId: string, consumer: string): DeduplicationKey {
  return { eventId, consumer };
}

/** The pair as one string, for a `Set` in a test or an in-memory double. */
export function deduplicationKeyOf(key: DeduplicationKey): string {
  return `${key.eventId}::${key.consumer}`;
}

/**
 * What became of a message this service was handed.
 *
 * `DUPLICATE` is a **normal outcome, not a failure**. Treating it as an error
 * would send a perfectly correct redelivery down the retry ladder to be refused
 * three more times and then dead-lettered, where somebody would eventually
 * investigate the system working as designed.
 */
export type RecordOutcome =
  | { readonly kind: 'RECORDED'; readonly notified: boolean }
  | { readonly kind: 'DUPLICATE' }
  /** Written down as `INVALID` and acknowledged. The producer is never told. */
  | { readonly kind: 'INVALID'; readonly reason: string };
