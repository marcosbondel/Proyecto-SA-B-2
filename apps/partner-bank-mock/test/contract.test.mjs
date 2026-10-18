/**
 * El validador del mock contra el contrato OFICIAL y contra sus ejemplos.
 *
 * Los ejemplos de `fixtures/contract-examples/` son una copia de
 * `examples/` del repositorio público `marcosbondel/bank-interbank-contract`
 * (el acuerdo de integración, AGREEMENT.md §7): cada carpeta es un esquema,
 * los archivos sueltos son válidos y los de `invalid/` deben rechazarse.
 * `CancelRequest/with-extra-field.json` y `ReversalRequest/with-extra-field.json`
 * NO están en `invalid/` a propósito: el contrato sólo declara
 * `additionalProperties: false` en `TransferRequest` y `TransferResult`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSchemasDocument, SCHEMAS_PATH } from '../scripts/sync-contract.mjs';
import {
  CONTRACT_SHA256,
  SCHEMAS,
  fromMinor,
  sameContent,
  toMinor,
  validate,
} from '../src/contract.mjs';

const examples = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contract-examples');

test('los esquemas del mock son exactamente los del contrato oficial', () => {
  assert.equal(
    readFileSync(SCHEMAS_PATH, 'utf8'),
    buildSchemasDocument(),
    'src/contract-schemas.json está desfasado: ejecuta `pnpm --filter partner-bank-mock contract:sync`',
  );
  assert.match(CONTRACT_SHA256, /^[0-9a-f]{64}$/);
});

function listExamples() {
  const found = [];
  for (const schema of readdirSync(examples)) {
    for (const file of readdirSync(join(examples, schema))) {
      if (file === 'invalid') continue;
      found.push({ schema, file, valid: true });
    }
    const invalidDir = join(examples, schema, 'invalid');
    if (existsSync(invalidDir)) {
      for (const file of readdirSync(invalidDir))
        found.push({ schema, file: join('invalid', file), valid: false });
    }
  }
  return found;
}

for (const { schema, file, valid } of listExamples()) {
  test(`${schema}/${file} ${valid ? 'es válido' : 'se rechaza'}`, () => {
    const body = JSON.parse(readFileSync(join(examples, schema, file), 'utf8'));
    const problems = validate(schema, body);
    if (valid) assert.deepEqual(problems, []);
    else assert.notEqual(problems.length, 0, 'el ejemplo inválido pasó la validación');
  });
}

test('hay ejemplos de cada clase, para que el recorrido anterior no sea vacío', () => {
  const found = listExamples();
  assert.ok(found.filter((example) => example.valid).length >= 25);
  assert.ok(found.filter((example) => !example.valid).length >= 15);
});

test('additionalProperties: false sólo en TransferRequest y TransferResult', () => {
  const strict = Object.entries(SCHEMAS)
    .filter(([, schema]) => schema.additionalProperties === false)
    .map(([name]) => name)
    .sort();
  assert.deepEqual(strict, ['TransferRequest', 'TransferResult']);
});

test('fechas: sólo date-time ISO 8601 válidos', () => {
  const base = JSON.parse(readFileSync(join(examples, 'TransferRequest', 'basic.json'), 'utf8'));
  assert.deepEqual(
    validate('TransferRequest', { ...base, createdAt: '2026-10-20T15:00:00.250Z' }),
    [],
  );
  assert.notEqual(
    validate('TransferRequest', { ...base, createdAt: '2026-13-45T15:00:00Z' }).length,
    0,
  );
  assert.notEqual(validate('TransferRequest', { ...base, createdAt: 'ayer' }).length, 0);
  assert.notEqual(
    validate('TransferRequest', { ...base, interbankTransferId: 'no-es-uuid' }).length,
    0,
  );
});

test('importes: conversión sin flotantes y comparación de contenido sin orden de claves', () => {
  assert.equal(toMinor('150.00'), 15000);
  assert.equal(toMinor('0.01'), 1);
  assert.equal(fromMinor(15005), '150.05');
  assert.equal(sameContent({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true);
  assert.equal(sameContent({ a: 1 }, { a: 2 }), false);
});
