import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  ALL_STATES,
  INTERBANK_CREATION_GRACE_MS,
  INTERBANK_LIST_LIMIT,
  INTERBANK_POLL_CEILING_MS,
  INTERBANK_POLL_FAST_MS,
  INTERBANK_POLL_FAST_WINDOW_MS,
  INTERBANK_POLL_SLOW_MS,
  INTERBANK_REVERSAL_PRESENTATION,
  INTERBANK_STATES,
  INTERBANK_STATE_PRESENTATION,
  KNOWN_INTERBANK_REASONS,
  explainInterbankReason,
  interbankDetailPath,
  interbankHistorySteps,
  interbankListQuery,
  interbankPollDelay,
  interbankStateFilterOptions,
  isSettled,
  meaningOfMissingSend,
  reasonTitleFor,
  sagaTransferFor,
} from '../app/lib/interbank-deposit.ts';
import { canOpen } from '../app/lib/navigation.ts';

const DEPOSITO = '7f2b1c42-0000-4000-8000-0000000000aa';
const TRANSFERENCIA = '3f1c2d64-6b2f-4b1a-9d5e-0a7c8e5b41d2';

describe('los seis estados del depósito', () => {
  test('son los seis que el enunciado enumera, y cada uno se explica', () => {
    assert.deepEqual([...INTERBANK_STATES], [
      'PENDING',
      'SENT',
      'ACCEPTED',
      'REJECTED',
      'TIMEOUT',
      'REVERSED',
    ]);

    for (const state of INTERBANK_STATES) {
      const presentation = INTERBANK_STATE_PRESENTATION[state];

      assert.ok(presentation.label.length > 0, state);
      assert.ok(presentation.explanation.length > 20, state);
      assert.ok(['success', 'warning', 'error', 'neutral'].includes(presentation.color), state);
    }
  });

  test('cada estado tiene una etiqueta distinta: dos iguales harían ilegible la lista', () => {
    const labels = INTERBANK_STATES.map((state) => INTERBANK_STATE_PRESENTATION[state].label);

    assert.equal(new Set(labels).size, labels.length);
  });

  /**
   * El error que estas palabras existen para no cometer: decir que el dinero
   * llegó antes de que el otro banco conteste.
   */
  test('sólo ACCEPTED dice que el dinero llegó', () => {
    for (const state of INTERBANK_STATES) {
      const { label, explanation } = INTERBANK_STATE_PRESENTATION[state];
      const claimsArrival = /acreditad|llegó a la cuenta de destino/i.test(`${label} ${explanation}`);

      assert.equal(claimsArrival, state === 'ACCEPTED', `${state}: «${label}» / «${explanation}»`);
    }
  });

  test('SENT es esperar y TIMEOUT no es un fallo: el dinero sigue reservado', () => {
    assert.match(INTERBANK_STATE_PRESENTATION.SENT.label, /Esperando/);
    assert.equal(INTERBANK_STATE_PRESENTATION.TIMEOUT.color, 'warning');
    assert.match(INTERBANK_STATE_PRESENTATION.TIMEOUT.explanation, /reservado/);
    assert.match(INTERBANK_STATE_PRESENTATION.TIMEOUT.explanation, /no repitas/);
  });

  test('REJECTED y REVERSED se dicen distinto: el segundo es que el dinero ya volvió', () => {
    assert.match(INTERBANK_STATE_PRESENTATION.REJECTED.explanation, /vuelve/);
    assert.match(INTERBANK_STATE_PRESENTATION.REVERSED.explanation, /ya volvió/);
    assert.notEqual(
      INTERBANK_STATE_PRESENTATION.REJECTED.label,
      INTERBANK_STATE_PRESENTATION.REVERSED.label,
    );
  });

  test('no usa la jerga interna en ninguna frase que se lee', () => {
    for (const state of INTERBANK_STATES) {
      const { label, explanation } = INTERBANK_STATE_PRESENTATION[state];

      assert.doesNotMatch(`${label} ${explanation}`, /saga|payload|outbox|callback|idempoten|compens/i, state);
    }
  });
});

