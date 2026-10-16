import {
  resolveTimeout,
  timeoutSchedule,
  type PartnerCancel,
  type PartnerProbe,
  type TimeoutFacts,
} from '../src/domain/interbank-timeout';

/**
 * El protocolo de TIMEOUT del emisor (TD-095).
 *
 * Lo que se prueba aquí es **cuándo se puede devolver el dinero del cliente**,
 * que es la única pregunta que este archivo contesta. El defecto que cubre no
 * era un error de código sino de plazo: 30 s nuestros contra 180 s del contrato
 * más un margen de 300 s, y una compensación directa al vencer. Con eso,
 * devolvíamos el dinero mientras el otro banco ya se lo había entregado a su
 * destinatario — y el contrato le da 24 horas para reintentar su callback.
 *
 * Las dos reglas que ninguna otra prueba puede dar por supuestas:
 *
 * 1. **Una respuesta del otro banco manda sobre cualquier plazo.**
 * 2. **Sin respuesta, no se libera nada antes del margen.**
 */

const CREADO = new Date('2026-10-16T12:00:00.000Z');
const TTL = 180_000;
const MARGEN = 300_000;
const { expiresAt, releaseNotBefore } = timeoutSchedule(CREADO, TTL, MARGEN);

function hechos(overrides: Partial<TimeoutFacts> = {}): TimeoutFacts {
  return {
    now: new Date(expiresAt.getTime() + 1_000),
    expiresAt,
    releaseNotBefore,
    probe: null,
    cancel: null,
    ...overrides,
  };
}

const contesta = (status: PartnerProbe extends { status: infer S } ? S : never): PartnerProbe =>
  ({ kind: 'ANSWERED', status }) as PartnerProbe;
const cancela = (result: 'CANCELLED' | 'ALREADY_ACCEPTED' | 'ALREADY_REJECTED'): PartnerCancel => ({
  kind: 'ANSWERED',
  result,
});

describe('los dos plazos salen del contrato', () => {
  it('180 s para expirar y 300 s más para liberar a ciegas', () => {
    expect(expiresAt.toISOString()).toBe('2026-10-16T12:03:00.000Z');
    expect(releaseNotBefore.toISOString()).toBe('2026-10-16T12:08:00.000Z');
  });
});

describe('el primer paso es preguntar, no compensar', () => {
  it('un depósito recién vencido se consulta', () => {
    /*
     * La afirmación que resume el ticket. Antes de TD-095 esto compensaba — y
     * compensar aquí, a los tres minutos, es devolver el dinero cuando al otro
     * banco le quedan 23 horas y 57 minutos de plazo para su callback.
     */
    expect(resolveTimeout(hechos())).toEqual({ kind: 'PROBE' });
  });
});

describe('una respuesta del otro banco manda sobre cualquier plazo', () => {
  it('ACCEPTED confirma, aunque el margen no haya pasado', () => {
    expect(resolveTimeout(hechos({ probe: contesta('ACCEPTED') }))).toEqual({ kind: 'CONFIRM' });
  });

  it('REJECTED libera, aunque el margen no haya pasado', () => {
    expect(resolveTimeout(hechos({ probe: contesta('REJECTED') }))).toEqual({
      kind: 'RELEASE',
      reason: 'REJECTED_AT_PARTNER',
    });
  });

  it('CANCELLED libera con su propio motivo, que no es el mismo', () => {
    /*
     * Distinguirlos no es cosmético: «lo rechazó» es una opinión del otro banco
     * sobre la cuenta destino, y «estaba cancelado» es el resultado de nuestra
     * propia cancelación. Un operador que conciliando ve los dos como
     * `REJECTED` no puede saber quién decidió.
     */
    expect(resolveTimeout(hechos({ probe: contesta('CANCELLED') }))).toEqual({
      kind: 'RELEASE',
      reason: 'CANCELLED_AT_PARTNER',
    });
  });

  it('PROCESSING pasado el plazo manda cancelar', () => {
    expect(resolveTimeout(hechos({ probe: contesta('PROCESSING') }))).toEqual({ kind: 'CANCEL' });
  });

  it('un ACCEPTED tardío confirma incluso pasadísimo el margen', () => {
    const action = resolveTimeout(
      hechos({
        now: new Date(releaseNotBefore.getTime() + 86_400_000),
        probe: contesta('ACCEPTED'),
      }),
    );

    expect(action).toEqual({ kind: 'CONFIRM' });
  });
});

describe('un 404 no libera: manda cancelar', () => {
  it('cancela para dejar constancia, en vez de liberar por su cuenta', () => {
    /*
     * Tentador liberar directamente —«no lo conocen, luego no lo acreditaron»—
     * y equivocado: un `404` también se parece a una solicitud que llegó y no
     * se guardó. Cancelar primero es lo que convierte nuestra liberación en
     * defendible ante la conciliación en vez de en una decisión unilateral.
     */
    expect(resolveTimeout(hechos({ probe: { kind: 'UNKNOWN' } }))).toEqual({ kind: 'CANCEL' });
  });
});

