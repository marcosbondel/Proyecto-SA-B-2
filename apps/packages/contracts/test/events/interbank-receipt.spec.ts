import { catalogByName } from '../../src/events';
import {
  interbankDepositRequest,
  interbankMinorUnits,
} from '../../src/events/interbank/incoming.v1';

const DEPOSIT_ID = '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60';
const ACCOUNT_ID = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';

describe('the provisional incoming interbank conversation', () => {
  it('has one receiver, an account eligibility reply, a credit verdict and an audit outcome', () => {
    const expected = [
      ['payment.interbank.receive.v1', 'command', 'gateway', 'payment-service'],
      ['account.interbank.eligibility.query.v1', 'command', 'payment-service', 'account-service'],
      ['account.interbank.eligibility.replied.v1', 'reply', 'account-service', 'payment-service'],
      ['account.interbank.credit.requested.v1', 'command', 'payment-service', 'account-service'],
      ['account.interbank.credited.v1', 'event', 'account-service', 'payment-service'],
      ['account.interbank.credit.rejected.v1', 'event', 'account-service', 'payment-service'],
      ['payment.interbank.accepted.v1', 'event', 'payment-service', 'notification-audit-service'],
      ['payment.interbank.rejected.v1', 'event', 'payment-service', 'notification-audit-service'],
    ] as const;

    for (const [name, category, producer, consumer] of expected) {
      const contract = catalogByName.get(name);

      expect(contract).toMatchObject({ name, category, producer });
      expect(contract?.consumers).toContain(consumer);
    }
  });

  it('accepts an ISO currency for a business verdict but refuses fractional minor units', () => {
    const receive = catalogByName.get('payment.interbank.receive.v1');
    const valid = {
      depositId: DEPOSIT_ID,
      interbankTransferId: 'BANCO-A-123',
      idempotencyKey: 'origin-123',
      originBankCode: 'BANCO_A',
      destinationBankCode: 'BANK_USAC',
      accountId: ACCOUNT_ID,
      amount: { amountMinor: 101, currency: 'GTQ' },
      // Los dos sellos de tiempo, desde T-56: el del otro banco y el nuestro.
      partnerTimestamp: '2026-10-12T11:59:58.000Z',
      requestedAt: '2026-10-12T12:00:00.000Z',
    };

    expect(receive?.schema.safeParse(valid).success).toBe(true);
    expect(
      receive?.schema.safeParse({ ...valid, amount: { amountMinor: 101, currency: 'USD' } })
        .success,
    ).toBe(true);
    expect(
      receive?.schema.safeParse({ ...valid, amount: { amountMinor: 1.5, currency: 'GTQ' } })
        .success,
    ).toBe(false);
  });

  it('requires a rejection reason when account eligibility is false', () => {
    const replied = catalogByName.get('account.interbank.eligibility.replied.v1');
    const base = { depositId: DEPOSIT_ID, accountId: ACCOUNT_ID };

    expect(
      replied?.schema.safeParse({ ...base, eligible: false, reason: 'ACCOUNT_INACTIVE' }).success,
    ).toBe(true);
    expect(replied?.schema.safeParse({ ...base, eligible: false, reason: null }).success).toBe(
      false,
    );
    expect(replied?.schema.safeParse({ ...base, eligible: true, reason: null }).success).toBe(true);
  });
});

/**
 * El cuerpo que manda el banco pareja, y la conversión del monto (T-56).
 *
 * Son el borde del sistema: lo único que separa «interopera en el primer
 * intento» de «devuelve un 400 que el otro equipo tiene que adivinar».
 */
describe('interbankDepositRequest', () => {
  const base = {
    interbankTransferId: 'partner-1',
    idempotencyKey: 'partner-1',
    originBankCode: 'PARTNER_MOCK',
    destinationBankCode: 'BANK_USAC',
    accountId: 'b0000000-0000-4000-8000-000000000003',
    timestamp: '2026-10-15T12:00:00.000Z',
  };

  it('exige el timestamp, que es lo que §4.1 pide y antes de T-56 se rechazaba', () => {
    const { timestamp: _, ...sinSello } = base;

    expect(
      interbankDepositRequest.safeParse({
        ...sinSello,
        amount: { amountMinor: 12500, currency: 'GTQ' },
      }).success,
    ).toBe(false);
  });

  it('acepta el monto en centavos, que es el formato nuestro', () => {
    const parsed = interbankDepositRequest.parse({
      ...base,
      amount: { amountMinor: 12500, currency: 'GTQ' },
    });

    expect(parsed.amount).toEqual({ amountMinor: 12500, currency: 'GTQ' });
  });

  it('acepta el monto decimal, que es el formato de un banco que piensa en quetzales', () => {
    const texto = interbankDepositRequest.parse({
      ...base,
      amount: { value: '125.00', currency: 'GTQ' },
    });
    const numero = interbankDepositRequest.parse({
      ...base,
      amount: { value: 125, currency: 'GTQ' },
    });

    expect('value' in texto.amount).toBe(true);
    expect('value' in numero.amount).toBe(true);
  });

  it('acepta una cuenta que no es un UUID, para poder rechazarla con un motivo', () => {
    // Un 400 deja al otro banco esperando sin saber por qué; un
    // ACCOUNT_NOT_FOUND con callback es interoperable.
    expect(
      interbankDepositRequest.safeParse({
        ...base,
        accountId: '001-2345-6',
        amount: { amountMinor: 1, currency: 'GTQ' },
      }).success,
    ).toBe(true);
  });

  it('sigue rechazando un campo que nadie acordó', () => {
    expect(
      interbankDepositRequest.safeParse({
        ...base,
        amount: { amountMinor: 1, currency: 'GTQ' },
        sorpresa: true,
      }).success,
    ).toBe(false);
  });
});

describe('interbankMinorUnits', () => {
  it('convierte sin que un float toque el dinero', () => {
    // `1.15 * 100` es 114.99999999999999 en coma flotante. Esto da 115.
    expect(interbankMinorUnits('1.15')).toBe(115);
    expect(interbankMinorUnits('125.00')).toBe(12500);
    expect(interbankMinorUnits('0.01')).toBe(1);
    expect(interbankMinorUnits('7')).toBe(700);
    expect(interbankMinorUnits('125.5')).toBe(12550);
    expect(interbankMinorUnits(125)).toBe(12500);
    expect(interbankMinorUnits(' 99.99 ')).toBe(9999);
  });

  it('devuelve null en vez de adivinar', () => {
    expect(interbankMinorUnits('125.456')).toBeNull();
    expect(interbankMinorUnits('abc')).toBeNull();
    expect(interbankMinorUnits('')).toBeNull();
    expect(interbankMinorUnits('1e3')).toBeNull();
    expect(interbankMinorUnits('125,00')).toBeNull();
  });

  it('conserva el signo, y que un negativo se rechace es del dominio', () => {
    // El esquema no decide si un monto negativo es válido: lo decide
    // `validateIncoming`, que devuelve INVALID_REQUEST con su callback.
    expect(interbankMinorUnits('-5.00')).toBe(-500);
  });
});
