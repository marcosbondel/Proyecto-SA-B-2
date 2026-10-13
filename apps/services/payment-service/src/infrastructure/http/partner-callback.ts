import type { InterbankDeposit, PartnerCallback } from '../../application/interbank.ports';

/** One fixed, configured destination; request payloads never choose an URL. */
export class HttpPartnerCallback implements PartnerCallback {
  constructor(
    readonly endpoint: string,
    readonly token: string,
  ) {}

  async deliver(deposit: InterbankDeposit): Promise<void> {
    if (this.token.length === 0) throw new Error('Interbank partner token is not configured');
    const payload = deposit.origin.payload;
    const response = await fetch(this.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(3_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({
        depositId: deposit.depositId,
        interbankTransferId: payload.interbankTransferId,
        originBankCode: payload.originBankCode,
        destinationBankCode: payload.destinationBankCode,
        status: deposit.stage,
        reason: deposit.reason,
      }),
    });
    if (!response.ok) throw new Error(`Partner callback returned HTTP ${response.status}`);
  }
}