describe('las tres respuestas de la cancelación', () => {
  it('CANCELLED libera', () => {
    expect(resolveTimeout(hechos({ probe: contesta('PROCESSING'), cancel: cancela('CANCELLED') })))
      .toEqual({ kind: 'RELEASE', reason: 'CANCELLED_AT_PARTNER' });
  });

  it('ALREADY_REJECTED libera', () => {
    expect(
      resolveTimeout(
        hechos({ probe: contesta('PROCESSING'), cancel: cancela('ALREADY_REJECTED') }),
      ),
    ).toEqual({ kind: 'RELEASE', reason: 'REJECTED_AT_PARTNER' });
  });

  it('ALREADY_ACCEPTED confirma: se nos adelantaron', () => {
    /*
     * El caso que justifica el protocolo entero. Pedimos cancelar y nos dicen
     * que ya habían acreditado: el dinero está donde tenía que estar y la Saga
     * cierra BIEN. Con el comportamiento anterior esta transferencia habría
     * acabado compensada, con el dinero devuelto aquí y entregado allá.
     */
    expect(
      resolveTimeout(
        hechos({ probe: contesta('PROCESSING'), cancel: cancela('ALREADY_ACCEPTED') }),
      ),
    ).toEqual({ kind: 'CONFIRM' });
  });

  it('la cancelación manda sobre la consulta anterior', () => {
    // La consulta dijo `PROCESSING`; la cancelación dice que ya se aceptó. Lo
    // posterior en el protocolo es lo que vale.
    expect(
      resolveTimeout(hechos({ probe: contesta('PROCESSING'), cancel: cancela('ALREADY_ACCEPTED') })),
    ).toEqual({ kind: 'CONFIRM' });
  });
});

describe('sin respuesta, el margen gobierna', () => {
  it('espera con el dinero reservado mientras el margen no pase', () => {
    const action = resolveTimeout(
      hechos({ now: new Date(releaseNotBefore.getTime() - 1), probe: { kind: 'UNREACHABLE' } }),
    );

    expect(action).toEqual({ kind: 'WAIT', until: releaseNotBefore });
  });

  it('espera también con la cancelación sin contestar', () => {
    const action = resolveTimeout(
      hechos({
        now: new Date(releaseNotBefore.getTime() - 1),
        probe: { kind: 'UNKNOWN' },
        cancel: { kind: 'UNREACHABLE' },
      }),
    );

    expect(action).toEqual({ kind: 'WAIT', until: releaseNotBefore });
  });

  it('pasado el margen libera, marcado como no verificado', () => {
    const action = resolveTimeout(
      hechos({ now: releaseNotBefore, probe: { kind: 'UNREACHABLE' } }),
    );

    expect(action).toEqual({ kind: 'RELEASE_UNVERIFIED', reason: 'RELEASED_NO_ANSWER' });
  });

  it('distingue «no contestan» de «no lo conocen» al liberar a ciegas', () => {
    const action = resolveTimeout(
      hechos({
        now: releaseNotBefore,
        probe: { kind: 'UNKNOWN' },
        cancel: { kind: 'UNREACHABLE' },
      }),
    );

    expect(action).toEqual({
      kind: 'RELEASE_UNVERIFIED',
      reason: 'RELEASED_UNKNOWN_AT_PARTNER',
    });
  });

  it('el límite es exacto: un milisegundo antes todavía se espera', () => {
    const justoAntes = new Date(releaseNotBefore.getTime() - 1);
    const justo = releaseNotBefore;

    expect(resolveTimeout(hechos({ now: justoAntes, probe: { kind: 'UNREACHABLE' } })).kind).toBe(
      'WAIT',
    );
    expect(resolveTimeout(hechos({ now: justo, probe: { kind: 'UNREACHABLE' } })).kind).toBe(
      'RELEASE_UNVERIFIED',
    );
  });
});

describe('lo que nunca hace', () => {
  it('no libera nada antes del margen sin una respuesta', () => {
    /*
     * Barrido exhaustivo del caso peligroso: con cualquier combinación de «no
     * sabemos», antes del margen, la respuesta NUNCA es liberar. Es la
     * invariante que protege el dinero, así que se afirma por enumeración y no
     * por un ejemplo.
     */
    const sinRespuesta: (PartnerProbe | null)[] = [
      null,
      { kind: 'UNREACHABLE' },
      { kind: 'UNKNOWN' },
    ];
    const cancelaciones: (PartnerCancel | null)[] = [null, { kind: 'UNREACHABLE' }];

    for (const probe of sinRespuesta) {
      for (const cancel of cancelaciones) {
        for (const offset of [1, 1_000, MARGEN - 1]) {
          const action = resolveTimeout(
            hechos({ now: new Date(expiresAt.getTime() + offset), probe, cancel }),
          );

          expect(['PROBE', 'CANCEL', 'WAIT']).toContain(action.kind);
        }
      }
    }
  });
});
