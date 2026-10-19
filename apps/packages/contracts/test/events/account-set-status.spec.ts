import { accountSetStatusV1 } from '../../src/events/account/account.set-status.v1';

/**
 * `account.set-status.v1`: el motivo se exige sólo al desactivar (T-60, QA 21).
 */

const ACCOUNT = '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60';
const parse = (payload: unknown): boolean => accountSetStatusV1.schema.safeParse(payload).success;

describe('account.set-status.v1', () => {
  it('desactivar exige un motivo', () => {
    expect(parse({ accountId: ACCOUNT, status: 'INACTIVE' })).toBe(false);
    expect(parse({ accountId: ACCOUNT, status: 'INACTIVE', reason: 'Solicitud del titular' })).toBe(true);
  });

  it('activar no lo exige', () => {
    expect(parse({ accountId: ACCOUNT, status: 'ACTIVE' })).toBe(true);
  });

  it('es retrocompatible: lo que se validaba antes se sigue validando', () => {
    for (const status of ['ACTIVE', 'INACTIVE']) {
      expect(parse({ accountId: ACCOUNT, status, reason: 'un motivo' })).toBe(true);
    }
  });

  it('un motivo presente sigue estando acotado, también al activar', () => {
    expect(parse({ accountId: ACCOUNT, status: 'ACTIVE', reason: '' })).toBe(false);
    expect(parse({ accountId: ACCOUNT, status: 'ACTIVE', reason: 'x'.repeat(301) })).toBe(false);
    expect(parse({ accountId: ACCOUNT, status: 'ACTIVE', reason: 'x'.repeat(300) })).toBe(true);
  });

  it('la cuenta y el estado siguen siendo obligatorios', () => {
    expect(parse({ status: 'ACTIVE' })).toBe(false);
    expect(parse({ accountId: ACCOUNT })).toBe(false);
    expect(parse({ accountId: ACCOUNT, status: 'CERRADA' })).toBe(false);
  });
});
