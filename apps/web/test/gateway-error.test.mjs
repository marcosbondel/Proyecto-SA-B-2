import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  asyncStateFor,
  isSessionFailure,
  normaliseError,
} from '../app/lib/gateway-error.ts';

const TYPES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'BUSINESS_REJECTION',
  'REPLY_TIMEOUT',
  'BROKER_UNAVAILABLE',
  'INTERNAL_ERROR',
];

describe('normalising what a failed request produced', () => {
  test('recognises all seven types the Gateway defines', () => {
    for (const type of TYPES) {
      const error = normaliseError({ data: { type, message: 'x', correlationId: 'c' } });

      assert.equal(error.type, type, type);
    }
  });

  test('keeps the correlation identifier, which is what makes an error traceable', () => {
    const error = normaliseError({
      data: { type: 'REPLY_TIMEOUT', message: 'x', correlationId: 'abc-123' },
    });

    assert.equal(error.correlationId, 'abc-123');
  });

  test('keeps the failure code on a business rejection', () => {
    const error = normaliseError({
      data: { type: 'BUSINESS_REJECTION', message: 'x', failureCode: 'INSUFFICIENT_FUNDS' },
    });

    assert.equal(error.failureCode, 'INSUFFICIENT_FUNDS');
  });

  test('keeps the offending field on a validation error', () => {
    const error = normaliseError({
      data: { type: 'VALIDATION_ERROR', message: 'x', field: 'sourceAccount' },
    });

    assert.equal(error.field, 'sourceAccount');
  });

  // A frontend that breaks on a code it does not know is worse than one that
  // says "something failed" — and the Gateway may gain a type before this
  // module is next touched.
  test('falls back to an internal error for a type it has never seen', () => {
    const error = normaliseError({ data: { type: 'QUANTUM_FAILURE', message: 'x' } });

    assert.equal(error.type, 'INTERNAL_ERROR');
  });

  test('survives a response that is not the error contract at all', () => {
    for (const nonsense of [null, undefined, 'a string', 42, {}, { data: '<html>502</html>' }]) {
      const error = normaliseError(nonsense);

      assert.ok(TYPES.includes(error.type));
      assert.ok(error.message.length > 0);
    }
  });

  // No response at all is indistinguishable from the broker being down, and the
  // advice is the same: nothing happened, try again.
  test('treats an unreachable Gateway as an outage, and says nothing changed', () => {
    const error = normaliseError(new Error('fetch failed'));

    assert.equal(error.type, 'BROKER_UNAVAILABLE');
    assert.match(error.message, /No se realizó ningún cambio/);
  });

  test('never leaves the message empty', () => {
    const error = normaliseError({ data: { type: 'INTERNAL_ERROR', message: '' } });

    assert.ok(error.message.length > 0);
  });
});

describe('which failures the session layer swallows', () => {
  test('an expired session is one; a business rejection is not', () => {
    assert.equal(isSessionFailure(normaliseError({ data: { type: 'UNAUTHENTICATED' } })), true);
    assert.equal(isSessionFailure(normaliseError({ data: { type: 'FORBIDDEN' } })), false);
    assert.equal(
      isSessionFailure(normaliseError({ data: { type: 'BUSINESS_REJECTION' } })),
      false,
    );
  });
});

describe('which state the alert draws', () => {
  test('maps six asynchronous outcomes to themselves', () => {
    for (const type of [
      'VALIDATION_ERROR',
      'BUSINESS_REJECTION',
      'REPLY_TIMEOUT',
      'BROKER_UNAVAILABLE',
      'FORBIDDEN',
      'INTERNAL_ERROR',
    ]) {
      assert.equal(asyncStateFor(normaliseError({ data: { type } })), type, type);
    }
  });

  /**
   * T-60: the interbank routes answer a missing deposit with `NOT_FOUND`, which
   * used to fold into `INTERNAL_ERROR` — "an unexpected error occurred" for
   * "that deposit does not exist". It is recognised now, so a screen can tell
   * the two apart, and the alert draws it as the refusal it is.
   */
  test('recognises NOT_FOUND, keeps its sentence, and draws it as a refusal', () => {
    const error = normaliseError({
      data: { type: 'NOT_FOUND', message: 'No hay un depósito con ese identificador.', correlationId: 'c' },
    });

    assert.equal(error.type, 'NOT_FOUND');
    assert.equal(error.message, 'No hay un depósito con ese identificador.');
    assert.equal(asyncStateFor(error), 'BUSINESS_REJECTION');
  });

  test('never asks the alert to draw a session failure', () => {
    // UNAUTHENTICATED alone is the session boundary: `useGatewayApi`
    // intercepts it and ends the session before any screen sees it, so
    // "your session ended" and "the bank refused this" never look alike.
    assert.equal(asyncStateFor(normaliseError({ data: { type: 'UNAUTHENTICATED' } })), 'INTERNAL_ERROR');
  });

  /**
   * A 403 is a role rule the system enforced correctly, not a system failure —
   * folding it into INTERNAL_ERROR would title it "Ocurrió un error
   * inesperado", which is false. It draws its own honest state instead.
   */
  test('gives a role rejection its own state, distinct from an unexpected failure', () => {
    assert.equal(asyncStateFor(normaliseError({ data: { type: 'FORBIDDEN' } })), 'FORBIDDEN');
  });
});
