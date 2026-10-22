import { interbankRegistry } from '../src/application/interbank-partners';

const KEY_MOCK = 'm'.repeat(40);
const KEY_13 = 'a'.repeat(40);
const KEY_16 = 'b'.repeat(40);

const partner = (bankCode: string, apiKeyInbound: string) => ({
  bankCode,
  baseUrl: `https://${bankCode.toLowerCase()}.example/interbank/v1`,
  apiKeyOutbound: 'their-key',
  apiKeyInbound,
});

/**
 * The registry the Gateway builds at start-up (T-60): which key identifies
 * which bank, and which banks a customer may send to.
 */
describe('interbankRegistry', () => {
  it('with only the legacy partner, behaves as before', () => {
    expect(
      interbankRegistry({
        ownBankCode: 'BANK02',
        legacyBankCode: 'BANK99',
        legacyInboundKey: KEY_MOCK,
        partners: [],
      }),
    ).toEqual({ apiKeys: { BANK99: KEY_MOCK }, partnerCodes: ['BANK99'] });
  });

  it('adds every registered bank, each with its own key', () => {
    const registry = interbankRegistry({
      ownBankCode: 'BANK02',
      legacyBankCode: 'BANK99',
      legacyInboundKey: KEY_MOCK,
      partners: [partner('BANK13', KEY_13), partner('BANK16', KEY_16)],
    });

    expect(registry.apiKeys).toEqual({ BANK99: KEY_MOCK, BANK13: KEY_13, BANK16: KEY_16 });
    expect(registry.partnerCodes).toEqual(['BANK99', 'BANK13', 'BANK16']);
  });

  it('keeps the legacy code sendable even without an inbound key', () => {
    const registry = interbankRegistry({
      ownBankCode: 'BANK02',
      legacyBankCode: 'BANK99',
      legacyInboundKey: undefined,
      partners: [partner('BANK13', KEY_13)],
    });

    expect(registry.apiKeys).toEqual({ BANK13: KEY_13 });
    expect(registry.partnerCodes).toEqual(['BANK99', 'BANK13']);
  });

  it('lets a registered bank replace the legacy one under the same code', () => {
    const registry = interbankRegistry({
      ownBankCode: 'BANK02',
      legacyBankCode: 'BANK13',
      legacyInboundKey: KEY_MOCK,
      partners: [partner('BANK13', KEY_13)],
    });

    expect(registry.apiKeys).toEqual({ BANK13: KEY_13 });
    expect(registry.partnerCodes).toEqual(['BANK13']);
  });

  it('refuses our own code as a partner', () => {
    expect(() =>
      interbankRegistry({
        ownBankCode: 'BANK02',
        legacyBankCode: 'BANK99',
        legacyInboundKey: KEY_MOCK,
        partners: [partner('BANK02', KEY_13)],
      }),
    ).toThrow('propio código');
  });

  it('refuses a registered bank reusing the legacy key, which would make them indistinguishable', () => {
    expect(() =>
      interbankRegistry({
        ownBankCode: 'BANK02',
        legacyBankCode: 'BANK99',
        legacyInboundKey: KEY_MOCK,
        partners: [partner('BANK13', KEY_MOCK)],
      }),
    ).toThrow('comparten la API key');
  });
});
