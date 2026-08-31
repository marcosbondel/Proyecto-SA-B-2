import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { alertsFrom, dashboardFor, isBlank } from '../app/lib/dashboard.ts';

/**
 * `D-01` and `D-02`'s two decisions, in a plain module so they are testable
 * despite TD-010: which dashboard a role lands on, and what counts as worth
 * putting at the top of the administrator's.
 */

const empty = {
  customers: null,
  accounts: null,
  transfers: null,
  payments: null,
  audit: null,
};

const transfers = (overrides = {}) => ({
  today: 0,
  completedToday: 0,
  failedToday: 0,
  compensatedToday: 0,
  inFlight: 0,
  ...overrides,
});

describe('which dashboard a role lands on', () => {
  /**
   * One route and three dashboards, rather than three routes. "Where do I land"
   * must not be a URL somebody can be sent to by mistake.
   */
  test('each role gets its own', () => {
    assert.equal(dashboardFor('CLIENTE'), 'CLIENT');
    assert.equal(dashboardFor('CAJERO_RECEPTOR'), 'TELLER');
    assert.equal(dashboardFor('ADMINISTRADOR'), 'ADMIN');
  });

  test('no session gets none', () => {
    assert.equal(dashboardFor(null), null);
  });
});

describe('what is worth alerting on', () => {
  test('nothing, when nothing is happening', () => {
    assert.deepEqual(alertsFrom({ ...empty, transfers: transfers() }), []);
  });

  /**
   * Money in flight is first because a transfer stuck after its debit is money
   * that has left an account and not arrived. The ordering is the alert's whole
   * value on a screen somebody scans.
   */
  test('money in flight outranks everything else', () => {
    const alerts = alertsFrom({
      ...empty,
      transfers: transfers({ inFlight: 3, compensatedToday: 9 }),
      audit: {
        eventsToday: 100,
        invalidToday: 4,
        notificationsToday: 10,
        lastEventType: null,
        lastEventAt: null,
      },
    });

    assert.equal(alerts[0].severity, 'HIGH');
    assert.match(alerts[0].title, /en vuelo/);
    assert.equal(alerts.at(-1).severity, 'LOW');
  });

  test('a retrying payment is high severity and points at the payment monitor', () => {
    const alerts = alertsFrom({
      ...empty,
      payments: { today: 5, succeededToday: 3, failedToday: 1, retrying: 1 },
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'HIGH');
    assert.equal(alerts[0].to, '/pagos/monitor');
  });

  /**
   * A section that did not answer is `null`, and `null` is not zero — an alert
   * derived from a missing section would be an alarm about nothing.
   */
  test('a section that did not answer raises nothing', () => {
    assert.deepEqual(alertsFrom(empty), []);
  });
});

describe('a dashboard with nothing in it', () => {
  test('is blank only when every section is missing', () => {
    assert.equal(isBlank(empty), true);
    assert.equal(isBlank({ ...empty, transfers: transfers() }), false);
  });
});
