import {
  applyInterbankReceipt,
  couldBeOurAccount,
  IllegalInterbankReceiptTransition,
  isReceiptDecided,
  v1ReasonOf,
  v1StateOf,
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

const TODOS: readonly InterbankReceiptState[] = [
  'ELIGIBILITY',
  'CREDIT',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
];

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

  it.each(['ACCEPTED', 'REJECTED', 'CANCELLED'] as const)(
    '%s rechaza cualquier evento',
    (desde) => {
      for (const evento of eventos) {
        expect(() => applyInterbankReceipt(desde, evento)).toThrow(
          IllegalInterbankReceiptTransition,
        );
      }
    },
  );

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
  it('sólo los finales, que con el contrato son tres', () => {
    expect(TODOS.filter(isReceiptDecided)).toEqual(['ACCEPTED', 'REJECTED', 'CANCELLED']);
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

/**
 * Lo que el contrato oficial añadió a esta máquina (T-56).
 */
describe('CANCELLED, que el contrato trajo y no teníamos', () => {
  it('se puede cancelar mientras la orden de crédito no se ha dado', () => {
    const paso = applyInterbankReceipt('ELIGIBILITY', { kind: 'CANCEL_REQUESTED' });

    expect(paso.state).toBe('CANCELLED');
    expect(paso.rejection).toBe('CANCELLED');
    expect(paso.decided).toBe(true);
  });

  it('NO se puede cancelar una vez ordenado el crédito: Account acredita sin condiciones (B4)', () => {
    /*
     * El doble crédito de T-60. Cancelado desde `CREDIT`, el cliente quedaba
     * acreditado, el emisor liberaba su reserva, y el `CREDITED` posterior se
     * descartaba como transición ilegal: dinero creado de la nada.
     */
    expect(() => applyInterbankReceipt('CREDIT', { kind: 'CANCEL_REQUESTED' })).toThrow(
      IllegalInterbankReceiptTransition,
    );
  });

  it('no se puede cancelar lo ya acreditado: eso se contesta ALREADY_ACCEPTED', () => {
    expect(() => applyInterbankReceipt('ACCEPTED', { kind: 'CANCEL_REQUESTED' })).toThrow(
      IllegalInterbankReceiptTransition,
    );
  });

  it('una confirmación de crédito que llega después de cancelar no lo reabre', () => {
    // El caso delicado: se canceló desde CREDIT con la confirmación en vuelo.
    // El contrato pide que el receptor «guarde el id y rechace cualquier
    // llegada posterior»; aquí eso es que la transición sea ilegal.
    expect(() => applyInterbankReceipt('CANCELLED', { kind: 'CREDITED' })).toThrow(
      IllegalInterbankReceiptTransition,
    );
  });

  it('cuenta como decidido, así que el estado ya no se mueve', () => {
    expect(isReceiptDecided('CANCELLED')).toBe(true);
  });
});

describe('EXPIRED: el contrato prohíbe acreditar después del plazo', () => {
  it('vence sólo mientras no se ha ordenado el crédito, con su motivo propio', () => {
    const paso = applyInterbankReceipt('ELIGIBILITY', { kind: 'EXPIRED' });

    expect(paso.state).toBe('REJECTED');
    expect(paso.rejection).toBe('EXPIRED');
  });

  it('NO vence una vez ordenado el crédito: espera el veredicto de Account (B4)', () => {
    expect(() => applyInterbankReceipt('CREDIT', { kind: 'EXPIRED' })).toThrow(
      IllegalInterbankReceiptTransition,
    );
  });

  it('la elegibilidad contestada después del plazo no ordena el crédito: se rechaza con EXPIRED', () => {
    // La puerta que sustituye a la de vencer desde CREDIT: se cierra antes de entrar.
    const paso = applyInterbankReceipt('ELIGIBILITY', {
      kind: 'ELIGIBILITY_ANSWERED',
      rejection: 'EXPIRED',
    });

    expect(paso.state).toBe('REJECTED');
    expect(paso.rejection).toBe('EXPIRED');
  });

  /**
   * La matriz completa de transiciones del depósito recibido, enumerada (B4): lo
   * que no está en esta tabla es ilegal. Es la prueba que habría atrapado el
   * doble crédito, porque `CREDIT × (CANCEL_REQUESTED | EXPIRED)` figuraba como
   * legal y nadie lo discutía.
   */
  it('acepta exactamente las combinaciones del diagrama y ninguna más', () => {
    const estados = ['ELIGIBILITY', 'CREDIT', 'ACCEPTED', 'REJECTED', 'CANCELLED'] as const;
    const eventos = [
      { kind: 'ELIGIBILITY_ANSWERED', rejection: null },
      { kind: 'ELIGIBILITY_ANSWERED', rejection: 'ACCOUNT_NOT_FOUND' },
      { kind: 'CREDITED' },
      { kind: 'CREDIT_REFUSED', rejection: 'ACCOUNT_INACTIVE' },
      { kind: 'CANCEL_REQUESTED' },
      { kind: 'EXPIRED' },
    ] as const;
    const legales = new Set([
      'ELIGIBILITY:ELIGIBILITY_ANSWERED',
      'CREDIT:CREDITED',
      'CREDIT:CREDIT_REFUSED',
      'ELIGIBILITY:CANCEL_REQUESTED',
      'ELIGIBILITY:EXPIRED',
    ]);

    for (const estado of estados) {
      for (const evento of eventos) {
        const intento = (): unknown => applyInterbankReceipt(estado, evento);

        if (legales.has(`${estado}:${evento.kind}`)) {
          expect(intento).not.toThrow();
        } else {
          expect(intento).toThrow(IllegalInterbankReceiptTransition);
        }
      }
    }
  });

  it('no vence lo ya acreditado: ahí el plazo ya no decide nada', () => {
    expect(() => applyInterbankReceipt('ACCEPTED', { kind: 'EXPIRED' })).toThrow(
      IllegalInterbankReceiptTransition,
    );
  });
});

describe('la traducción a los estados del contrato', () => {
  it('colapsa nuestros dos pasos de decisión en PROCESSING', () => {
    // Que tengamos dos y él vea uno no es pérdida de información: el reparto
    // interno del trabajo no es asunto suyo.
    expect(v1StateOf('ELIGIBILITY')).toBe('PROCESSING');
    expect(v1StateOf('CREDIT')).toBe('PROCESSING');
  });

  it('deja los tres finales como están', () => {
    expect(v1StateOf('ACCEPTED')).toBe('ACCEPTED');
    expect(v1StateOf('REJECTED')).toBe('REJECTED');
    expect(v1StateOf('CANCELLED')).toBe('CANCELLED');
  });
});

describe('la traducción de los motivos a los siete del contrato', () => {
  it('renombra los dos que sólo cambian de nombre', () => {
    expect(v1ReasonOf('AMOUNT_EXCEEDS_LIMIT')).toBe('AMOUNT_LIMIT_EXCEEDED');
    expect(v1ReasonOf('UNSUPPORTED_CURRENCY')).toBe('CURRENCY_NOT_SUPPORTED');
  });

  it('manda a PROCESSING_ERROR los tres que en el contrato son códigos HTTP', () => {
    // Un banco no autorizado recibe un 401, no un callback explicándoselo; si
    // uno de estos llegara hasta aquí sería un error nuestro, y el motivo no
    // debe insinuar que el otro banco hizo algo mal.
    expect(v1ReasonOf('BANK_NOT_AUTHORIZED')).toBe('PROCESSING_ERROR');
    expect(v1ReasonOf('IDEMPOTENCY_CONFLICT')).toBe('PROCESSING_ERROR');
    expect(v1ReasonOf('WRONG_DESTINATION_BANK')).toBe('PROCESSING_ERROR');
    expect(v1ReasonOf('INVALID_REQUEST')).toBe('PROCESSING_ERROR');
  });

  it('conserva los cuatro que ya coincidían', () => {
    expect(v1ReasonOf('ACCOUNT_NOT_FOUND')).toBe('ACCOUNT_NOT_FOUND');
    expect(v1ReasonOf('ACCOUNT_INACTIVE')).toBe('ACCOUNT_INACTIVE');
    expect(v1ReasonOf('EXPIRED')).toBe('EXPIRED');
    expect(v1ReasonOf('CANCELLED')).toBe('CANCELLED');
  });
});
