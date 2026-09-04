import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  GUEST_ONLY_ROUTES,
  MODULES,
  PUBLIC_ROUTES,
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
  /**
   * Six entries: the five modules the spec fixed, preceded by the landing page.
   * The prototype's three role navigations all open with "Inicio", and putting
   * it in the same list is what keeps one matrix deciding the whole rail —
   * a second, unfiltered entry drawn straight in the template would be exactly
   * the untestable authorization logic this file exists to avoid.
   */
  test('the five modules are the five the spec fixed, behind the landing page', () => {
    assert.deepEqual(
      MODULES.map((module) => module.label),
      ['Inicio', 'Clientes', 'Cuentas', 'Transferencias', 'Pagos', 'Auditoría'],
    );
  });

  /**
   * Pagos joined the client's list when the service-payment product landed. It
   * was staff-only for one ticket because the module *was* Payment Service's
   * unscoped listing (TD-037); that listing is now a screen inside the module,
   * and the front door is the customer's own service payments, read from the
   * transfer listing that Transaction Service scopes.
   */
  test('a client sees everything except the audit record', () => {
    assert.deepEqual(
      modulesFor('CLIENTE').map((module) => module.label),
      ['Inicio', 'Clientes', 'Cuentas', 'Transferencias', 'Pagos'],
    );
  });

  /**
   * A teller sees one more than a client: payment monitoring. Not because D-06
   * gives it to them, but because Payment Service cannot scope its own listing
   * and staff is the narrowest audience that still makes the screen useful
   * (TD-037).
   */
  test('a receiving teller sees the same five', () => {
    assert.deepEqual(
      modulesFor('CAJERO_RECEPTOR').map((module) => module.label),
      ['Inicio', 'Clientes', 'Cuentas', 'Transferencias', 'Pagos'],
    );
  });

  test('an administrator is the only one who sees the audit record', () => {
    assert.deepEqual(
      modulesFor('ADMINISTRADOR').map((module) => module.label),
      ['Inicio', 'Usuarios', 'Cuentas', 'Transferencias', 'Pagos', 'Auditoría'],
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

  /**
   * A client may open the payment module now — paying a bill is what a client
   * does. The staff-only part is the monitor *screen*, which filters in the
   * page against `mayMonitorPayments` rather than in this matrix
   * (`docs/FRONTEND.md`).
   */
  test('every role can render the payment module', () => {
    assert.equal(canOpen('CLIENTE', '/pagos'), true);
    assert.equal(canOpen('CLIENTE', '/pagos/nuevo'), true);
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

    // The reset link is the same case. And `/recuperar` is not guest-only
    // either: being unable to sign in and having a stale session open in a tab
    // are not mutually exclusive, and bouncing that person to the landing page
    // would leave them with no way to ask for a new password at all.
    assert.equal(isGuestOnly('/restablecer'), false);
    assert.equal(isGuestOnly('/recuperar'), false);
  });

  test('the password-recovery screens need no session', () => {
    for (const route of ['/recuperar', '/restablecer']) {
      assert.equal(PUBLIC_ROUTES.includes(route), true, route);
      assert.equal(canOpen(null, route), true, route);
    }
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
   * Pagos was a second restricted entry for one ticket, because the module *was*
   * Payment Service's unscoped listing (TD-037). It is not any more: the front
   * door is a customer's own service payments, read from the transfer listing
   * that Transaction Service scopes, and the unscoped listing is a staff-only
   * screen inside the module. So the matrix is back to what D-06 actually says.
   */
  test('exactly one module is role-restricted, and D-06 is why', () => {
    const restricted = MODULES.filter((module) => module.roles.length < 3);

    assert.deepEqual(
      restricted.map((module) => module.label),
      ['Auditoría'],
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
