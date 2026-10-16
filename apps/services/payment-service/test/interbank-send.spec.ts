import {
  applyInterbankSend,
  IllegalInterbankSendTransition,
  isSendSettled,
  settlementOf,
} from '../src/domain/interbank-send';
import type { InterbankSendEvent, InterbankSendState } from '../src/domain/interbank-send';

/**
 * La máquina del depósito que sale hacia el banco pareja.
 *
 * Lo que se prueba aquí no es que los seis estados existan —eso lo diría el
 * tipo— sino las tres cosas que cuestan dinero si están mal: que un `ACCEPTED`
 * no pueda llegar para un depósito que nunca se entregó, que un vencimiento y
 * un rechazo lleven los dos a devolver el dinero sin confundirse entre sí, y
 * que nada se mueva después de un estado final.
 */

const TODOS: readonly InterbankSendState[] = [
  'PENDING',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'TIMEOUT',
  'REVERSED',
];

const EVENTOS: readonly InterbankSendEvent[] = [
  { kind: 'ACKNOWLEDGED' },
  { kind: 'SEND_FAILED', detail: 'ECONNREFUSED' },
  { kind: 'CONFIRMED' },
  { kind: 'REFUSED', reason: 'ACCOUNT_NOT_FOUND' },
  { kind: 'EXPIRED' },
  { kind: 'COMPENSATED' },
];

/** Las transiciones legales, enumeradas. Lo que no está aquí es ilegal. */
const LEGALES: readonly (readonly [InterbankSendState, InterbankSendEvent['kind']])[] = [
  ['PENDING', 'ACKNOWLEDGED'],
  ['PENDING', 'SEND_FAILED'],
  ['PENDING', 'EXPIRED'],
  ['SENT', 'ACKNOWLEDGED'],
  ['SENT', 'CONFIRMED'],
  ['SENT', 'REFUSED'],
  ['SENT', 'EXPIRED'],
  ['REJECTED', 'COMPENSATED'],
  ['TIMEOUT', 'COMPENSATED'],
];

describe('el camino feliz', () => {
  it('pedido, entregado y confirmado cierra el pago como exitoso', () => {
    const enviado = applyInterbankSend('PENDING', { kind: 'ACKNOWLEDGED' });
    expect(enviado.state).toBe('SENT');
    expect(enviado.settle).toBeNull();

    const aceptado = applyInterbankSend(enviado.state, { kind: 'CONFIRMED' });
    expect(aceptado.state).toBe('ACCEPTED');
    expect(aceptado.settle).toBe('SUCCEEDED');
    expect(isSendSettled(aceptado.state)).toBe(true);
  });
});

describe('las dos formas de no cobrar, que no son la misma', () => {
  it('un rechazo lleva el motivo del otro banco y manda compensar', () => {
    const rechazado = applyInterbankSend('SENT', {
      kind: 'REFUSED',
      reason: 'ACCOUNT_INACTIVE',
    });

    expect(rechazado.state).toBe('REJECTED');
    expect(rechazado.reason).toBe('ACCOUNT_INACTIVE');
    expect(rechazado.settle).toBe('FAILED');
  });

  it('un vencimiento manda compensar igual, pero NO se llama rechazo', () => {
    const vencido = applyInterbankSend('SENT', { kind: 'EXPIRED' });

    expect(vencido.state).toBe('TIMEOUT');
    expect(vencido.reason).toBe('CONFIRMATION_TIMEOUT');
    expect(vencido.settle).toBe('FAILED');
  });

  it('vence también sin haber conseguido entregarlo, en vez de retener el saldo para siempre', () => {
    const vencido = applyInterbankSend('PENDING', { kind: 'EXPIRED' });

    expect(vencido.state).toBe('TIMEOUT');
    expect(vencido.settle).toBe('FAILED');
  });

  it('los dos acaban en REVERSED cuando el dinero vuelve, y sólo entonces', () => {
    for (const previo of ['REJECTED', 'TIMEOUT'] as const) {
      const devuelto = applyInterbankSend(previo, { kind: 'COMPENSATED' });

      expect(devuelto.state).toBe('REVERSED');
      expect(devuelto.settle).toBeNull();
      expect(isSendSettled(devuelto.state)).toBe(true);
    }
  });
});

