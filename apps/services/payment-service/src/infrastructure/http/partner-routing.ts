import type { InterbankPartner } from '@bank/contracts';

import type { InterbankDeposit, PartnerCallback } from '../../application/interbank.ports';
import type {
  InterbankSend,
  PartnerBankClient,
  PartnerReversal,
} from '../../application/interbank-send.ports';
import type { PartnerCancel, PartnerProbe } from '../../domain/interbank-timeout';

/**
 * One client per registered bank, picked by bank code (T-60).
 *
 * `HttpPartnerBankClient` and `HttpPartnerCallback` each know one base URL and
 * one key, and that stays true: these only choose which of them handles a
 * deposit. The URL still comes from configuration and never from a message —
 * a code that is not registered has no client, so nothing is called, which is
 * the same answer an unconfigured client gives.
 */
export class RoutingPartnerBankClient implements PartnerBankClient {
  readonly #byBank: ReadonlyMap<string, PartnerBankClient>;

  constructor(byBank: ReadonlyMap<string, PartnerBankClient>) {
    this.#byBank = byBank;
  }

  /** The codes it can reach, for the start-up log. */
  get bankCodes(): readonly string[] {
    return [...this.#byBank.keys()];
  }

  async send(send: InterbankSend): Promise<{ acknowledged: boolean; detail: string | null }> {
    const client = this.#byBank.get(send.destinationBankCode);

    if (client === undefined) {
      return { acknowledged: false, detail: `PARTNER_NOT_REGISTERED:${send.destinationBankCode}` };
    }

    return await client.send(send);
  }

  async probe(send: InterbankSend): Promise<PartnerProbe> {
    return (
      (await this.#byBank.get(send.destinationBankCode)?.probe(send)) ?? { kind: 'UNREACHABLE' }
    );
  }

  async cancel(send: InterbankSend): Promise<PartnerCancel> {
    return (
      (await this.#byBank.get(send.destinationBankCode)?.cancel(send)) ?? { kind: 'UNREACHABLE' }
    );
  }

  async requestReversal(send: InterbankSend, reversalId: string): Promise<PartnerReversal> {
    return (
      (await this.#byBank.get(send.destinationBankCode)?.requestReversal(send, reversalId)) ?? {
        kind: 'UNREACHABLE',
      }
    );
  }

  async reversalStatus(reversalId: string, send?: InterbankSend): Promise<PartnerReversal> {
    const client = send === undefined ? undefined : this.#byBank.get(send.destinationBankCode);

    return (await client?.reversalStatus(reversalId, send)) ?? { kind: 'UNREACHABLE' };
  }
}

/** The result of a deposit goes back to the bank that sent it, whichever it was. */
export class RoutingPartnerCallback implements PartnerCallback {
  readonly #byBank: ReadonlyMap<string, PartnerCallback>;

  constructor(byBank: ReadonlyMap<string, PartnerCallback>) {
    this.#byBank = byBank;
  }

  async deliver(deposit: InterbankDeposit): Promise<void> {
    const callback = this.#byBank.get(deposit.originBankCode);

    if (callback === undefined) {
      // Lanza, como el adaptador sin configurar: el barrido lo reintenta y,
      // si nunca hay ruta, lo abandona en nivel ERROR para conciliarlo a mano.
      throw new Error(`No hay ruta de callback para el banco ${deposit.originBankCode}`);
    }

    await callback.deliver(deposit);
  }
}

/** Where a registered bank listens and the key it issued us. */
export interface PartnerEndpoint {
  readonly baseUrl: string;
  readonly apiKeyOutbound: string;
}

/**
 * Every bank this service can call (T-60): the one in
 * `INTERBANK_PARTNER_BASE_URL` (the mock, until a real partner existed), when
 * set, plus each bank in `INTERBANK_PARTNERS`. A registered bank wins over the
 * legacy variables for the same code.
 *
 * Throws on our own code: a deposit to ourselves is a transfer, and a callback
 * to ourselves would loop.
 */
export function partnerRegistry(input: {
  readonly ownBankCode: string;
  readonly legacy: { readonly bankCode: string } & PartnerEndpoint;
  readonly partners: readonly InterbankPartner[];
}): ReadonlyMap<string, PartnerEndpoint> {
  const registry = new Map<string, PartnerEndpoint>();

  if (input.legacy.baseUrl.length > 0) {
    registry.set(input.legacy.bankCode, {
      baseUrl: input.legacy.baseUrl,
      apiKeyOutbound: input.legacy.apiKeyOutbound,
    });
  }

  for (const partner of input.partners) {
    registry.set(partner.bankCode, {
      baseUrl: partner.baseUrl,
      apiKeyOutbound: partner.apiKeyOutbound,
    });
  }

  if (registry.has(input.ownBankCode)) {
    throw new Error(
      `El registro interbancario incluye nuestro propio código (${input.ownBankCode}).`,
    );
  }

  return registry;
}
