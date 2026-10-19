import {
  resolveBackoff,
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
    probeAttempts: 0,
    maxProbeAttempts: 3,
    ...overrides,
  };
}

/*
 * Los cuatro estados del contrato, escritos. La primera versión de esto usaba
 * `PartnerProbe extends { status: infer S } ? S : never`, que parece más listo y
 * resuelve a **`never`**: `PartnerProbe` es una unión, `extends` distribuye, y
 * los miembros `UNKNOWN` y `UNREACHABLE` no tienen `status`. Jest lo dejaba
 * pasar y lo encontró `tsc`.
 */
const contesta = (
  status: 'PROCESSING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED',
): PartnerProbe => ({ kind: 'ANSWERED', status });
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

describe('sin respuesta, se insiste y sólo entonces el margen libera (T-60)', () => {
  const justoAntes = new Date(releaseNotBefore.getTime() - 1);

  it('un sondeo sin respuesta se reintenta hasta agotar los intentos', () => {
    /*
     * Antes un `UNREACHABLE` esperaba al margen sin volver a preguntar, y el
     * contrato dice «consulta … con reintentos». Un banco que vuelve un minuto
     * después de la primera consulta fallida tiene que ser consultado otra vez.
     */
    for (const intentos of [1, 2]) {
      expect(
        resolveTimeout(
          hechos({ probe: { kind: 'UNREACHABLE' }, probeAttempts: intentos, now: justoAntes }),
        ),
      ).toEqual({ kind: 'PROBE' });
    }
  });

  it('agotados los intentos de consulta pasa a cancelar', () => {
    expect(
      resolveTimeout(
        hechos({ probe: { kind: 'UNREACHABLE' }, probeAttempts: 3, now: justoAntes }),
      ),
    ).toEqual({ kind: 'CANCEL' });
  });

  it('con la cancelación sin contestar sigue cancelando mientras corre el margen', () => {
    /*
     * La cancelación cubre las tres salidas (`CANCELLED`, `ALREADY_ACCEPTED`,
     * `ALREADY_REJECTED`), así que es la pregunta que más vale repetir. Antes
     * esperaba (`WAIT`) sin intentarlo de nuevo.
     */
    const action = resolveTimeout(
      hechos({
        now: justoAntes,
        probe: { kind: 'UNKNOWN' },
        cancel: { kind: 'UNREACHABLE' },
        probeAttempts: 1,
      }),
    );

    expect(action).toEqual({ kind: 'CANCEL' });
  });

  it('nunca libera sin haber intentado cancelar, ni siquiera pasado el margen', () => {
    /*
     * Cancelar al menos una vez es lo que deja la constancia que hace
     * defendible una liberación a ciegas. Si el margen pasó con la consulta
     * reintentándose y la cancelación sin intentar, primero se cancela.
     */
    const action = resolveTimeout(
      hechos({
        now: releaseNotBefore,
        probe: { kind: 'UNREACHABLE' },
        probeAttempts: 1,
        cancel: null,
      }),
    );

    expect(action).toEqual({ kind: 'CANCEL' });
  });

  it('pasado el margen, con las dos preguntas sin respuesta, libera marcado como no verificado', () => {
    const action = resolveTimeout(
      hechos({
        now: releaseNotBefore,
        probe: { kind: 'UNREACHABLE' },
        probeAttempts: 3,
        cancel: { kind: 'UNREACHABLE' },
      }),
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

  it('un banco que contesta la consulta (PROCESSING) y nunca la cancelación no retiene el dinero para siempre', () => {
    const antes = resolveTimeout(
      hechos({
        now: justoAntes,
        probe: contesta('PROCESSING'),
        cancel: { kind: 'UNREACHABLE' },
      }),
    );
    const despues = resolveTimeout(
      hechos({
        now: releaseNotBefore,
        probe: contesta('PROCESSING'),
        cancel: { kind: 'UNREACHABLE' },
      }),
    );

    expect(antes).toEqual({ kind: 'CANCEL' });
    expect(despues.kind).toBe('RELEASE_UNVERIFIED');
  });

  it('el límite es exacto: un milisegundo antes todavía se insiste', () => {
    const sinRespuesta = {
      probe: { kind: 'UNREACHABLE' } as const,
      cancel: { kind: 'UNREACHABLE' } as const,
      probeAttempts: 3,
    };

    expect(resolveTimeout(hechos({ ...sinRespuesta, now: justoAntes })).kind).toBe('CANCEL');
    expect(resolveTimeout(hechos({ ...sinRespuesta, now: releaseNotBefore })).kind).toBe(
      'RELEASE_UNVERIFIED',
    );
  });

  it('una respuesta tardía manda sobre el margen: ACCEPTED confirma tras el margen', () => {
    expect(
      resolveTimeout(
        hechos({ now: new Date(releaseNotBefore.getTime() + 1), probe: contesta('ACCEPTED') }),
      ),
    ).toEqual({ kind: 'CONFIRM' });
  });
});

describe('la espera entre intentos', () => {
  const ahora = new Date(expiresAt.getTime() + 1_000);
  const base = { now: ahora, baseMs: 5_000, capMs: 60_000, releaseNotBefore };

  it('crece al doble con cada fallo, hasta un techo', () => {
    const esperas = [1, 2, 3, 4, 5, 6].map(
      (failures) => resolveBackoff({ ...base, failures }).getTime() - ahora.getTime(),
    );

    expect(esperas).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it('no pasa del margen: a esa hora hay que volver a mirar', () => {
    const casiAlMargen = new Date(releaseNotBefore.getTime() - 2_000);

    expect(
      resolveBackoff({ ...base, now: casiAlMargen, failures: 6 }).getTime(),
    ).toBe(releaseNotBefore.getTime());
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
      contesta('PROCESSING'),
    ];
    const cancelaciones: (PartnerCancel | null)[] = [null, { kind: 'UNREACHABLE' }];

    for (const probe of sinRespuesta) {
      for (const cancel of cancelaciones) {
        for (const probeAttempts of [0, 1, 3, 10]) {
          for (const offset of [1, 1_000, MARGEN - 1]) {
            const action = resolveTimeout(
              hechos({ now: new Date(expiresAt.getTime() + offset), probe, cancel, probeAttempts }),
            );

            expect(['PROBE', 'CANCEL']).toContain(action.kind);
          }
        }
      }
    }
  });
});