describe('lo que no se puede hacer con el dinero de alguien', () => {
  it('no acepta una confirmación de un depósito que nunca se entregó', () => {
    expect(() => applyInterbankSend('PENDING', { kind: 'CONFIRMED' })).toThrow(
      IllegalInterbankSendTransition,
    );
  });

  it('no mueve un depósito ya aceptado, ni para aceptarlo otra vez', () => {
    for (const evento of EVENTOS) {
      expect(() => applyInterbankSend('ACCEPTED', evento)).toThrow(
        IllegalInterbankSendTransition,
      );
    }
  });

  it('no compensa dos veces: desde REVERSED no hay salida', () => {
    for (const evento of EVENTOS) {
      expect(() => applyInterbankSend('REVERSED', evento)).toThrow(
        IllegalInterbankSendTransition,
      );
    }
  });

  it('no deja que un rechazo se convierta en aceptación', () => {
    expect(() => applyInterbankSend('REJECTED', { kind: 'CONFIRMED' })).toThrow(
      IllegalInterbankSendTransition,
    );
    expect(() => applyInterbankSend('TIMEOUT', { kind: 'CONFIRMED' })).toThrow(
      IllegalInterbankSendTransition,
    );
  });

  it('rechaza TODA combinación que no esté en el diagrama, y acepta todas las que sí', () => {
    const legales = new Set(LEGALES.map(([estado, evento]) => `${estado}:${evento}`));

    for (const estado of TODOS) {
      for (const evento of EVENTOS) {
        const esperadaLegal = legales.has(`${estado}:${evento.kind}`);
        const intento = (): unknown => applyInterbankSend(estado, evento);

        if (esperadaLegal) {
          expect(intento).not.toThrow();
        } else {
          expect(intento).toThrow(IllegalInterbankSendTransition);
        }
      }
    }
  });
});

describe('el reintento de la entrega', () => {
  it('un fallo de entrega no es un rechazo: se queda pendiente y pide reintentar', () => {
    const fallo = applyInterbankSend('PENDING', {
      kind: 'SEND_FAILED',
      detail: 'ECONNREFUSED',
    });

    expect(fallo.state).toBe('PENDING');
    expect(fallo.settle).toBeNull();
    expect(fallo.resend).toBe(true);
    expect(fallo.reason).toBe('ECONNREFUSED');
  });

  it('un 202 repetido deja el depósito donde estaba, sin ser ilegal', () => {
    const otra = applyInterbankSend('SENT', { kind: 'ACKNOWLEDGED' });

    expect(otra.state).toBe('SENT');
    expect(otra.settle).toBeNull();
    expect(otra.resend).toBe(false);
  });
});

/**
 * El veredicto que la Saga tiene que oír, reconstruido desde el estado.
 *
 * Existe para la reconciliación de TD-093, que es el único sitio donde hay que
 * deducir el final desde la fila en vez de desde la transición que lo produjo:
 * el evento original se perdió al publicarlo y no hay nada guardado de donde
 * sacarlo.
 *
 * Los tres nulos son la parte que importa. `PENDING` y `SENT` todavía esperan,
 * y `REVERSED` ya se contó — su veredicto fue el `REJECTED` o el `TIMEOUT` del
 * que viene. Un `REVERSED` que devolviera `FAILED` haría que la reconciliación
 * le pidiera a la Saga un segundo final sobre una transferencia ya compensada.
 */
describe('settlementOf', () => {
  it('traduce los tres veredictos al final que la Saga entiende', () => {
    expect(settlementOf('ACCEPTED')).toBe('SUCCEEDED');
    expect(settlementOf('REJECTED')).toBe('FAILED');
    expect(settlementOf('TIMEOUT')).toBe('FAILED');
  });

  it('no da veredicto de lo que todavía espera', () => {
    expect(settlementOf('PENDING')).toBeNull();
    expect(settlementOf('SENT')).toBeNull();
  });

  it('no da veredicto de un depósito ya compensado', () => {
    expect(settlementOf('REVERSED')).toBeNull();
  });

  it('coincide con lo que la transición habría dicho', () => {
    /*
     * La aserción que mantiene las dos en el mismo sitio. Si la tabla de
     * `applyInterbankSend` y `settlementOf` se separaran, un veredicto
     * reconciliado le contaría a la Saga una historia distinta de la que
     * ocurrió — y nada más lo detectaría.
     */
    expect(settlementOf(applyInterbankSend('SENT', { kind: 'CONFIRMED' }).state)).toBe(
      applyInterbankSend('SENT', { kind: 'CONFIRMED' }).settle,
    );
    expect(
      settlementOf(applyInterbankSend('SENT', { kind: 'REFUSED', reason: 'X' }).state),
    ).toBe(applyInterbankSend('SENT', { kind: 'REFUSED', reason: 'X' }).settle);
    expect(settlementOf(applyInterbankSend('SENT', { kind: 'EXPIRED' }).state)).toBe(
      applyInterbankSend('SENT', { kind: 'EXPIRED' }).settle,
    );
  });
});
