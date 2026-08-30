import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { isIdentifier, searchDestinations } from '../app/lib/search.ts';
import { initialsOf } from '../app/lib/navigation.ts';

/**
 * The header's "go to" box, and the avatar's letters.
 *
 * Both are template-adjacent things that nonetheless *decide* something — where
 * a visitor lands, and what a person is called — so both live in plain modules
 * and are asserted here rather than hiding in the shell, where TD-010 would
 * leave them unverifiable.
 */

const ACCOUNT = '3f1c2d64-6b2f-4b1a-9d5e-0a7c8e5b41d2';

describe('what counts as an identifier', () => {
  test('a UUID v4 does', () => {
    assert.equal(isIdentifier(ACCOUNT), true);
    assert.equal(isIdentifier(`  ${ACCOUNT}  `), true, 'surrounding space is not the visitor’s fault');
    assert.equal(isIdentifier(ACCOUNT.toUpperCase()), true);
  });

  test('a partial one, a name, or the prototype’s decorative account number does not', () => {
    assert.equal(isIdentifier(''), false);
    assert.equal(isIdentifier('3f1c2d64'), false);
    assert.equal(isIdentifier('José Carlos'), false);
    // The prototype draws ten-digit account numbers; this system issues UUIDs.
    assert.equal(isIdentifier('1042887301'), false);
  });

  test('a UUID of another version does not — this system issues v4', () => {
    assert.equal(isIdentifier('3f1c2d64-6b2f-1b1a-9d5e-0a7c8e5b41d2'), false);
  });
});

describe('where an identifier could take you', () => {
  test('an administrator is offered all four screens', () => {
    assert.deepEqual(
      searchDestinations(ACCOUNT, 'ADMINISTRADOR').map((destination) => destination.label),
      ['Cuenta', 'Cliente', 'Transferencia', 'Pago'],
    );
  });

  /**
   * A client is not offered the payment screen, because `/pagos` is staff work
   * (TD-037) and the Gateway would refuse it. Offering a destination that fails
   * is the same discourtesy as showing a module a role cannot open.
   */
  test('a client is not offered the payment screen', () => {
    assert.deepEqual(
      searchDestinations(ACCOUNT, 'CLIENTE').map((destination) => destination.label),
      ['Cuenta', 'Cliente', 'Transferencia'],
    );
  });

  test('every destination carries the identifier that was typed', () => {
    for (const destination of searchDestinations(`  ${ACCOUNT}  `, 'ADMINISTRADOR')) {
      assert.ok(destination.to.endsWith(ACCOUNT), destination.to);
    }
  });

  test('text that is not an identifier offers nothing at all', () => {
    assert.deepEqual(searchDestinations('José', 'ADMINISTRADOR'), []);
    assert.deepEqual(searchDestinations('', 'ADMINISTRADOR'), []);
  });

  test('nobody signed in is offered nothing', () => {
    assert.deepEqual(searchDestinations(ACCOUNT, null), []);
  });
});

describe('the avatar’s letters', () => {
  test('a separated username yields two', () => {
    assert.equal(initialsOf('jose.mendez'), 'JM');
    assert.equal(initialsOf('ana_lucia'), 'AL');
    assert.equal(initialsOf('marcos bonifasi'), 'MB');
  });

  /**
   * One letter for a username with no separator, on purpose: "JC" cut out of
   * "jcmendez" would be a guess at where the given name ends.
   */
  test('an unseparated username yields one', () => {
    assert.equal(initialsOf('jcmendez'), 'J');
  });

  test('no session yields a placeholder rather than an empty circle', () => {
    assert.equal(initialsOf(null), '·');
    assert.equal(initialsOf(undefined), '·');
    assert.equal(initialsOf('   '), '·');
  });
});