describe('el filtro de estados', () => {
  test('ofrece «todos» primero y después los seis', () => {
    const options = interbankStateFilterOptions();

    assert.equal(options.length, 7);
    assert.equal(options[0].value, ALL_STATES);
    assert.deepEqual(
      options.slice(1).map((option) => option.value),
      [...INTERBANK_STATES],
    );
  });

  /** Un `USelect` con un item de valor vacío no abre nunca, y no dice por qué. */
  test('ningún valor es la cadena vacía', () => {
    for (const option of interbankStateFilterOptions()) {
      assert.notEqual(option.value, '');
      assert.ok(option.label.length > 0);
    }
  });

  test('«todos» no manda state; un estado lo manda tal cual', () => {
    assert.deepEqual(interbankListQuery(ALL_STATES), { limit: String(INTERBANK_LIST_LIMIT) });
    assert.deepEqual(interbankListQuery('TIMEOUT'), {
      limit: String(INTERBANK_LIST_LIMIT),
      state: 'TIMEOUT',
    });
  });

  test('el límite está dentro de lo que el Gateway acepta, de 1 a 200', () => {
    assert.ok(INTERBANK_LIST_LIMIT >= 1 && INTERBANK_LIST_LIMIT <= 200);
  });
});

describe('el motivo, en una frase', () => {
  test('explica los siete códigos del contrato oficial', async () => {
    const yaml = await readFile(
      new URL('../../../docs/references/interbank-contract-v1.openapi.yaml', import.meta.url),
      'utf8',
    );
    const block =
      /ReasonCode:\s*\r?\n\s+type: string\s*\r?\n\s+description:[^\r\n]*\r?\n\s+enum:\r?\n((?:\s+- \w+\r?\n)+)/.exec(
        yaml,
      );

    assert.ok(block, 'no se encontró ReasonCode en el contrato');

    const codes = [...block[1].matchAll(/- (\w+)/g)].map((match) => match[1]);

    assert.equal(codes.length, 7, codes.join(', '));

    for (const code of codes) {
      assert.ok(KNOWN_INTERBANK_REASONS.includes(code), `falta explicar ${code}`);
      assert.doesNotMatch(explainInterbankReason(code), /\b[A-Z]+_[A-Z_]+\b/, code);
    }
  });

  test('explica los motivos locales del protocolo de TIMEOUT', () => {
    for (const code of [
      'CONFIRMATION_TIMEOUT',
      'CANCELLED_AT_PARTNER',
      'REJECTED_AT_PARTNER',
      'RELEASED_NO_ANSWER',
      'RELEASED_UNKNOWN_AT_PARTNER',
    ]) {
      assert.ok(KNOWN_INTERBANK_REASONS.includes(code), code);
    }

    // Los dos que devuelven el dinero a ciegas lo dicen.
    assert.match(explainInterbankReason('RELEASED_NO_ANSWER'), /sin tener su confirmación/);
    assert.match(explainInterbankReason('RELEASED_UNKNOWN_AT_PARTNER'), /sin tener su confirmación/);
  });

  test('sigue explicando los del callback provisional, que una fila vieja puede traer', () => {
    for (const code of [
      'AMOUNT_EXCEEDS_LIMIT',
      'UNSUPPORTED_CURRENCY',
      'WRONG_DESTINATION_BANK',
      'BANK_NOT_AUTHORIZED',
      'INVALID_REQUEST',
      'IDEMPOTENCY_CONFLICT',
    ]) {
      assert.ok(KNOWN_INTERBANK_REASONS.includes(code), code);
    }
  });

  test('sin motivo no hay nada que decir', () => {
    assert.equal(explainInterbankReason(null), null);
    assert.equal(explainInterbankReason(''), null);
    assert.equal(explainInterbankReason('   '), null);
  });

  test('un código desconocido no se descarta: se dice y se conserva para soporte', () => {
    const frase = explainInterbankReason('MOTIVO_NUEVO_DEL_OTRO_BANCO');

    assert.match(frase, /no es uno de los que conocemos/);
    assert.match(frase, /MOTIVO_NUEVO_DEL_OTRO_BANCO/);
  });

  test('el título del recuadro explica la espera en un TIMEOUT y el fallo en el resto', () => {
    assert.equal(reasonTitleFor('TIMEOUT'), 'Por qué seguimos esperando');

    for (const state of ['REJECTED', 'REVERSED', 'SENT']) {
      assert.equal(reasonTitleFor(state), 'Por qué no se completó', state);
    }
  });
});

