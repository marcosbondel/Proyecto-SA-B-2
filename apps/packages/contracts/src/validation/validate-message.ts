import type { MessageEnvelope } from '../envelope';
import { contractFor } from '../events';
import { envelopeSchema } from '../schemas/envelope.schema';
import { versionOf } from '../schemas/primitives';

/**
 * Why a message was refused.
 *
 * The kinds are distinct because they call for different handling: an unknown
 * type or an unsupported version can never become valid by waiting, so it goes
 * straight to the dead-letter queue, while telling them apart is what lets an
 * operator see whether a producer is ahead of its consumers.
 */
export type RejectionKind =
  'malformed-envelope' | 'unknown-type' | 'unsupported-version' | 'invalid-payload';

export type ValidationResult =
  | { readonly ok: true; readonly envelope: MessageEnvelope<unknown> }
  | { readonly ok: false; readonly kind: RejectionKind; readonly reason: string };

/**
 * Validates a delivery completely, before any domain logic runs (FR-023).
 *
 * The envelope is checked first and the payload second, against the contract
 * the `messageType` names. Splitting the two is what lets a consumer refuse an
 * unknown message without owning every contract in the catalogue.
 *
 * Unknown payload fields are **tolerated** — stripped, not rejected. Without
 * that rule, adding an optional field to a message would require deploying all
 * seven applications at once, and the whole point of versioning by name is that
 * it does not.
 */
export function validateMessage(raw: unknown): ValidationResult {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return {
      ok: false,
      kind: 'malformed-envelope',
      reason: envelope.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    };
  }

  const contract = contractFor(envelope.data.messageType);
  if (contract === undefined) {
    const versioned = versionOf(envelope.data.messageType);
    const base = envelope.data.messageType.replace(/\.v[0-9]+$/, '');

    // A name we know at another version is a different situation from a name we
    // have never heard of: the first means a producer is ahead of us.
    const knownAtAnotherVersion = versioned !== null && contractFor(`${base}.v1`) !== undefined;

    return knownAtAnotherVersion
      ? {
          ok: false,
          kind: 'unsupported-version',
          reason: `No contract for "${envelope.data.messageType}"; this consumer knows "${base}.v1".`,
        }
      : {
          ok: false,
          kind: 'unknown-type',
          reason: `No contract named "${envelope.data.messageType}".`,
        };
  }

  const payload = contract.schema.safeParse(envelope.data.payload);
  if (!payload.success) {
    return {
      ok: false,
      kind: 'invalid-payload',
      reason: payload.error.issues
        .map((issue) => `payload.${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    };
  }

  return {
    ok: true,
    envelope: { ...envelope.data, payload: payload.data } as MessageEnvelope<unknown>,
  };
}

/**
 * The adapter-facing form: yes or no, plus a reason short enough for a header.
 *
 * `@bank/messaging` takes this as an injected function so the transport layer
 * never imports the catalogue.
 */
export function messageValidator(
  envelope: MessageEnvelope<unknown>,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const result = validateMessage(envelope);

  return result.ok ? { ok: true } : { ok: false, reason: `${result.kind}: ${result.reason}` };
}
