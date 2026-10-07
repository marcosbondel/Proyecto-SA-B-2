import { z } from 'zod';

/**
 * Builds a value that satisfies a schema, derived from the schema itself.
 *
 * Forty-two hand-written fixtures would be forty-two things to forget to update
 * when a contract changes. Deriving the sample means a contract that gains a
 * required field is exercised with that field, automatically — and if the
 * derivation is wrong, the test that parses the sample fails loudly rather than
 * passing on a stale fixture.
 */

/**
 * A distinct identifier per field name.
 *
 * Not cosmetic: `transfer.requested.v1` refuses a transfer whose source and
 * target are the same account (T-2), so a builder that hands every UUID field
 * the same value would generate a sample its own contract rejects.
 */
function uuidFor(field: string): string {
  let hash = 0;
  for (const character of field) {
    hash = (hash * 31 + character.charCodeAt(0)) % 0xffffffff;
  }

  const hex = hash.toString(16).padStart(8, '0').slice(0, 8);
  return `${hex}-9c2e-4a71-b8f5-2d6e7c0a1b93`;
}

/** Patterns the primitives use, answered with a value that satisfies them. */
const BY_PATTERN: readonly (readonly [RegExp, string])[] = [
  [/\^\[A-Z\]\{3\}\$/, 'GTQ'],
  [/\[0-9a-f\]\{64\}/, 'a'.repeat(64)],
  // A W3C trace id (T-45): the specification's own example.
  [/\[0-9a-f\]\{32\}/, '4bf92f3577b34da6a3ce929d0e0e4736'],
  [/\\\.v\[0-9\]\+\$/, 'account.debited.v1'],
];

interface JsonSchema {
  type?: string | string[];
  format?: string;
  pattern?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

function fromNode(node: JsonSchema, field = 'id'): unknown {
  if (node.const !== undefined) return node.const;
  if (node.enum !== undefined) return node.enum[0];

  const branches = node.oneOf ?? node.anyOf;
  if (branches !== undefined) {
    // Prefer a branch that is not `null`, so nullable fields carry a value.
    const meaningful = branches.find((b) => b.type !== 'null') ?? branches[0];
    return meaningful === undefined ? null : fromNode(meaningful, field);
  }

  const type = Array.isArray(node.type) ? node.type[0] : node.type;

  switch (type) {
    case 'object': {
      // Every property, optional ones included. Some contracts refuse a payload
      // in which nothing optional is present — `customer.update.v1` rejects an
      // update that changes no field — so a required-only sample would be
      // rejected by its own contract.
      const value: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        value[key] = fromNode(child, key);
      }
      return value;
    }
    case 'array': {
      const count = node.minItems ?? 1;
      const item = node.items;
      return item === undefined ? [] : Array.from({ length: count }, () => fromNode(item, field));
    }
    case 'integer':
    case 'number': {
      const low = node.exclusiveMinimum !== undefined ? node.exclusiveMinimum + 1 : node.minimum;
      return Math.max(low ?? 1, 1);
    }
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'string':
    default: {
      if (node.format === 'uuid') return uuidFor(field);
      if (node.format === 'date-time') return '2026-08-19T14:32:07.482Z';
      if (node.format === 'date') return '1990-04-17';
      if (node.format === 'email') return 'someone@example.test';

      if (node.pattern !== undefined) {
        for (const [pattern, value] of BY_PATTERN) {
          if (pattern.test(node.pattern)) return value;
        }
      }

      return 'x'.repeat(Math.max(node.minLength ?? 1, 1));
    }
  }
}

/** A value the schema accepts. */
export function validSample(schema: z.ZodType): unknown {
  return fromNode(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema);
}

/**
 * The same value with one **required** field removed.
 *
 * Returns `null` when the schema has no required field, which is the honest
 * answer rather than a fabricated failure: `transaction.status.requested.v1`
 * accepts either of two optional identifiers, so dropping one leaves a payload
 * that is still valid — and it should be.
 */
export function invalidSample(schema: z.ZodType): unknown | null {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  const node = json.oneOf?.[0] ?? json.anyOf?.[0] ?? json;
  const required = node.required ?? [];

  // Skip the discriminator: removing it changes which branch applies rather
  // than making the branch invalid.
  const dropped = required.find((key) => key !== 'outcome');
  if (dropped === undefined) return null;

  const sample = validSample(schema);
  if (typeof sample !== 'object' || sample === null || Array.isArray(sample)) return null;

  const { [dropped]: _removed, ...rest } = sample as Record<string, unknown>;
  void _removed;

  return rest;
}
