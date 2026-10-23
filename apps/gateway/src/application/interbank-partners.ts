import type { InterbankPartner } from '@bank/contracts';

/**
 * Every bank this Gateway talks to under the interbank contract (T-60): the
 * one in `INTERBANK_PARTNER_BANK_CODE` (the mock, until a real partner existed)
 * plus each bank in `INTERBANK_PARTNERS`.
 *
 * Two answers come out of it. The API key that identifies each caller, which
 * `InterbankApiKeyGuard` already knew how to read for several banks; and the
 * codes a customer may send a deposit to, which used to be exactly one. With
 * both derived from the same list, a bank is either fully reachable or not
 * reachable at all.
 *
 * Throws at start-up on a registry that cannot work: our own code as a partner,
 * or two banks presenting the same key — the guard could not tell them apart,
 * and the second one's deposits would be rejected as impersonation.
 */
export function interbankRegistry(input: {
  readonly ownBankCode: string;
  readonly legacyBankCode: string;
  readonly legacyInboundKey: string | undefined;
  readonly partners: readonly InterbankPartner[];
}): {
  readonly apiKeys: Readonly<Record<string, string>>;
  readonly partnerCodes: readonly string[];
} {
  const apiKeys: Record<string, string> = {};

  if (input.legacyInboundKey !== undefined && input.legacyInboundKey.length > 0) {
    apiKeys[input.legacyBankCode] = input.legacyInboundKey;
  }

  for (const partner of input.partners) {
    if (partner.bankCode === input.ownBankCode) {
      throw new Error(`INTERBANK_PARTNERS incluye nuestro propio código (${partner.bankCode}).`);
    }
    // A registered bank wins over the legacy variable for the same code.
    apiKeys[partner.bankCode] = partner.apiKeyInbound;
  }

  const owners = new Map<string, string>();

  for (const [bankCode, key] of Object.entries(apiKeys)) {
    const other = owners.get(key);

    if (other !== undefined) {
      throw new Error(`${other} y ${bankCode} comparten la API key de entrada.`);
    }
    owners.set(key, bankCode);
  }

  const partnerCodes = [
    ...new Set([input.legacyBankCode, ...input.partners.map((partner) => partner.bankCode)]),
  ];

  return { apiKeys, partnerCodes };
}
