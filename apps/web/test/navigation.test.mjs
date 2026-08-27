import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { MODULES, canOpen, labelForRole, modulesFor } from '../app/lib/navigation.ts';

// The permission matrix is the one piece of frontend logic that decides
// something, so it lives in a plain module and is asserted here rather than
// hiding in a template where TD-010 would make it unverifiable.

describe('what each role sees in the navigation', () => {
  test('the four modules are the four the spec fixed', () => {
    assert.deepEqual(
      MODULES.map((module) => module.label),
      ['Clientes', 'Cuentas', 'Transferencias', 'Auditoría'],
    );
  });

  test('a client sees everything except the audit record', () => {
    assert.deepEqual(
      modulesFor('CLIENTE').map((module) => module.label),
      ['Clientes', 'Cuentas', 'Transferencias'],
    );
  });

  test('a receiving teller sees the same three', () => {
    assert.deepEqual(
      modulesFor('CAJERO_RECEPTOR').map((module) => module.label),
      ['Clientes', 'Cuentas', 'Transferencias'],
    );
  });

  test('an administrator is the only one who sees the audit record', () => {
    assert.deepEqual(
      modulesFor('ADMINISTRADOR').map((module) => module.label),
      ['Clientes', 'Cuentas', 'Transferencias', 'Auditoría'],
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

  test('a nested path under a forbidden module is forbidden too', () => {
    assert.equal(canOpen('CLIENTE', '/auditoria/detalle/abc'), false);
  });

  test('the public routes are open to everyone, session or not', () => {
    for (const route of ['/login', '/registro', '/activar', '/demo']) {
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

describe('the matrix agrees with decision D-06', () => {
  // D-06 restricts only the audit record by role. Everything else it restricts
  // by scope, which neither this file nor the Gateway can evaluate: neither
  // knows who owns what. Those refusals come from the owning service.
  test('exactly one module is role-restricted', () => {
    const restricted = MODULES.filter((module) => module.roles.length < 3);

    assert.equal(restricted.length, 1);
    assert.equal(restricted[0].label, 'Auditoría');
  });
});

describe('role labels', () => {
  test('are written the way the assignment writes them', () => {
    assert.equal(labelForRole('CLIENTE'), 'Cliente');
    assert.equal(labelForRole('CAJERO_RECEPTOR'), 'Cajero receptor');
    assert.equal(labelForRole('ADMINISTRADOR'), 'Administrador');
  });
});
