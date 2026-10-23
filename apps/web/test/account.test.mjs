import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test, describe } from 'node:test';

import {
  ACCOUNT_STATUS_PRESENTATION,
  ACCOUNT_TYPE_PRESENTATION,
  accountReference,
  INACTIVITY_MIN_BALANCE_MINOR,
  INACTIVITY_MONTHS,
  deactivationRisk,
  holderIsName,
  holderLabel,
  isUuidV4,
  mayTakeDeposits,
  outcomeFromAccountAudit,
  totalBalanceMinor,
  OPERATION_PRESENTATION,
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

describe('every kind of operation the ledger records has a name on the statement', () => {
  const primitives = readFileSync(
    new URL('../../packages/contracts/src/schemas/primitives.ts', import.meta.url),
    'utf8',
  );
  const declared = /accountOperationType\s*=\s*z\.enum\(\[([^\]]*)\]\)/.exec(primitives)?.[1]
    ?.match(/'([A-Z_]+)'/g)
    ?.map((quoted) => quoted.slice(1, -1));

  test('reads the kinds from the contract, which is where they are decided', () => {
    assert.ok(declared !== undefined && declared.length >= 4, `read ${JSON.stringify(declared)}`);
  });

  test('has a label and a sign for each of them — a missing one stops the whole statement drawing', () => {
    for (const type of declared ?? []) {
      assert.ok(OPERATION_PRESENTATION[type], `${type} has no entry in OPERATION_PRESENTATION`);
      assert.ok(OPERATION_PRESENTATION[type].label.length > 0);
    }
  });

  test('shows the savings-account commission as money that left, like a debit', () => {
    assert.deepEqual(OPERATION_PRESENTATION.COMMISSION, { label: 'Comisión', sign: '−' });
  });
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

  test('only AHORRO carries a minimum opening deposit (T-27)', () => {
    assert.equal(ACCOUNT_TYPE_PRESENTATION.AHORRO.minimumOpeningDepositMinor, 10_000);
    assert.equal(ACCOUNT_TYPE_PRESENTATION.MONETARIA.minimumOpeningDepositMinor, null);
  });

  test('explains what an inactive account cannot do, rather than only naming it', () => {
    assert.match(ACCOUNT_STATUS_PRESENTATION.INACTIVE.explanation, /debitar/i);
    assert.equal(ACCOUNT_STATUS_PRESENTATION.INACTIVE.color, 'warning');
  });
});

/**
 * TD-026, on the frontend side. The name is optional because the composition
 * that produces it can fail — a client asking, a timeout, a broker that is
 * away — and the interesting case is exactly the failing one, which a template
 * expression would make invisible (TD-010).
 */
describe('what a "Titular" cell shows', () => {
  test('the name when the Gateway resolved one', () => {
    const withName = account({ holderName: 'María Fernanda López' });

    assert.equal(holderLabel(withName), 'María Fernanda López');
    assert.equal(holderIsName(withName), true);
  });

  test('the identifier when it did not, rather than an empty cell', () => {
    const withoutName = account();

    assert.equal(holderLabel(withoutName), withoutName.customerId);
    assert.equal(holderIsName(withoutName), false);
  });
});

describe('who may register a deposit at a window', () => {
  test('staff, and no client', () => {
    assert.equal(mayTakeDeposits('CAJERO_RECEPTOR'), true);
    assert.equal(mayTakeDeposits('ADMINISTRADOR'), true);
    assert.equal(mayTakeDeposits('CLIENTE'), false);
    assert.equal(mayTakeDeposits(null), false);
  });
});

describe('how a selector refers to an account (T-60)', () => {
  const accountId = 'b0000000-0000-4000-8000-000000000003';

  test('shows the account number and keeps the tail of the identifier', () => {
    assert.equal(accountReference({ accountId, accountNumber: '02-000000008' }), '02-000000008 · ···000003');
  });

  test('without a number, says only what it said before', () => {
    assert.equal(accountReference({ accountId }), '···000003');
  });

  test('treats an empty number as absent', () => {
    assert.equal(accountReference({ accountId, accountNumber: '' }), '···000003');
  });
});
