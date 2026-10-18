import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_FAULTS, patchFaults, readConfig } from '../src/config.mjs';

test('sin entorno: BANK99 contra BANK02, ACCEPT, y el contrato en 3021', () => {
  const { settings, faults } = readConfig({});
  assert.equal(settings.port, 3021);
  assert.equal(settings.bankCode, 'BANK99');
  assert.equal(settings.ourBankCode, 'BANK02');
  assert.equal(settings.ourBaseUrl, '');
  assert.equal(settings.adminToken, '');
  assert.deepEqual(faults, DEFAULT_FAULTS);
});

test('PARTNER_GATEWAY_URL recibe /interbank/v1 una sola vez', () => {
  for (const given of [
    'http://gateway:3000',
    'http://gateway:3000/',
    'http://gateway:3000/interbank/v1',
  ]) {
    assert.equal(
      readConfig({ PARTNER_GATEWAY_URL: given }).settings.ourBaseUrl,
      'http://gateway:3000/interbank/v1',
    );
  }
});

test('lee las llaves, los códigos y los fallos del entorno', () => {
  const { settings, faults } = readConfig({
    PARTNER_MOCK_PORT: '4000',
    PARTNER_MOCK_BANK_CODE: 'BANK07',
    INTERBANK_BANK_CODE: 'BANK03',
    PARTNER_MOCK_API_KEY: 'entrada',
    PARTNER_MOCK_CALLBACK_API_KEY: 'salida',
    PARTNER_MOCK_ADMIN_TOKEN: 'admin',
    PARTNER_CALLBACK_MODE: 'REJECT',
    PARTNER_CALLBACK_REJECT_REASON: 'ACCOUNT_INACTIVE',
    PARTNER_CALLBACK_DELAY_MS: '250',
    PARTNER_CALLBACK_FAIL_COUNT: '3',
    PARTNER_CALLBACK_FAIL_TARGETS: 'result, callback',
    PARTNER_CALLBACK_FAILURE_RATE: '12.5',
    PARTNER_CALLBACK_STATUS_BEHAVIOR: 'NOT_FOUND',
    PARTNER_CALLBACK_HONOR_EXPIRY: 'false',
    OTEL_SDK_DISABLED: 'true',
  });
  assert.equal(settings.port, 4000);
  assert.equal(settings.bankCode, 'BANK07');
  assert.equal(settings.ourBankCode, 'BANK03');
  assert.equal(settings.requireApiKey, 'entrada');
  assert.equal(settings.sendApiKey, 'salida');
  assert.equal(settings.telemetryDisabled, true);
  assert.deepEqual(faults, {
    ...DEFAULT_FAULTS,
    mode: 'REJECT',
    rejectReason: 'ACCOUNT_INACTIVE',
    delayMs: 250,
    failCount: 3,
    failTargets: ['result', 'callback'],
    failureRate: 12.5,
    statusBehavior: 'NOT_FOUND',
    honorExpiry: false,
  });
});

test('un valor inválido en el entorno es un error de arranque, no un valor por defecto', () => {
  assert.throws(() => readConfig({ PARTNER_CALLBACK_MODE: 'EXPLOTAR' }), /mode/);
  assert.throws(() => readConfig({ PARTNER_CALLBACK_REJECT_REASON: 'PORQUE_SI' }), /rejectReason/);
  assert.throws(
    () => readConfig({ PARTNER_CALLBACK_DELAY_MS: 'mucho' }),
    /PARTNER_CALLBACK_DELAY_MS/,
  );
  assert.throws(() => readConfig({ PARTNER_CALLBACK_FAIL_TARGETS: 'nada' }), /failTargets/);
  assert.throws(() => readConfig({ PARTNER_CALLBACK_FAILURE_RATE: '150' }), /failureRate/);
  assert.throws(() => readConfig({ PARTNER_CALLBACK_HONOR_EXPIRY: 'quizas' }), /true o false/);
});

test('patchFaults aplica un parche parcial y rechaza lo desconocido', () => {
  const ok = patchFaults(DEFAULT_FAULTS, { mode: 'SLOW', slowMs: 5 });
  assert.equal(ok.faults.mode, 'SLOW');
  assert.equal(ok.faults.slowMs, 5);
  assert.equal(ok.faults.delayMs, DEFAULT_FAULTS.delayMs);

  assert.match(patchFaults(DEFAULT_FAULTS, { modo: 'SLOW' }).problems[0], /campo desconocido/);
  assert.match(patchFaults(DEFAULT_FAULTS, { mode: 'NOPE' }).problems[0], /mode/);
  assert.match(patchFaults(DEFAULT_FAULTS, { delayMs: -1 }).problems[0], /delayMs/);
  assert.match(patchFaults(DEFAULT_FAULTS, null).problems[0], /objeto/);
});