describe('cuándo dejar de preguntar', () => {
  test('ACCEPTED y REVERSED son lo único que ya no cambia', () => {
    assert.deepEqual(INTERBANK_STATES.filter(isSettled), ['ACCEPTED', 'REVERSED']);
  });

  test('PENDING, SENT y TIMEOUT siguen preguntando, y REJECTED también: falta el regreso del dinero', () => {
    for (const state of ['PENDING', 'SENT', 'TIMEOUT', 'REJECTED']) {
      assert.equal(interbankPollDelay(state, 0), INTERBANK_POLL_FAST_MS, state);
    }
  });

  test('los estados finales no preguntan nunca', () => {
    for (const state of ['ACCEPTED', 'REVERSED']) {
      assert.equal(interbankPollDelay(state, 0), null, state);
      assert.equal(interbankPollDelay(state, 30_000), null, state);
    }
  });

  test('pregunta rápido el primer minuto y más despacio después', () => {
    assert.equal(interbankPollDelay('SENT', INTERBANK_POLL_FAST_WINDOW_MS - 1), INTERBANK_POLL_FAST_MS);
    assert.equal(interbankPollDelay('SENT', INTERBANK_POLL_FAST_WINDOW_MS), INTERBANK_POLL_SLOW_MS);
    assert.ok(INTERBANK_POLL_SLOW_MS > INTERBANK_POLL_FAST_MS);
  });

  /**
   * El protocolo de TIMEOUT retiene el dinero hasta ocho minutos
   * (`expiresAt` + 300 s con `expiresAt` = 180 s): un techo menor se rendiría
   * mientras el sistema todavía lo resuelve.
   */
  test('el techo cubre el peor caso del protocolo de TIMEOUT, ocho minutos', () => {
    assert.ok(INTERBANK_POLL_CEILING_MS > 8 * 60_000);
    assert.notEqual(interbankPollDelay('TIMEOUT', 8 * 60_000), null);
    assert.equal(interbankPollDelay('TIMEOUT', INTERBANK_POLL_CEILING_MS), null);
    assert.equal(interbankPollDelay('PENDING', INTERBANK_POLL_CEILING_MS + 1), null);
  });
});

describe('un «no existe» justo después de enviar', () => {
  test('durante la gracia es que todavía se está registrando', () => {
    assert.equal(meaningOfMissingSend(0), 'STILL_STARTING');
    assert.equal(meaningOfMissingSend(INTERBANK_CREATION_GRACE_MS - 1), 'STILL_STARTING');
  });

  test('pasada la gracia es que no está', () => {
    assert.equal(meaningOfMissingSend(INTERBANK_CREATION_GRACE_MS), 'MISSING');
    assert.equal(meaningOfMissingSend(10 * 60_000), 'MISSING');
  });

  test('la gracia es más larga que la de la Saga: aquí hay un paso más antes de la fila', () => {
    assert.ok(INTERBANK_CREATION_GRACE_MS > 10_000);
  });
});

