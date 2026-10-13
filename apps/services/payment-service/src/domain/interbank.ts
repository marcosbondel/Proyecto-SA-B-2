/** The provisional partner policy, kept pure so amount and bank limits are explicit. */
export type InterbankRejection =
  | 'AMOUNT_EXCEEDS_LIMIT'
  | 'UNSUPPORTED_CURRENCY'
  | 'WRONG_DESTINATION_BANK'
  | 'BANK_NOT_AUTHORIZED'
  | 'INVALID_REQUEST';

export function validateIncoming(
  request: {
    originBankCode: string;
    destinationBankCode: string;
    amount: { amountMinor: number; currency: string };
  },
  policy: { bankCode: string; partnerBankCode: string; maxAmountMinor: number },
): InterbankRejection | null {
  if (request.originBankCode !== policy.partnerBankCode) return 'BANK_NOT_AUTHORIZED';
  if (request.destinationBankCode !== policy.bankCode) return 'WRONG_DESTINATION_BANK';
  if (request.amount.currency !== 'GTQ') return 'UNSUPPORTED_CURRENCY';
  if (!Number.isSafeInteger(request.amount.amountMinor) || request.amount.amountMinor <= 0)
    return 'INVALID_REQUEST';
  if (request.amount.amountMinor > policy.maxAmountMinor) return 'AMOUNT_EXCEEDS_LIMIT';
  return null;
}
