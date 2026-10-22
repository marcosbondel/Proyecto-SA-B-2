import { z } from 'zod';

/**
 * The partner banks this bank can send deposits to and receive them from
 * (T-60), as the Gateway and Payment Service both read them from the
 * `INTERBANK_PARTNERS` variable: a JSON array, one object per bank.
 *
 * A bank code alone cannot be called — it says who a bank is, not where it
 * listens nor how it lets us in — so "any bank of the contract" means any bank
 * **registered here**. Adding one is configuration, not code: that is what lets
 * the course swap the partner on grading day without a release.
 *
 * - `bankCode` — theirs, `^BANK[0-9]{2}$`, as they send it in `originBankCode`.
 * - `baseUrl` — their `/interbank/v1` base. The callback for a deposit they
 *   send us is derived from it, as the contract says; it is never configured.
 * - `apiKeyOutbound` — the key **they** issued us, sent in `X-Api-Key`.
 * - `apiKeyInbound` — the key **we** issued them. The Gateway identifies the
 *   caller by it, so every bank needs its own: a shared key cannot tell two
 *   banks apart, and the contract rejects a body that claims another bank.
 *
 * Lives in `@bank/contracts` because both services parse the same value and a
 * cross-service import is not allowed; it is a schema with no I/O.
 */
const partner = z
  .object({
    bankCode: z.string().regex(/^BANK[0-9]{2}$/, 'bankCode debe cumplir ^BANK[0-9]{2}$'),
    baseUrl: z
      .string()
      .regex(/^https?:\/\/[^\s/]+/, 'baseUrl debe ser una URL http(s) absoluta')
      .transform((url) => url.replace(/\/+$/, '')),
    apiKeyOutbound: z.string().min(1, 'apiKeyOutbound no puede estar vacía'),
    apiKeyInbound: z.string().min(32, 'apiKeyInbound debe tener al menos 32 caracteres'),
  })
  .strict();

export type InterbankPartner = z.infer<typeof partner>;

/**
 * Parses `INTERBANK_PARTNERS`. Absent or blank is an empty registry, not an
 * error: a bank with no partner is still a bank.
 *
 * Throws on anything else that is wrong, and **at start-up** is where it is
 * called: a partner silently dropped would only show up as deposits that never
 * arrive. The message names the entry and the field, never a value — the
 * value holds credentials and start-up errors end up in logs.
 */
export function parseInterbankPartners(raw: string | undefined): readonly InterbankPartner[] {
  if (raw === undefined || raw.trim() === '') return [];

  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('INTERBANK_PARTNERS no es JSON válido.');
  }

  const parsed = z.array(partner).safeParse(json);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? '' : ` (${issue.path.join('.')})`;

    throw new Error(`INTERBANK_PARTNERS inválido${where}: ${issue?.message ?? 'formato'}.`);
  }

  const codes = new Set<string>();
  const inbound = new Set<string>();

  for (const [index, entry] of parsed.data.entries()) {
    if (codes.has(entry.bankCode)) {
      throw new Error(`INTERBANK_PARTNERS repite el banco ${entry.bankCode}.`);
    }
    if (inbound.has(entry.apiKeyInbound)) {
      throw new Error(
        `INTERBANK_PARTNERS (${String(index)}.apiKeyInbound): dos bancos comparten la clave de entrada.`,
      );
    }
    codes.add(entry.bankCode);
    inbound.add(entry.apiKeyInbound);
  }

  return parsed.data;
}