describe('el historial', () => {
  const historial = [
    { state: 'PENDING', reason: null, at: '2026-10-18T12:00:00.000Z' },
    { state: 'SENT', reason: null, at: '2026-10-18T12:00:02.000Z' },
    { state: 'TIMEOUT', reason: 'CONFIRMATION_TIMEOUT', at: '2026-10-18T12:03:00.000Z' },
    { state: 'REJECTED', reason: 'REJECTED_AT_PARTNER', at: '2026-10-18T12:04:00.000Z' },
    { state: 'REVERSED', reason: null, at: '2026-10-18T12:04:02.000Z' },
  ];

  test('conserva el orden y el número de pasos que llegaron', () => {
    const pasos = interbankHistorySteps(historial);

    assert.deepEqual(
      pasos.map((paso) => paso.state),
      historial.map((entrada) => entrada.state),
    );
    assert.deepEqual(
      pasos.map((paso) => paso.at),
      historial.map((entrada) => entrada.at),
    );
  });

  test('no inventa los pasos que no se registraron', () => {
    const salto = interbankHistorySteps([
      { state: 'PENDING', reason: null, at: '2026-10-18T12:00:00.000Z' },
      { state: 'ACCEPTED', reason: null, at: '2026-10-18T12:00:01.000Z' },
    ]);

    assert.deepEqual(
      salto.map((paso) => paso.state),
      ['PENDING', 'ACCEPTED'],
    );
  });

  test('marca el rechazo como fallo y la espera como espera', () => {
    const tonos = Object.fromEntries(interbankHistorySteps(historial).map((p) => [p.state, p.tone]));

    assert.equal(tonos.REJECTED, 'fail');
    assert.equal(tonos.TIMEOUT, 'wait');
    assert.equal(tonos.SENT, 'ok');
    assert.equal(tonos.REVERSED, 'ok');
  });

  test('pone el motivo en frase en el paso que lo trae, y en ninguno más', () => {
    const pasos = interbankHistorySteps(historial);

    assert.match(pasos[2].reasonText, /no confirmó el depósito dentro del plazo/);
    assert.match(pasos[3].reasonText, /había rechazado/);
    assert.equal(pasos[0].reasonText, null);
    assert.equal(pasos[4].reasonText, null);
  });

  test('un historial vacío es una lista vacía', () => {
    assert.deepEqual(interbankHistorySteps([]), []);
  });
});

describe('el reverso', () => {
  test('tiene una etiqueta para cada uno de sus cuatro estados', () => {
    for (const state of ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']) {
      assert.ok(INTERBANK_REVERSAL_PRESENTATION[state].label.length > 0, state);
    }

    assert.equal(INTERBANK_REVERSAL_PRESENTATION.COMPLETED.color, 'success');
    assert.equal(INTERBANK_REVERSAL_PRESENTATION.FAILED.color, 'error');
  });
});

describe('a dónde lleva enviar', () => {
  test('al depósito, no a la Saga', () => {
    assert.equal(
      interbankDetailPath(DEPOSITO),
      `/transferencias/interbancarias/${DEPOSITO}`,
    );
  });

  test('lleva consigo la transferencia, para poder ir a ella', () => {
    assert.equal(
      interbankDetailPath(DEPOSITO, TRANSFERENCIA),
      `/transferencias/interbancarias/${DEPOSITO}?transferencia=${TRANSFERENCIA}`,
    );
  });

  test('no mete en la dirección algo que no es un identificador', () => {
    assert.equal(
      interbankDetailPath(DEPOSITO, 'no-es-un-uuid&x=1'),
      `/transferencias/interbancarias/${DEPOSITO}`,
    );
  });

  test('la transferencia del depósito gana a la de la dirección', () => {
    assert.equal(sagaTransferFor({ transactionId: TRANSFERENCIA }, DEPOSITO), TRANSFERENCIA);
  });

  test('sin depósito, sólo vale un UUID de la dirección', () => {
    assert.equal(sagaTransferFor(null, TRANSFERENCIA), TRANSFERENCIA);
    assert.equal(sagaTransferFor(null, 'javascript:alert(1)'), null);
    assert.equal(sagaTransferFor(null, undefined), null);
    assert.equal(sagaTransferFor(null, [TRANSFERENCIA]), null);
  });
});

/**
 * Una frase por código del contrato, y cada una dice **lo que pasó y qué hacer**,
 * no sólo que algo falló. Si una cambia de sentido, el caso que corresponde se
 * rompe con el nombre del código a la vista.
 */
