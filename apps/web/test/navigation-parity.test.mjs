import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test, describe } from 'node:test';

import { mayManageAccounts } from '../app/lib/account.ts';
import { MODULES } from '../app/lib/navigation.ts';

/**
 * The frontend's matrix and the Gateway's are two materialisations of the same
 * decision, D-06. Two copies of an authorization rule is one copy too many:
 * they drift, and the drift is invisible until somebody is offered a button
 * that fails or — worse — is quietly denied something that is theirs.
 *
 * Nothing can make them the same object: one runs in a browser and the other in
 * a NestJS process, and they are in different packages. What a test *can* do is
 * fail the moment they stop agreeing, which is what this does — reading the
 * Gateway's own decorators and the recorded decision, not a restatement of
 * either.
 */

const AUDIT_CONTROLLER = new URL(
  '../../gateway/src/interfaces/audit.controller.ts',
  import.meta.url,
);

const ACTORS_DOC = new URL('../../../docs/domain/actors.md', import.meta.url);

describe('the frontend matrix agrees with the Gateway', () => {
  test('the Gateway restricts the audit route to ADMINISTRADOR', async () => {
    const source = await readFile(AUDIT_CONTROLLER, 'utf8');

    assert.match(
      source,
      /@Roles\('ADMINISTRADOR'\)/,
      'the audit controller no longer restricts itself to ADMINISTRADOR',
    );

    const auditoria = MODULES.find((module) => module.to === '/auditoria');

    assert.deepEqual(auditoria.roles, ['ADMINISTRADOR']);
  });

  /**
   * T-17 added a second role-restricted route: deactivating an account by hand.
   * D-06 gives it to `ADMINISTRADOR` alone, and the frontend reflects it with
   * `mayManageAccounts` rather than with a fifth navigation entry — the four
   * modules are fixed, and a module that needs a role-restricted screen filters
   * in the page (`docs/FRONTEND.md`).
   */
  test('the Gateway restricts the manual status change to ADMINISTRADOR', async () => {
    const source = await readFile(
      new URL('../../gateway/src/interfaces/accounts.controller.ts', import.meta.url),
      'utf8',
    );

    assert.match(
      source,
      /@Roles\('ADMINISTRADOR'\)\s*\n\s*@Post\(':accountId\/status'\)/,
      'the manual status change no longer restricts itself to ADMINISTRADOR',
    );

    assert.equal(mayManageAccounts('ADMINISTRADOR'), true);
    assert.equal(mayManageAccounts('CAJERO_RECEPTOR'), false);
    assert.equal(mayManageAccounts('CLIENTE'), false);
    assert.equal(mayManageAccounts(null), false);
  });

  test('no other Gateway controller restricts by role', async () => {
    // If a third route grows a @Roles decorator, the frontend matrix has to
    // grow with it — and this failing is how anyone finds out.
    const controllers = ['auth.controller.ts', 'customers.controller.ts', 'transfers.controller.ts'];

    for (const name of controllers) {
      const source = await readFile(
        new URL(`../../gateway/src/interfaces/${name}`, import.meta.url),
        'utf8',
      );

      assert.equal(
        /@Roles\(/.test(source),
        false,
        `${name} now restricts by role; app/lib/ must say so too`,
      );
    }

    // The accounts controller restricts exactly one of its five routes.
    const accounts = await readFile(
      new URL('../../gateway/src/interfaces/accounts.controller.ts', import.meta.url),
      'utf8',
    );

    assert.equal((accounts.match(/@Roles\(/g) ?? []).length, 1);

    const restricted = MODULES.filter((module) => module.roles.length < 3);

    assert.equal(restricted.length, 1);
  });
});

describe('the matrix agrees with the recorded decision', () => {
  test('D-06 still gives the audit record to the administrator alone', async () => {
    const markdown = await readFile(ACTORS_DOC, 'utf8');
    const row = markdown
      .split('\n')
      .find((line) => line.includes('Read the audit record'));

    assert.ok(row, 'decision D-06 no longer has a row for the audit record');

    // The row reads: | use case | CLIENTE | CAJERO | ADMIN |
    const marks = row
      .split('|')
      .slice(2, 5)
      .map((cell) => cell.trim());

    assert.deepEqual(marks, ['✘', '✘', '✔']);
  });
});
