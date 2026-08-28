import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  GUEST_ONLY_ROUTES,
  MODULES,
  canOpen,
  isGuestOnly,
  labelForRole,
  modulesFor,
  resolveNextPath,
} from '../app/lib/navigation.ts';

// The permission matrix is the one piece of frontend logic that decides
// something, so it lives in a plain module and is asserted here rather than
// hiding in a template where TD-010 would make it unverifiable.

describe('what each role sees in the navigation', () => {
  test('the five modules are the five the spec fixed', () => {
    assert.deepEqual(
      MODULES.map((module) => module.label),
      ['Clientes', 'Cuentas', 'Transferencias', 'Pagos', 'Auditoría'],
    );
  });

  test('a client sees everything except the audit record', () => {
    assert.deepEqual(
      modulesFor('CLIENTE').map((module) => module.label),
      ['Clientes', 'Cuentas', 'Transferencias'],
    );
  });

  /**
   * A teller sees one more than a client: payment monitoring. Not because D-06
   * gives it to them, but because Payment Service cannot scope its own listing
   * and staff is the narrowest audience that still makes the screen useful
   * (TD-037).
   */
  test('a receiving teller also sees the payment monitoring', () => {
    assert.deepEqual(
      modulesFor('CAJERO_RECEPTOR').map((module) => module.label),
      ['Clientes', 'Cuentas', 'Transferencias', 'Pagos'],
    );
  });

  test('an administrator is the only one who sees the audit record', () => {
    assert.deepEqual(
      modulesFor('ADMINISTRADOR').map((module) => module.label),
      ['Clientes', 'Cuentas', 'Transferencias', 'Pagos', 'Auditoría'],
    );

    assert.equal(modulesFor('CLIENTE').some((module) => module.to === '/auditoria'), false);
    assert.equal(
      modulesFor('CAJERO_RECEPTOR').some((module) => module.to === '/auditoria'),
      false,
    );
  });

  test('nobody signed in sees nothing', () => {
    assert.deepEqual(modulesFor(null), []);
  });
});

describe('opening a route directly', () => {
  test('a client cannot render the audit module by typing its address', () => {
    assert.equal(canOpen('CLIENTE', '/auditoria'), false);
    assert.equal(canOpen('CAJERO_RECEPTOR', '/auditoria'), false);
    assert.equal(canOpen('ADMINISTRADOR', '/auditoria'), true);
  });

  /** Including one payment's own detail, which lives under the same module. */
  test('a client cannot render the payment module either', () => {
    assert.equal(canOpen('CLIENTE', '/pagos'), false);
    assert.equal(
      canOpen('CLIENTE', '/pagos/6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93'),
      false,
    );
    assert.equal(canOpen('CAJERO_RECEPTOR', '/pagos'), true);
    assert.equal(canOpen('ADMINISTRADOR', '/pagos'), true);
  });

  test('a nested path under a forbidden module is forbidden too', () => {
    assert.equal(canOpen('CLIENTE', '/auditoria/detalle/abc'), false);
  });

  test('the public routes are open to everyone, session or not', () => {
    for (const route of ['/login', '/registro', '/activar']) {
      assert.equal(canOpen(null, route), true, route);
      assert.equal(canOpen('CLIENTE', route), true, route);
    }
  });

  test('no module is reachable without a session', () => {
    for (const module of MODULES) {
      assert.equal(canOpen(null, module.to), false, module.to);
    }
  });
});

describe('the guest-only routes', () => {
  /**
   * `canOpen` answers "may this role render this path" and stays permissive
   * for the public routes; whether a *signed-in* visitor should still be
   * offered the sign-in or registration form is a different question, and
   * `auth.global.ts` asks it with `isGuestOnly` before consulting `canOpen`.
   */
  test('are the sign-in and the registration, and not the activation link', () => {
    assert.deepEqual(GUEST_ONLY_ROUTES, ['/login', '/registro']);

    assert.equal(isGuestOnly('/login'), true);
    assert.equal(isGuestOnly('/registro'), true);
    // The activation link arrives by email and may be opened in a browser
    // where somebody else is signed in; the token decides, not the session.
    assert.equal(isGuestOnly('/activar'), false);
  });

  test('match by segment, not by prefix string', () => {
    assert.equal(isGuestOnly('/login/whatever'), true);
    assert.equal(isGuestOnly('/loginx'), false);
    assert.equal(isGuestOnly('/registros'), false);
  });

  test('every module is somewhere a session may stay', () => {
    for (const module of MODULES) {
      assert.equal(isGuestOnly(module.to), false, module.to);
    }
  });
});

describe('where to go after signing in', () => {
  test('a same-application path is honoured, query and all', () => {
    assert.equal(resolveNextPath('/transferencias'), '/transferencias');
    assert.equal(resolveNextPath('/cuentas/abc?tab=movimientos'), '/cuentas/abc?tab=movimientos');
  });

  test('anything that is not a same-application path collapses to the landing page', () => {
    assert.equal(resolveNextPath(undefined), '/');
    assert.equal(resolveNextPath(42), '/');
    assert.equal(resolveNextPath(''), '/');
    assert.equal(resolveNextPath('cuentas'), '/');
    assert.equal(resolveNextPath('https://evil.example'), '/');
    // Protocol-relative: browsers read this as "same scheme, that host".
    assert.equal(resolveNextPath('//evil.example'), '/');
    // Some URL parsers treat the backslash as a slash; refuse the family.
    assert.equal(resolveNextPath('/\\evil.example'), '/');
  });

  test('a guest-only destination is discarded — it would bounce anyway', () => {
    assert.equal(resolveNextPath('/login'), '/');
    assert.equal(resolveNextPath('/login?next=%2F'), '/');
    assert.equal(resolveNextPath('/registro'), '/');
  });
});

describe('the matrix agrees with decision D-06', () => {
  /*
   * D-06 restricts only the audit record by role. Everything else it restricts
   * by scope, which neither this file nor the Gateway can evaluate: neither
   * knows who owns what. Those refusals come from the owning service.
   *
   * Pagos is the exception that proves the rule rather than a second reading of
   * D-06. It is restricted because the owning service cannot apply a scope at
   * all — Payment Service holds no customer reference — so the choice was
   * between a role restriction and handing every client every payment in the
   * bank. Recorded as TD-037, and it is the row D-06 will eventually grow.
   */
  test('two modules are role-restricted, and for different reasons', () => {
    const restricted = MODULES.filter((module) => module.roles.length < 3);

    assert.deepEqual(
      restricted.map((module) => module.label),
      ['Pagos', 'Auditoría'],
    );

    assert.deepEqual(
      MODULES.find((module) => module.label === 'Auditoría').roles,
      ['ADMINISTRADOR'],
    );
  });
});

describe('role labels', () => {
  test('are written the way the assignment writes them', () => {
    assert.equal(labelForRole('CLIENTE'), 'Cliente');
    assert.equal(labelForRole('CAJERO_RECEPTOR'), 'Cajero receptor');
    assert.equal(labelForRole('ADMINISTRADOR'), 'Administrador');
  });
});