describe('lo que dice cada motivo del contrato', () => {
  const casos = [
    ['ACCOUNT_NOT_FOUND', /no existe en el otro banco/, /Revisa el número/],
    ['ACCOUNT_INACTIVE', /no está activa/, /no puede recibir dinero/],
    ['AMOUNT_LIMIT_EXCEEDED', /supera el máximo/, /por operación/],
    ['CURRENCY_NOT_SUPPORTED', /no acepta depósitos en esta moneda/, /quetzales \(GTQ\)/],
    ['EXPIRED', /fuera de su plazo/, /no la procesó/],
    ['CANCELLED', /se canceló/, /antes de que el otro banco la acreditara/],
    ['PROCESSING_ERROR', /problema al procesar/, /intentarlo de nuevo/],
  ];

  for (const [codigo, queDice, queSigue] of casos) {
    test(codigo, () => {
      const frase = explainInterbankReason(codigo);

      assert.match(frase, queDice);
      assert.match(frase, queSigue);
      assert.ok(frase.endsWith('.'), 'una frase completa, no una etiqueta');
      assert.ok(!frase.includes(codigo), 'el código no se cuela en la frase');
    });
  }
});

/**
 * `/transferencias` la abre cualquier rol y la restricción real es fila por
 * fila, en Payment. Por eso no hay entrada nueva en la navegación (los módulos
 * son seis y una prueba lo fija): lo que hay que comprobar es que las dos
 * pantallas nuevas no quedaron detrás de un rol que no debería.
 */
describe('quién puede abrir las pantallas del depósito', () => {
  for (const rol of ['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR']) {
    test(rol, () => {
      assert.equal(canOpen(rol, '/transferencias/interbancarias'), true);
      assert.equal(canOpen(rol, `/transferencias/interbancarias/${DEPOSITO}`), true);
      assert.equal(canOpen(rol, '/transferencias/interbancaria'), true);
    });
  }

  test('sin sesión no se abre ninguna', () => {
    assert.equal(canOpen(null, '/transferencias/interbancarias'), false);
    assert.equal(canOpen(null, `/transferencias/interbancarias/${DEPOSITO}`), false);
  });
});

/** Los que pone este banco al resolver un depósito sin respuesta (TD-095). */
describe('lo que dice cada motivo local del protocolo de TIMEOUT', () => {
  const casos = [
    ['CONFIRMATION_TIMEOUT', /no confirmó el depósito dentro del plazo/],
    ['CANCELLED_AT_PARTNER', /lo canceló: no se acreditó/],
    ['REJECTED_AT_PARTNER', /había rechazado el depósito/],
    ['RELEASED_NO_ANSWER', /no contestó a ninguna consulta/],
    ['RELEASED_UNKNOWN_AT_PARTNER', /no tener registro del depósito/],
  ];

  for (const [codigo, queDice] of casos) {
    test(codigo, () => {
      const frase = explainInterbankReason(codigo);

      assert.match(frase, queDice);
      assert.ok(!frase.includes(codigo), 'el código no se cuela en la frase');
    });
  }
});

/** Etiqueta y color de cada uno de los seis, uno por uno: es lo que alguien lee en la lista. */
describe('cómo se ve cada estado', () => {
  const esperado = {
    PENDING: ['Por enviar', 'warning'],
    SENT: ['Esperando al otro banco', 'warning'],
    ACCEPTED: ['Acreditado', 'success'],
    REJECTED: ['Rechazado', 'error'],
    TIMEOUT: ['Sin respuesta', 'warning'],
    REVERSED: ['Devuelto', 'neutral'],
  };

  for (const [estado, [etiqueta, color]] of Object.entries(esperado)) {
    test(`${estado} se lee «${etiqueta}» en ${color}`, () => {
      assert.equal(INTERBANK_STATE_PRESENTATION[estado].label, etiqueta);
      assert.equal(INTERBANK_STATE_PRESENTATION[estado].color, color);
    });
  }
});
