import { parseInterbankPartners } from '../../src/config/interbank-partners';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

function bank(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bankCode: 'BANK13',
    baseUrl: 'https://bank13.example/interbank/v1',
    apiKeyOutbound: 'their-key',
    apiKeyInbound: KEY_A,
    ...overrides,
  };
}

describe('parseInterbankPartners', () => {
  it('reads an absent or blank value as no partners', () => {
    expect(parseInterbankPartners(undefined)).toEqual([]);
    expect(parseInterbankPartners('')).toEqual([]);
    expect(parseInterbankPartners('   ')).toEqual([]);
  });

  it('reads several banks, dropping a trailing slash from the base URL', () => {
    const partners = parseInterbankPartners(
      JSON.stringify([
        bank({ baseUrl: 'https://bank13.example/interbank/v1/' }),
        bank({
          bankCode: 'BANK16',
          baseUrl: 'http://10.0.0.1:3000/interbank/v1',
          apiKeyInbound: KEY_B,
        }),
      ]),
    );

    expect(partners.map((p) => p.bankCode)).toEqual(['BANK13', 'BANK16']);
    expect(partners[0]?.baseUrl).toBe('https://bank13.example/interbank/v1');
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseInterbankPartners('{nope')).toThrow('no es JSON válido');
  });

  it('rejects an object instead of a list', () => {
    expect(() => parseInterbankPartners(JSON.stringify(bank()))).toThrow(
      'INTERBANK_PARTNERS inválido',
    );
  });

  it.each([
    ['a bank code outside the contract', { bankCode: 'bank13' }, 'bankCode'],
    ['a relative base URL', { baseUrl: '/interbank/v1' }, 'baseUrl'],
    ['an empty outbound key', { apiKeyOutbound: '' }, 'apiKeyOutbound'],
    ['a short inbound key', { apiKeyInbound: 'short' }, 'apiKeyInbound'],
    ['a field nobody reads', { callbackUrl: 'https://x' }, ''],
  ])('rejects %s', (_label, overrides, field) => {
    expect(() => parseInterbankPartners(JSON.stringify([bank(overrides)]))).toThrow(field);
  });

  it('rejects the same bank twice', () => {
    expect(() =>
      parseInterbankPartners(JSON.stringify([bank(), bank({ apiKeyInbound: KEY_B })])),
    ).toThrow('repite el banco BANK13');
  });

  it('rejects two banks sharing an inbound key, which would make them indistinguishable', () => {
    expect(() =>
      parseInterbankPartners(JSON.stringify([bank(), bank({ bankCode: 'BANK16' })])),
    ).toThrow('comparten la clave de entrada');
  });

  it('never puts a key in the error message', () => {
    try {
      parseInterbankPartners(
        JSON.stringify([bank({ bankCode: 'X', apiKeyOutbound: 'secret-value' })]),
      );
    } catch (error) {
      expect(String(error)).not.toContain('secret-value');
      expect(String(error)).not.toContain(KEY_A);
    }
  });
});
