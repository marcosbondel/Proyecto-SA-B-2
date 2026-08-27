import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  ACCOUNT_STATUS_PRESENTATION,
  ACCOUNT_TYPE_PRESENTATION,
  INACTIVITY_MIN_BALANCE_MINOR,
  INACTIVITY_MONTHS,
  deactivationRisk,
  isUuidV4,
  outcomeFromAccountAudit,
  totalBalanceMinor,
} from '../app/lib/account.ts';

const NOW = new Date('2026-08-26T12:00:00.000Z');

const account = (overrides = {}) => ({
  accountId: '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60',
  customerId: '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60',
  accountType: 'MONETARIA',
  balance: { amountMinor: 0, currency: 'GTQ' },
  status: 'ACTIVE',
  lastActivityAt: '2026-02-26T12:00:00.000Z',
  openedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('an identifier worth sending', () => {
  test('accepts a UUID v4, in either case, with surrounding space', () => {
    assert.equal(isUuidV4('3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60'), true);
    assert.equal(isUuidV4('  3A7D9E14-6B25-4F83-9C01-8E5A2D7B4F60  '), true);
  });

  test('refuses anything the Gateway would answer 400 to', () => {
    // Version 1, not 4 — the Gateway's own regular expression pins the version,
    // so accepting it here would only move the refusal further away.
    assert.equal(isUuidV4('3a7d9e14-6b25-1f83-9c01-8e5a2d7b4f60'), false);
    assert.equal(isUuidV4('not-a-uuid'), false);
    assert.equal(isUuidV4(''), false);
    assert.equal(isUuidV4('3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f6'), false);
  });
});

/**
 * The same four boundaries the service asserts on its own side.
 *
 * They are duplicated on purpose — `apps/web` depends on no service — and this
 * suite is what keeps the duplicate honest. A warning that disagreed with the
 * job would tell somebody their account is safe on the day it is deactivated.
 */
describe('the deactivation warning, at the boundaries the service uses', () => {
  test('mirrors the service constants: six months, Q 50.00', () => {
    assert.equal(INACTIVITY_MONTHS, 6);
    assert.equal(INACTIVITY_MIN_BALANCE_MINOR, 5000);
  });

  test('does not warn at a balance of exactly Q 50.00 — "menor a" is strict', () => {
    const risk = deactivationRisk(account({ balance: { amountMinor: 5000, currency: 'GTQ' } }), NOW);

    assert.equal(risk.atRisk, false);
  });

  test('warns one centavo below Q 50.00', () => {
    const risk = deactivationRisk(account({ balance: { amountMinor: 4999, currency: 'GTQ' } }), NOW);

    assert.equal(risk.atRisk, true);
  });

  test('puts the deactivation exactly six months after the last movement', () => {
    const risk = deactivationRisk(account({ lastActivityAt: '2026-08-26T12:00:00.000Z' }), NOW);

    assert.equal(risk.deactivatesOn.toISOString(), '2027-02-26T12:00:00.000Z');
    assert.equal(risk.daysRemaining, 184);
  });

  test('clamps rather than rolling over a short February, as the job does', () => {
    // 31 August plus six months is 31 February, which rolls over to 3 March.
    // Clamping to the 28th is what "six months later" means to a person, and
    // it is what `inactivityThreshold` does in reverse.
    const risk = deactivationRisk(account({ lastActivityAt: '2026-08-31T00:00:00.000Z' }), NOW);

    assert.equal(risk.deactivatesOn.toISOString(), '2027-02-28T00:00:00.000Z');
  });

  test('never warns about an account that already has money in it', () => {
    const rich = account({
      balance: { amountMinor: 100000, currency: 'GTQ' },
      lastActivityAt: '2020-01-01T00:00:00.000Z',
    });

    assert.equal(deactivationRisk(rich, NOW).atRisk, false);
  });

  test('never warns about an account that is already inactive', () => {
    const asleep = account({ status: 'INACTIVE', lastActivityAt: '2020-01-01T00:00:00.000Z' });

    assert.equal(deactivationRisk(asleep, NOW).atRisk, false);
  });

  test('counts from the opening for an account that never moved', () => {
    const untouched = account({ lastActivityAt: null, openedAt: '2026-08-26T12:00:00.000Z' });

    assert.equal(deactivationRisk(untouched, NOW).deactivatesOn.toISOString(), '2027-02-26T12:00:00.000Z');
  });

  test('reports a negative countdown once the account already qualifies', () => {
    const overdue = account({ lastActivityAt: '2026-01-01T00:00:00.000Z' });

    assert.ok(deactivationRisk(overdue, NOW).daysRemaining < 0);
  });
});

describe('how an opening ended, read from the audit trail', () => {
  test('waits while the trail says nothing conclusive', () => {
    assert.equal(outcomeFromAccountAudit([{ messageType: 'account.create.v1' }]), null);
    assert.equal(outcomeFromAccountAudit([]), null);
  });

  test('reads account.opened.v1 as success', () => {
    assert.equal(
      outcomeFromAccountAudit([
        { messageType: 'account.create.v1' },
        { messageType: 'account.opened.v1' },
      ]),
      'SUCCESS',
    );
  });

  /**
   * The message T-17 added. Without it a refused opening produced silence, and
   * the interface reported a timeout for something already decided.
   */
  test('reads account.open.rejected.v1 as a business rejection', () => {
    assert.equal(
      outcomeFromAccountAudit([{ messageType: 'account.open.rejected.v1' }]),
      'BUSINESS_REJECTION',
    );
  });

  test('ignores messages from other flows in the same correlation', () => {
    assert.equal(
      outcomeFromAccountAudit([
        { messageType: 'customer.registered.v1' },
        { messageType: 'account.debited.v1' },
      ]),
      null,
    );
  });
});

describe('the consolidated total', () => {
  test('adds minor units, never decimals', () => {
    const accounts = [
      account({ balance: { amountMinor: 7, currency: 'GTQ' } }),
      account({ balance: { amountMinor: 1999, currency: 'GTQ' } }),
      account({ balance: { amountMinor: 100049, currency: 'GTQ' } }),
    ];

    assert.equal(totalBalanceMinor(accounts), 102055);
  });

  test('is Q 0.00 for somebody with no accounts', () => {
    assert.equal(totalBalanceMinor([]), 0);
  });
});

describe('the words the interface uses', () => {
  /**
   * The prototype's Ahorro card says "Genera intereses". Decision D-02 gives
   * the two types no differentiated rule (TD-017), so promising interest would
   * be inventing a product. This test is what stops the prototype's copy being
   * pasted back in during a later polish pass.
   */
  test('promises no interest on a savings account, because the model gives it none', () => {
    for (const presentation of Object.values(ACCOUNT_TYPE_PRESENTATION)) {
      assert.doesNotMatch(presentation.description, /inter[eé]s|intereses|tasa/i);
    }
  });

  test('names both account types the assignment defines, and no others', () => {
    assert.deepEqual(Object.keys(ACCOUNT_TYPE_PRESENTATION).sort(), ['AHORRO', 'MONETARIA']);
  });

  test('explains what an inactive account cannot do, rather than only naming it', () => {
    assert.match(ACCOUNT_STATUS_PRESENTATION.INACTIVE.explanation, /debitar/i);
    assert.equal(ACCOUNT_STATUS_PRESENTATION.INACTIVE.color, 'warning');
  });
});
