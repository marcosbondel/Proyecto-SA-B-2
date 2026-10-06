import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test, describe } from 'node:test';

import { mayQueryAudit } from '../app/lib/audit.ts';
import { mayManageAccounts, mayTakeDeposits } from '../app/lib/account.ts';
import { mayMonitorPayments } from '../app/lib/payment.ts';
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
    assert.equal(mayQueryAudit('ADMINISTRADOR'), true);
    assert.equal(mayQueryAudit('CAJERO_RECEPTOR'), false);
    assert.equal(mayQueryAudit('CLIENTE'), false);
  });

  /**
   * The notifications console, added by T-20. D-06 grants "read the audit
   * record **and notifications**" as one permission, so it is nested under the
   * same controller and guarded by the same role rather than given a fifth
   * navigation entry — the module already exists, and `/auditoria/notificaciones`
   * is inside it, which `canOpen` matches by prefix.
   */
  test('the Gateway restricts the notifications console to the same role', async () => {
    const source = await readFile(AUDIT_CONTROLLER, 'utf8');

    assert.match(
      source,
      /@Roles\('ADMINISTRADOR'\)\s*\n\s*@Get\('notifications'\)/,
      'the notifications console no longer restricts itself to ADMINISTRADOR',
    );
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
      /@Roles\('ADMINISTRADOR',\s*'CAJERO_RECEPTOR',\s*'CLIENTE'\)\s*\n\s*@Post\(':accountId\/status'\)/,
      'the manual status change matches authorized roles',
    );

    assert.equal(mayManageAccounts('ADMINISTRADOR'), true);
    assert.equal(mayManageAccounts('CAJERO_RECEPTOR'), true);
    assert.equal(mayManageAccounts('CLIENTE'), false);
    assert.equal(mayManageAccounts(null), false);
  });

  /**
   * The third role-restricted route, added by T-19, and the only one restricted
   * because its owning service **cannot** narrow the answer itself.
   *
   * Account Service intersects a listing with what the asker owns. Payment
   * Service holds a `transactionId` and no customer reference at all, so an
   * unrestricted `GET /api/payments` would hand every authenticated client
   * every payment in the bank. That is why this one is a navigation entry and
   * `mayManageAccounts` is not: the whole module is staff work, not one screen
   * inside a module everybody shares.
   */
  test('the Gateway restricts the payment listing to staff', async () => {
    const source = await readFile(
      new URL('../../gateway/src/interfaces/payments.controller.ts', import.meta.url),
      'utf8',
    );

    assert.match(
      source,
      /@Roles\('CAJERO_RECEPTOR', 'ADMINISTRADOR'\)\s*\n\s*@Get\(\)/,
      'the payment listing no longer restricts itself to staff',
    );

    // The single-payment route stays open, like the transfer status it mirrors.
    // The other two restricted routes are the administrator's simulation dial
    // (T-44), pinned by the next test: three decorators in all, and no more.
    assert.equal((source.match(/@Roles\(/g) ?? []).length, 3);

    /*
     * The module itself is no longer restricted — paying a bill is what a
     * client does, and the front door reads the *transfer* listing, which
     * Transaction Service scopes. What stays staff-only is Payment Service's
     * own listing and the screen that reads it, which is what
     * `mayMonitorPayments` guards.
     */
    const pagos = MODULES.find((module) => module.to === '/pagos');

    assert.deepEqual(pagos.roles, ['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR']);

    assert.equal(mayMonitorPayments('CAJERO_RECEPTOR'), true);
    assert.equal(mayMonitorPayments('ADMINISTRADOR'), true);
    assert.equal(mayMonitorPayments('CLIENTE'), false);
    assert.equal(mayMonitorPayments(null), false);
  });

  /**
   * The fourth and fifth role-restricted routes, added by T-44: reading and
   * changing how the simulated payment provider misbehaves. `ADMINISTRADOR`
   * alone, because changing it changes what every customer's payment does.
   *
   * There is **no screen** for it, so the frontend matrix has nothing to grow:
   * no navigation entry and no `may…` helper to offer a button that would fail.
   * This test is the other half of that decision — if a screen is ever built, it
   * has to filter on this role, and the route below is what it must agree with.
   */
  test('the Gateway restricts the payment simulation dial to ADMINISTRADOR', async () => {
    const source = await readFile(
      new URL('../../gateway/src/interfaces/payments.controller.ts', import.meta.url),
      'utf8',
    );

    assert.match(
      source,
      /@Roles\('ADMINISTRADOR'\)\s*\n\s*@Get\('simulation'\)/,
      'reading the payment simulation no longer restricts itself to ADMINISTRADOR',
    );
    assert.match(
      source,
      /@Roles\('ADMINISTRADOR'\)\s*\n\s*@Put\('simulation'\)/,
      'changing the payment simulation no longer restricts itself to ADMINISTRADOR',
    );
  });

  test('no other Gateway controller restricts by role', async () => {
    // If a fourth route grows a @Roles decorator, the frontend matrix has to
    // grow with it — and this failing is how anyone finds out.
    const controllers = ['auth.controller.ts', 'transfers.controller.ts'];

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

    /*
     * The accounts controller restricts two of its six routes, and the second
     * one is a *screen* inside a module everybody shares rather than a seventh
     * navigation entry — the deposit window, which only staff may use. So the
     * module matrix below is unchanged and `mayTakeDeposits` carries it, the
     * same shape `mayManageAccounts` already had for the manual status change.
     */
    const accounts = await readFile(
      new URL('../../gateway/src/interfaces/accounts.controller.ts', import.meta.url),
      'utf8',
    );

    assert.equal((accounts.match(/@Roles\(/g) ?? []).length, 2);

    assert.match(
      accounts,
      /@Roles\('CAJERO_RECEPTOR', 'ADMINISTRADOR'\)\s*\n\s*@Post\(':accountId\/deposit'\)/,
      'the deposit window no longer restricts itself to staff',
    );

    assert.equal(mayTakeDeposits('CAJERO_RECEPTOR'), true);
    assert.equal(mayTakeDeposits('ADMINISTRADOR'), true);
    assert.equal(mayTakeDeposits('CLIENTE'), false);
    assert.equal(mayTakeDeposits(null), false);

    // The customers controller restricts exactly five routes to staff: the general
    // directory listing, the teller's pending-validation queue, the manual identity verdict,
    // the manual KYC verdict (T-31), and reading the identity document itself.
    const customers = await readFile(
      new URL('../../gateway/src/interfaces/customers.controller.ts', import.meta.url),
      'utf8',
    );

    assert.equal((customers.match(/@Roles\('CAJERO_RECEPTOR', 'ADMINISTRADOR'\)/g) ?? []).length, 5);

    // One module is restricted: Auditoría, by D-06 outright. Pagos was the
    // second until the service-payment product moved the unscoped listing
    // behind a screen inside the module.
    const restricted = MODULES.filter((module) => module.roles.length < 3);

    assert.deepEqual(restricted.map((module) => module.to), ['/auditoria']);
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
