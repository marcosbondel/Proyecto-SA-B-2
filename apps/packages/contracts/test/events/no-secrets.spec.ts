import { z } from 'zod';

import { catalog } from '../../src/events';

/**
 * SC-009. Three messages carry a bearer secret because they have to: the
 * credential on the way in, and the activation token on the way out and back.
 * All three are documented, and each is the *only* place that value appears.
 *
 * The allowlist is the point of this test. A third message that starts carrying
 * a secret fails it, which is the moment somebody should be asked why.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'customer.register.v1': ['credential'],
  'customer.authenticate.v1': ['credential'],
  'customer.verify-email.v1': ['activationToken'],
  // Added by T-16. The event asks for an email containing an activation link;
  // without the token there is nothing to put in the link, and Customer Service
  // keeps only the digest.
  'customer.activation.requested.v1': ['activationToken'],
  /*
   * The password-recovery flow, added for the prototype's `P-07`. It is the
   * activation flow's shape repeated exactly: the clear token travels only in
   * the event that asks for the email, and comes back only in the command that
   * spends it — this time alongside the new credential, which travels here and
   * in `customer.register.v1` and nowhere else.
   */
  'customer.password-reset.issued.v1': ['resetToken'],
  'customer.password-reset.confirm.v1': ['resetToken', 'credential'],
  /*
   * Changing a password from inside a session. Both credentials travel: the old
   * one is the authorisation and the new one is the thing being set, and there
   * is no way to do this without carrying them together exactly once.
   */
  'customer.change-password.v1': ['currentCredential', 'newCredential'],
};

const FORBIDDEN = /password|passwd|secret|jwt|bearer|signature|privatekey|apikey/i;
const BYTES = /bytes|binary|base64|blob|imagedata|payloadcontent/i;

interface Field {
  readonly name: string;
  readonly type: string | undefined;
}

/**
 * Every field a contract declares, nested objects included, with its type.
 *
 * The type matters: `sizeBytes` is an integer that *describes* how large the
 * document is, and flagging it would be a false alarm. What must never exist is
 * a **string** that could hold the bytes themselves.
 */
function fieldsOf(schema: unknown, seen: Field[] = []): Field[] {
  const json = z.toJSONSchema(schema as z.ZodType, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;

  const walk = (node: Record<string, unknown>): void => {
    const properties = node['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (properties !== undefined) {
      for (const [key, child] of Object.entries(properties)) {
        seen.push({ name: key, type: child['type'] as string | undefined });
        walk(child);
      }
    }

    for (const key of ['oneOf', 'anyOf', 'allOf']) {
      for (const branch of (node[key] as Record<string, unknown>[] | undefined) ?? []) {
        walk(branch);
      }
    }

    const items = node['items'] as Record<string, unknown> | undefined;
    if (items !== undefined) walk(items);
  };

  walk(json);
  return seen;
}

describe.each(catalog.map((c) => [c.name, c] as const))('%s', (name, contract) => {
  const fields = fieldsOf(contract.schema);
  const names = fields.map((field) => field.name);
  const allowed = ALLOWED[name] ?? [];

  it('declares no field that looks like a password, token or signing secret', () => {
    const offenders = names.filter((field) => FORBIDDEN.test(field) && !allowed.includes(field));

    expect(offenders).toEqual([]);
  });

  it('declares no string field that could carry raw bytes', () => {
    const offenders = fields
      .filter((field) => field.type === 'string' && BYTES.test(field.name))
      .map((field) => field.name);

    expect(offenders).toEqual([]);
  });

  it('carries a bearer secret only where it is documented and allowed', () => {
    const carried = names.filter((field) => /credential|token/i.test(field));

    expect(carried.every((field) => allowed.includes(field))).toBe(true);
  });
});
