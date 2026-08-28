import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { decodeSession, isSessionExpired } from '../app/lib/session.ts';

// Reading a token's claims and deciding whether it is still usable are the
// frontend's only auth-adjacent logic. They live in a plain module and are
// asserted here rather than hiding in a composable TD-010 leaves unverifiable.

/** Builds a JWT-shaped token with the given payload; the signature is ignored. */
function token(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature-not-checked-here`;
}

describe('decodeSession', () => {
  test('reads the claims of a well-formed token', () => {
    const session = decodeSession(
      token({ sub: 'cus-1', username: 'ana', role: 'ADMINISTRADOR', exp: 1_800_000_000 }),
    );

    assert.deepEqual(session, {
      token: token({ sub: 'cus-1', username: 'ana', role: 'ADMINISTRADOR', exp: 1_800_000_000 }),
      customerId: 'cus-1',
      username: 'ana',
      role: 'ADMINISTRADOR',
      expiresAt: 1_800_000_000,
    });
  });

  test('rejects a role it does not recognise', () => {
    assert.equal(decodeSession(token({ sub: 'x', username: 'x', role: 'ROOT', exp: 1 })), null);
  });

  test('rejects a token missing a required claim', () => {
    assert.equal(decodeSession(token({ sub: 'x', role: 'CLIENTE', exp: 1 })), null);
  });

  test('rejects a value that is not a token', () => {
    assert.equal(decodeSession('not-a-jwt'), null);
  });

  test('defaults a missing exp to 0, which is then treated as expired', () => {
    const session = decodeSession(token({ sub: 'x', username: 'x', role: 'CLIENTE' }));
    assert.equal(session?.expiresAt, 0);
    assert.equal(isSessionExpired(session.expiresAt, Date.now()), true);
  });
});

describe('isSessionExpired', () => {
  const NOW = 1_700_000_000_000; // ms

  test('a token whose exp is in the future is live', () => {
    assert.equal(isSessionExpired(1_700_000_001, NOW), false); // exp seconds > now ms/1000
  });

  test('a token whose exp has passed is expired', () => {
    assert.equal(isSessionExpired(1_699_999_999, NOW), true);
  });

  test('a token with no exp (0) is expired', () => {
    assert.equal(isSessionExpired(0, NOW), true);
  });
});
