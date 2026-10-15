import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INTERBANK_ACCEPTED_MESSAGE,
  MAX_PARTNER_ACCOUNT,
  canSendInterbank,
  interbankProblems,
  interbankRequestBody,
} from '../app/lib/interbank.ts';

const CUENTA = '7f2b1c42-0000-4000-8000-000000000001';

/** Un borrador correcto, para que cada caso cambie una sola cosa. */
function borrador(overrides = {}) {
  return {
    sourceAccount: CUENTA,
    destinationBankCode: 'BANCO_PAREJA',
    destinationAccount: 'cuenta-de-alla-1',
    amountMinor: 12_500,
    ...overrides,
  };
}

test('un borrador completo se puede enviar', () => {
  assert.deepEqual(interbankProblems(borrador()), {});
  assert.equal(canSendInterbank(borrador()), true);
});

test('pide elegir la cuenta de origen en vez de dejar mandar sin ella', () => {
  const problemas = interbankProblems(borrador({ sourceAccount: '' }));

  assert.ok(problemas.sourceAccount);
  assert.equal(canSendInterbank(borrador({ sourceAccount: 'no-es-un-uuid' })), false);
});

test('explica la forma del codigo de banco en vez de solo rechazarlo', () => {
  const vacio = interbankProblems(borrador({ destinationBankCode: '' }));
  const mal = interbankProblems(borrador({ destinationBankCode: 'banco pareja' }));

  assert.match(vacio.destinationBankCode, /Indica el código/);
  assert.match(mal.destinationBankCode, /mayúsculas/);
});

test('acepta el codigo que acordaron los dos bancos y rechaza el que no', () => {
  for (const bueno of ['BANCO_PAREJA', 'B2', 'PARTNER_MOCK', 'A_1_B']) {
    assert.deepEqual(interbankProblems(borrador({ destinationBankCode: bueno })), {});
  }

  for (const malo of ['b', 'BANCO-PAREJA', '1BANCO', 'BANCO PAREJA', 'A']) {
    assert.ok(interbankProblems(borrador({ destinationBankCode: malo })).destinationBankCode);
  }
});

test('la cuenta del otro banco es obligatoria y tiene un limite', () => {
  assert.ok(interbankProblems(borrador({ destinationAccount: '   ' })).destinationAccount);

  const larga = 'x'.repeat(MAX_PARTNER_ACCOUNT + 1);
  assert.match(
    interbankProblems(borrador({ destinationAccount: larga })).destinationAccount,
    new RegExp(String(MAX_PARTNER_ACCOUNT)),
  );

  // Justo en el límite sí pasa: un error de borde aquí rechaza una cuenta válida.
  assert.deepEqual(
    interbankProblems(borrador({ destinationAccount: 'x'.repeat(MAX_PARTNER_ACCOUNT) })),
    {},
  );
});

test('no deja mandar cero ni un monto negativo', () => {
  for (const monto of [null, 0, -1]) {
    assert.ok(interbankProblems(borrador({ amountMinor: monto })).amount);
  }
});

test('el cuerpo lleva solo lo que el cliente decide, y en GTQ', () => {
  const cuerpo = interbankRequestBody(borrador({ destinationAccount: '  con-espacios  ' }));

  assert.deepEqual(cuerpo, {
    sourceAccount: CUENTA,
    destinationBankCode: 'BANCO_PAREJA',
    destinationAccount: 'con-espacios',
    amount: { amountMinor: 12_500, currency: 'GTQ' },
  });

  // Lo que el Gateway mina no puede venir de aquí.
  assert.equal('targetAccount' in cuerpo, false);
  assert.equal('interbankTransferId' in cuerpo, false);
  assert.equal('idempotencyKey' in cuerpo, false);
});

test('el mensaje de aceptacion no dice que el dinero llego', () => {
  assert.doesNotMatch(INTERBANK_ACCEPTED_MESSAGE, /acreditad|enviado con éxito|completad/i);
  assert.match(INTERBANK_ACCEPTED_MESSAGE, /vuelve a tu cuenta/);
});
