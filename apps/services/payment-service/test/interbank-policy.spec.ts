import { validateIncoming } from '../src/domain/interbank';

const policy = {
  bankCode: 'BANK_USAC',
  partnerBankCode: 'PARTNER_MOCK',
  maxAmountMinor: 100_000_000,
};
const request = {
  originBankCode: 'PARTNER_MOCK',
  destinationBankCode: 'BANK_USAC',
  amount: { amountMinor: 12500, currency: 'GTQ' },
};

describe('provisional interbank deposit policy', () => {
  it.each([
    ['valid deposit', request, null],
    ['one centavo', { ...request, amount: { amountMinor: 1, currency: 'GTQ' } }, null],
    [
      'exact configured limit',
      { ...request, amount: { amountMinor: 100_000_000, currency: 'GTQ' } },
      null,
    ],
    ['zero', { ...request, amount: { amountMinor: 0, currency: 'GTQ' } }, 'INVALID_REQUEST'],
    [
      'negative amount',
      { ...request, amount: { amountMinor: -1, currency: 'GTQ' } },
      'INVALID_REQUEST',
    ],
    [
      'one centavo over limit',
      { ...request, amount: { amountMinor: 100_000_001, currency: 'GTQ' } },
      'AMOUNT_EXCEEDS_LIMIT',
    ],
    [
      'fractional centavo',
      { ...request, amount: { amountMinor: 1.5, currency: 'GTQ' } },
      'INVALID_REQUEST',
    ],
    [
      'unsafe integer',
      { ...request, amount: { amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: 'GTQ' } },
      'INVALID_REQUEST',
    ],
    ['unknown origin', { ...request, originBankCode: 'UNKNOWN' }, 'BANK_NOT_AUTHORIZED'],
    ['lowercase origin', { ...request, originBankCode: 'partner_mock' }, 'BANK_NOT_AUTHORIZED'],
    [
      'wrong destination',
      { ...request, destinationBankCode: 'OTHER_BANK' },
      'WRONG_DESTINATION_BANK',
    ],
    [
      'lowercase destination',
      { ...request, destinationBankCode: 'bank_usac' },
      'WRONG_DESTINATION_BANK',
    ],
    [
      'USD',
      { ...request, amount: { amountMinor: 12500, currency: 'USD' } },
      'UNSUPPORTED_CURRENCY',
    ],
    [
      'untrusted bank cannot probe currency',
      { ...request, originBankCode: 'UNKNOWN', amount: { amountMinor: 12500, currency: 'USD' } },
      'BANK_NOT_AUTHORIZED',
    ],
  ] as const)('%s', (_name, input, expected) => {
    expect(validateIncoming(input, policy)).toBe(expected);
  });
});
