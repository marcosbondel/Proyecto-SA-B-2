import {
  applyInterbankReceipt,
  couldBeOurAccount,
  IllegalInterbankReceiptTransition,
  isReceiptDecided,
} from '../src/domain/interbank-receipt';
import type { InterbankReceiptEvent, InterbankReceiptState } from '../src/domain/interbank-receipt';

/**
 * La máquina del depósito **recibido** (T-56).
 *
 * Hasta este ticket estas transiciones eran diez ternarios repartidos por el
 * caso de uso, y lo que no se podía probar era precisamente lo que importa:
 * qué pasa cuando un mensaje llega **fuera de orden**. Un `CREDITED` para un
 * depósito que nunca ordenó el crédito, o una elegibilidad para uno ya
 * decidido, son los dos caminos por los que un depósito recibido se acreditaría
 * dos veces — y acreditar dos veces es el 50 % que §8.3 penaliza.
 */

const TODOS: readonly InterbankReceiptState[] = ['ELIGIBILITY', 'CREDIT', 'ACCEPTED', 'REJECTED'];

const elegible: InterbankReceiptEvent = { kind: 'ELIGIBILITY_ANSWERED', rejection: null };
const inelegible: InterbankReceiptEvent = {
  kind: 'ELIGIBILITY_ANSWERED',
  rejection: 'ACCOUNT_INACTIVE',
};
const acreditado: InterbankReceiptEvent = { kind: 'CREDITED' };
const rehusado: InterbankReceiptEvent = { kind: 'CREDIT_REFUSED', rejection: 'ACCOUNT_NOT_FOUND' };

describe('el camino que acredita', () => {
  it('va de ELIGIBILITY a CREDIT cuando la cuenta admite el dinero', () => {
    const paso = applyInterbankReceipt('ELIGIBILITY', elegible);

    expect(paso).toEqual({
      from: 'ELIGIBILITY',
      state: 'CREDIT',
      rejection: null,
      // Todavía no hay nada que contarle al banco pareja: el saldo no se movió.
      decided: false,
    });
  });

  it('va de CREDIT a ACCEPTED cuando Account confirma el saldo', () => {
    const paso = applyInterbankReceipt('CREDIT', acreditado);

    expect(paso).toEqual({ from: 'CREDIT', state: 'ACCEPTED', rejection: null, decided: true });
  });
});

describe('los dos caminos que rechazan', () => {
  it('rechaza en ELIGIBILITY con el motivo que dio Account', () => {
    const paso = applyInterbankReceipt('ELIGIBILITY', inelegible);

    expect(paso).toEqual({
      from: 'ELIGIBILITY',
      state: 'REJECTED',
      rejection: 'ACCOUNT_INACTIVE',
      decided: true,
    });
  });

  it('rechaza en CREDIT si el crédito no se pudo aplicar', () => {
    const paso = applyInterbankReceipt('CREDIT', rehusado);

    expect(paso.state).toBe('REJECTED');
    expect(paso.rejection).toBe('ACCOUNT_NOT_FOUND');
    expect(paso.decided).toBe(true);
  });
});

describe('un depósito ya decidido no se mueve', () => {
  const eventos = [elegible, inelegible, acreditado, rehusado];

  it.each(['ACCEPTED', 'REJECTED'] as const)('%s rechaza cualquier evento', (desde) => {
    for (const evento of eventos) {
      expect(() => applyInterbankReceipt(desde, evento)).toThrow(
        IllegalInterbankReceiptTransition,
      );
    }
  });

  it('y la razón es el dinero: un segundo paso sobre ACCEPTED sería un segundo crédito', () => {
    expect(() => applyInterbankReceipt('ACCEPTED', acreditado)).toThrow(
      /No hay transición de ACCEPTED con CREDITED/,
    );
  });
});

describe('un mensaje fuera de orden no avanza nada', () => {
  it('un crédito confirmado que nadie ordenó se rechaza', () => {
    expect(() => applyInterbankReceipt('ELIGIBILITY', acreditado)).toThrow(
      IllegalInterbankReceiptTransition,
    );
  });

  it('una elegibilidad duplicada no vuelve a ordenar el crédito', () => {
    // Desde CREDIT el crédito ya se ordenó; repetir el paso lo ordenaría otra vez.
    expect(() => applyInterbankReceipt('CREDIT', elegible)).toThrow(
      IllegalInterbankReceiptTransition,
    );
  });

  it('el error dice de dónde y con qué, que es lo que va al log', () => {
    try {
      applyInterbankReceipt('CREDIT', elegible);
      throw new Error('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalInterbankReceiptTransition);
      const ilegal = error as IllegalInterbankReceiptTransition;
      expect(ilegal.from).toBe('CREDIT');
      expect(ilegal.event).toBe('ELIGIBILITY_ANSWERED');
    }
  });
});

describe('ninguna transición cae en ELIGIBILITY', () => {
  it('porque ahí se empieza, no se llega', () => {
    const aterrizajes: string[] = [];

    for (const desde of TODOS) {
      for (const evento of [elegible, inelegible, acreditado, rehusado]) {
        try {
          aterrizajes.push(applyInterbankReceipt(desde, evento).state);
        } catch {
          // Las ilegales se prueban aparte; aquí sólo importa dónde se cae.
        }
      }
    }

    expect(aterrizajes.length).toBeGreaterThan(0);
    expect(aterrizajes).not.toContain('ELIGIBILITY');
  });
});

describe('isReceiptDecided', () => {
  it('sólo los dos finales', () => {
    expect(TODOS.filter(isReceiptDecided)).toEqual(['ACCEPTED', 'REJECTED']);
  });
});

describe('couldBeOurAccount', () => {
  it('acepta un UUID v4, que es como se identifica una cuenta de este banco', () => {
    expect(couldBeOurAccount('b0000000-0000-4000-8000-000000000003')).toBe(true);
    expect(couldBeOurAccount('B0000000-0000-4000-8000-000000000003')).toBe(true);
  });

  it('rechaza lo que un banco de verdad mandaría como número de cuenta', () => {
    // Y ése es el caso que importa: no da un 400, da un ACCOUNT_NOT_FOUND con
    // callback, que es lo que el otro banco puede entender y registrar.
    expect(couldBeOurAccount('001-2345-6')).toBe(false);
    expect(couldBeOurAccount('12345678901')).toBe(false);
  });

  it('rechaza un UUID que no es v4 y una cadena vacía', () => {
    expect(couldBeOurAccount('b0000000-0000-1000-8000-000000000003')).toBe(false);
    expect(couldBeOurAccount('')).toBe(false);
  });
});
