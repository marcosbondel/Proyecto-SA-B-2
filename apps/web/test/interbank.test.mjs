import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  INTERBANK_ACCEPTED_MESSAGE,
  MAX_INTERBANK_AMOUNT_MINOR,
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
    destinationBankCode: 'BANK99',
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
  assert.match(mal.destinationBankCode, /BANK seguido de dos dígitos/);
  assert.match(mal.destinationBankCode, /BANK99/);
});

/**
 * El Gateway valida `^BANK[0-9]{2}$` (T-60) y contesta `400` a lo demás. Antes
 * el formulario aceptaba `BANCO_PAREJA`, que ningun banco pareja habria
 * aceptado: el cliente se enteraba por un error y no por un campo marcado.
 */
test('acepta solo el codigo del contrato, BANK y dos digitos', () => {
  for (const bueno of ['BANK00', 'BANK02', 'BANK99']) {
    assert.deepEqual(interbankProblems(borrador({ destinationBankCode: bueno })), {}, bueno);
  }

  for (const malo of [
    'BANCO_PAREJA',
    'B2',
    'A_1_B',
    'bank99',
    'BANK9',
    'BANK999',
    'BANK-99',
    'BANK 99',
    'XBANK99',
    'BANK99X',
    'b',
  ]) {
    assert.ok(interbankProblems(borrador({ destinationBankCode: malo })).destinationBankCode, malo);
  }
});

test('la cuenta del otro banco es obligatoria y tiene un limite de 34', () => {
  assert.equal(MAX_PARTNER_ACCOUNT, 34);
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

test('la cuenta del otro banco solo lleva letras, numeros y guiones', () => {
  for (const buena of ['02-0001234', 'ABC123', 'a-b-c', '1']) {
    assert.deepEqual(interbankProblems(borrador({ destinationAccount: buena })), {}, buena);
  }

  for (const mala of ['cuenta con espacio', 'cuenta_guion_bajo', 'cuenta.punto', 'cuenta/1', 'cuenta\u00f1', '1234 5678']) {
    const problema = interbankProblems(borrador({ destinationAccount: mala })).destinationAccount;

    assert.match(problema, /letras, números y guiones/, mala);
  }
});

test('el espacio de los extremos no cuenta, el del medio si', () => {
  assert.deepEqual(interbankProblems(borrador({ destinationAccount: '  02-0001234  ' })), {});
  assert.deepEqual(interbankProblems(borrador({ destinationBankCode: ' BANK99 ' })), {});
  assert.ok(interbankProblems(borrador({ destinationAccount: '02 0001234' })).destinationAccount);
});

test('el monto tiene el techo del contrato, Q 10,000.00', () => {
  assert.equal(MAX_INTERBANK_AMOUNT_MINOR, 1_000_000);

  // Justo en el techo pasa; un centavo más no.
  assert.deepEqual(interbankProblems(borrador({ amountMinor: 1_000_000 })), {});
  assert.match(interbankProblems(borrador({ amountMinor: 1_000_001 })).amount, /Q 10,000\.00/);
  assert.ok(interbankProblems(borrador({ amountMinor: 5_000_000 })).amount);
});

test('un monto con fracciones de centavo no es un monto', () => {
  assert.ok(interbankProblems(borrador({ amountMinor: 12_500.5 })).amount);
  assert.ok(interbankProblems(borrador({ amountMinor: Number.NaN })).amount);
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
    destinationBankCode: 'BANK99',
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

/**
 * `app/lib/` no depende de `@bank/contracts`, así que las dos formas viven en
 * dos sitios. Esto es lo que avisa cuando el Gateway cambia una y esta pantalla
 * sigue dejando pasar la vieja.
 */
test('los formatos de aqui son los que el Gateway valida', async () => {
  const dto = await readFile(
    new URL('../../gateway/src/interfaces/dto/interbank.dto.ts', import.meta.url),
    'utf8',
  );

  assert.ok(dto.includes('/^BANK[0-9]{2}$/'), 'el Gateway ya no valida el código de banco así');
  assert.ok(
    dto.includes(`/^[A-Za-z0-9-]{1,${String(MAX_PARTNER_ACCOUNT)}}$/`),
    'el Gateway ya no valida la cuenta de destino así',
  );
});
