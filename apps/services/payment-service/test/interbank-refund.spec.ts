import { decideRefund, resolveHeld } from '../src/domain/interbank-refund';
import type { ExpectedRefund } from '../src/domain/interbank-refund';

/**
 * El reembolso de un reverso: la decisión pura (QA 13c).
 *
 * Lo que se juega es que el mismo dinero no llegue dos veces al cliente: ya se
 * le compensó, y el depósito de devolución del banco pareja entra por el camino
 * normal de recepción, dirigido a su cuenta.
 */

const REEMBOLSO = '8f14e45f-ceea-467a-9b36-4b1c2d6a7e01';
const OTRO = '00000000-0000-4000-8000-0000000000ff';

const reverso = (
  state: ExpectedRefund['state'],
  refundTransferId: string | null = null,
): ExpectedRefund => ({ state, refundTransferId });

describe('qué se hace con un depósito entrante frente a un reverso', () => {
  it('sin reverso esperado es un depósito normal', () => {
    expect(decideRefund(REEMBOLSO, null)).toEqual({ kind: 'NORMAL' });
  });

  it.each(['PENDING', 'PROCESSING'] as const)(
    'con el reverso %s se RETIENE: aún no se sabe si es el reembolso',
    (state) => {
      /*
       * Acreditarlo «por si acaso» al cliente duplica su dinero; mandarlo a
       * liquidación «por si acaso» le quita un depósito legítimo. Se acepta (el
       * 202 ya se dio) y no se acredita nada hasta saberlo.
       */
      expect(decideRefund(REEMBOLSO, reverso(state))).toEqual({ kind: 'HOLD' });
    },
  );

  it('con el reverso COMPLETED que nombra este depósito, es el reembolso: a liquidación', () => {
    expect(decideRefund(REEMBOLSO, reverso('COMPLETED', REEMBOLSO))).toEqual({
      kind: 'SETTLE',
      reason: 'MATCHED_BY_ID',
    });
  });

  it('con el reverso COMPLETED que nombra OTRO depósito, éste es un depósito normal', () => {
    expect(decideRefund(REEMBOLSO, reverso('COMPLETED', OTRO))).toEqual({ kind: 'NORMAL' });
  });

  it('con el reverso COMPLETED sin identificador (el pareja incumplió el contrato) prefiere no duplicar', () => {
    expect(decideRefund(REEMBOLSO, reverso('COMPLETED'))).toEqual({
      kind: 'SETTLE',
      reason: 'MATCHED_BY_AMOUNT',
    });
  });

  it('con el reverso FAILED no desvía nada', () => {
    expect(decideRefund(REEMBOLSO, reverso('FAILED'))).toEqual({ kind: 'NORMAL' });
  });
});

describe('cómo se resuelve un depósito retenido', () => {
  it.each(['PENDING', 'PROCESSING'] as const)('sigue esperando mientras el reverso está %s', (state) => {
    expect(resolveHeld(REEMBOLSO, reverso(state))).toEqual({ kind: 'WAIT' });
  });

  it('era el reembolso: se liquida', () => {
    expect(resolveHeld(REEMBOLSO, reverso('COMPLETED', REEMBOLSO))).toEqual({
      kind: 'SETTLE',
      reason: 'MATCHED_BY_ID',
    });
  });

  it('no era el reembolso (el reverso nombra a otro): se libera al cliente', () => {
    expect(resolveHeld(REEMBOLSO, reverso('COMPLETED', OTRO))).toEqual({
      kind: 'RELEASE',
      reason: 'DIFFERENT_REFUND_ID',
    });
  });

  it('el reverso falló: se libera al cliente', () => {
    expect(resolveHeld(REEMBOLSO, reverso('FAILED'))).toEqual({
      kind: 'RELEASE',
      reason: 'REVERSAL_FAILED',
    });
  });

  it('nunca libera ni liquida mientras el reverso no ha terminado', () => {
    for (const state of ['PENDING', 'PROCESSING'] as const) {
      for (const id of [null, REEMBOLSO, OTRO]) {
        expect(resolveHeld(REEMBOLSO, reverso(state, id)).kind).toBe('WAIT');
      }
    }
  });
});
