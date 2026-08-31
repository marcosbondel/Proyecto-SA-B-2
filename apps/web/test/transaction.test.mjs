import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  CREATION_GRACE_MS,
  FAILURE_REASON_TEXT,
  PAYMENT_SCENARIOS,
  POLL_CEILING_MS,
  POLL_INTERVAL_MS,
  STATUS_PRESENTATION,
  canSend,
  directionOf,
  explainReason,
  isInFlight,
  isTerminal,
  statusFilterOptions,
  meaningOfMissing,
  shouldKeepPolling,
  timelineFor,
  transferProblems,
} from '../app/lib/transaction.ts';

const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

const draft = (overrides = {}) => ({
  sourceAccount: SOURCE,
  targetAccount: TARGET,
  amountMinor: 15_000,
  ...overrides,
});

const EVERY_STATUS = [
  'PENDING',
  'DEBITING',
  'PAYMENT_PENDING',
  'COMPLETED',
  'FAILED',
  'COMPENSATED',
];

describe('what a transfer must satisfy before anything is sent', () => {
  test('accepts two different real accounts and a positive amount', () => {
    assert.deepEqual(transferProblems(draft()), {});
    assert.equal(canSend(draft()), true);
  });

  test('refuses an amount of zero or less', () => {
    assert.equal(transferProblems(draft({ amountMinor: 0 })).amount !== undefined, true);
    assert.equal(transferProblems(draft({ amountMinor: -1 })).amount !== undefined, true);
    assert.equal(transferProblems(draft({ amountMinor: null })).amount !== undefined, true);
    assert.equal(canSend(draft({ amountMinor: 0 })), false);
  });

  test('refuses a transfer to the same account', () => {
    const problems = transferProblems(draft({ targetAccount: SOURCE }));

    assert.equal(problems.targetAccount, 'La cuenta de destino debe ser distinta de la de origen.');
  });

  /**
   * A UUID is case-insensitive, so two spellings of one account are still one
   * account. Comparing the raw strings would let a transfer to yourself through
   * to the Gateway, which would refuse it — a `400` this could have prevented.
   */
  test('sees through a difference of case when comparing the two accounts', () => {
    const problems = transferProblems(draft({ targetAccount: SOURCE.toUpperCase() }));

    assert.equal(problems.targetAccount !== undefined, true);
  });

  test('tolerates surrounding whitespace, which pasting an id produces', () => {
    assert.deepEqual(transferProblems(draft({ sourceAccount: `  ${SOURCE}  ` })), {});
  });

  test('refuses anything the Gateway would answer 400 to', () => {
    assert.equal(transferProblems(draft({ sourceAccount: 'not-a-uuid' })).sourceAccount !== undefined, true);
    assert.equal(transferProblems(draft({ targetAccount: '' })).targetAccount !== undefined, true);
    // Version 1, not 4: the Gateway's own regular expression pins the version.
    assert.equal(
      transferProblems(draft({ sourceAccount: '11111111-1111-1111-8111-111111111111' }))
        .sourceAccount !== undefined,
      true,
    );
  });

  /**
   * "Both accounts are the same" is not a useful complaint while somebody is
   * still typing the second one — at that point both fields are empty and equal.
   */
  test('does not report equality when neither account is an identifier yet', () => {
    const problems = transferProblems({ sourceAccount: '', targetAccount: '', amountMinor: 1 });

    assert.equal(problems.targetAccount, 'Escribe el accountId de la cuenta de destino. Es un UUID de 36 caracteres.');
  });
});

describe('when the screen should keep asking', () => {
  test('knows the three states nothing follows', () => {
    assert.deepEqual(
      EVERY_STATUS.filter(isTerminal),
      ['COMPLETED', 'FAILED', 'COMPENSATED'],
    );
  });

  test('polls exactly while the saga can still move', () => {
    assert.deepEqual(
      EVERY_STATUS.filter(shouldKeepPolling),
      ['PENDING', 'DEBITING', 'PAYMENT_PENDING'],
    );
  });

  /**
   * `POST /api/transfers` answers before Transaction Service has committed the
   * row, so the first query after the redirect legitimately finds nothing.
   * Calling that "no existe" would tell somebody their transfer vanished a
   * second after they sent it.
   */
  test('reads a missing transfer as still being registered, but only briefly', () => {
    assert.equal(meaningOfMissing(0), 'STILL_STARTING');
    assert.equal(meaningOfMissing(CREATION_GRACE_MS - 1), 'STILL_STARTING');
    assert.equal(meaningOfMissing(CREATION_GRACE_MS), 'MISSING');
    assert.equal(meaningOfMissing(60_000), 'MISSING');
  });

  test('gives up long after it has had time to succeed', () => {
    assert.equal(POLL_CEILING_MS > POLL_INTERVAL_MS * 10, true);
    assert.equal(POLL_CEILING_MS > CREATION_GRACE_MS, true);
  });
});

describe('the saga drawn as a line', () => {
  test('always has four steps, whatever happened', () => {
    for (const status of EVERY_STATUS) {
      assert.equal(timelineFor(status).length, 4);
    }
  });

  test('walks forward one step at a time while the transfer is in flight', () => {
    assert.deepEqual(timelineFor('PENDING').map((s) => s.state), [
      'current',
      'pending',
      'pending',
      'pending',
    ]);
    assert.deepEqual(timelineFor('DEBITING').map((s) => s.state), [
      'done',
      'current',
      'pending',
      'pending',
    ]);
    assert.deepEqual(timelineFor('PAYMENT_PENDING').map((s) => s.state), [
      'done',
      'done',
      'current',
      'pending',
    ]);
  });

  test('marks every step done when the money arrived', () => {
    assert.deepEqual(timelineFor('COMPLETED').map((s) => s.state), [
      'done',
      'done',
      'done',
      'done',
    ]);
  });

  /**
   * The two endings are not interchangeable, and the line is where the
   * difference is visible: FAILED broke at the debit and never reached the
   * payment; COMPENSATED got past the debit — that is the whole reason the
   * money moved twice.
   */
  test('fails at the debit for FAILED, and at the payment for COMPENSATED', () => {
    assert.deepEqual(timelineFor('FAILED').map((s) => s.state), [
      'done',
      'failed',
      'skipped',
      'failed',
    ]);
    assert.deepEqual(timelineFor('COMPENSATED').map((s) => s.state), [
      'done',
      'done',
      'failed',
      'failed',
    ]);
  });

  /**
   * A step that will never come must not look like one that is still coming. A
   * pulsing "Pago" node on a transfer that ended thirty seconds ago is a screen
   * that lies about being alive.
   */
  test('never leaves a step pending on a transfer that is over', () => {
    for (const status of ['COMPLETED', 'FAILED', 'COMPENSATED']) {
      const pending = timelineFor(status).filter((step) => step.state === 'pending');

      assert.deepEqual(pending, []);
    }
  });

  test('never leaves a step skipped on a transfer that is still moving', () => {
    for (const status of ['PENDING', 'DEBITING', 'PAYMENT_PENDING']) {
      const skipped = timelineFor(status).filter((step) => step.state === 'skipped');

      assert.deepEqual(skipped, []);
    }
  });

  /**
   * The last node is named after the ending it reached. A final node reading
   * "Completada" in grey next to a red banner reads as a transfer that is
   * about to succeed.
   */
  test('names the last step after the outcome', () => {
    assert.equal(timelineFor('COMPLETED').at(-1).label, 'Completada');
    assert.equal(timelineFor('FAILED').at(-1).label, 'Fallida');
    assert.equal(timelineFor('COMPENSATED').at(-1).label, 'Compensada');
    // A transfer still in flight is heading for success, and naming the other
    // two endings on a transfer that is going fine would alarm for no reason.
    assert.equal(timelineFor('DEBITING').at(-1).label, 'Completada');
  });

  test('has exactly one step in progress while the transfer is in flight', () => {
    for (const status of ['PENDING', 'DEBITING', 'PAYMENT_PENDING']) {
      const current = timelineFor(status).filter((step) => step.state === 'current');

      assert.equal(current.length, 1);
    }
  });
});

describe('what a person is told', () => {
  test('gives every state a label and an explanation', () => {
    for (const status of EVERY_STATUS) {
      assert.equal(typeof STATUS_PRESENTATION[status].label, 'string');
      assert.equal(STATUS_PRESENTATION[status].explanation.length > 20, true);
    }
  });

  /**
   * Both endings leave the customer with their money, and only one of them
   * moved it twice. A shared sentence would make somebody think their account
   * had been debited in error.
   */
  test('says something different for FAILED and for COMPENSATED', () => {
    assert.notEqual(
      STATUS_PRESENTATION.FAILED.explanation,
      STATUS_PRESENTATION.COMPENSATED.explanation,
    );
    assert.match(STATUS_PRESENTATION.COMPENSATED.explanation, /devuelt/i);
    assert.match(STATUS_PRESENTATION.FAILED.explanation, /nunca salió/i);
  });

  test('translates every failure code a transfer can carry', () => {
    const codes = [
      'INSUFFICIENT_FUNDS',
      'ACCOUNT_INACTIVE',
      'ACCOUNT_NOT_FOUND',
      'INVALID_AMOUNT',
      'INVALID_AMOUNT_PRECISION',
      'SAME_ACCOUNT_TRANSFER',
      'IDEMPOTENCY_KEY_CONFLICT',
      'PAYMENT_DECLINED',
      'PAYMENT_RETRIES_EXHAUSTED',
    ];

    for (const code of codes) {
      assert.equal(typeof FAILURE_REASON_TEXT[code], 'string');
      assert.equal(explainReason(code), FAILURE_REASON_TEXT[code]);
    }
  });

  /**
   * The catalogue may gain a code after this file is next touched. Showing the
   * raw code to a customer teaches them nothing.
   */
  test('falls back rather than showing a code nobody can read', () => {
    const fallback = explainReason('SOMETHING_NOBODY_HAS_WRITTEN_YET');

    assert.equal(fallback.includes('SOMETHING_NOBODY'), false);
    assert.match(fallback, /correlación/);
  });

  test('says nothing when there is nothing to explain', () => {
    assert.equal(explainReason(null), null);
  });
});

describe('the demonstration scenarios', () => {
  test('offers exactly the three the Gateway accepts', () => {
    assert.deepEqual(
      PAYMENT_SCENARIOS.map((scenario) => scenario.value),
      ['APPROVE', 'REJECT', 'TRANSIENT_FAILURE'],
    );
  });

  test('explains what each one does to the saga', () => {
    for (const scenario of PAYMENT_SCENARIOS) {
      assert.equal(scenario.description.length > 20, true);
    }

    assert.match(PAYMENT_SCENARIOS[1].description, /COMPENSATED/);
  });
});

/**
 * `T-04`'s table, which is where a row stops being a record and becomes
 * something somebody reads.
 */
describe('how a transfer reads from an account', () => {
  const row = {
    transactionId: '7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70',
    sourceAccount: SOURCE,
    targetAccount: TARGET,
    amount: { amountMinor: 125_000, currency: 'GTQ' },
    status: 'COMPLETED',
    reason: null,
    createdAt: '2026-08-19T14:32:08.100Z',
    completedAt: '2026-08-19T14:32:11.400Z',
  };

  test('money leaving is not money arriving', () => {
    assert.equal(directionOf(row, SOURCE), 'OUT');
    assert.equal(directionOf(row, TARGET), 'IN');
  });

  /**
   * "Out" and "in" are not properties of a transfer — they are properties of
   * looking at one from a particular account. With no account in context (the
   * admin monitor, where rows belong to many people) it is neither.
   */
  test('is neither when there is no account to look from', () => {
    assert.equal(directionOf(row, null), 'NEUTRAL');
    assert.equal(directionOf(row, '00000000-0000-4000-8000-000000000000'), 'NEUTRAL');
  });
});

describe('which transfers are still moving', () => {
  test('the three non-terminal states, and no others', () => {
    for (const status of ['PENDING', 'DEBITING', 'PAYMENT_PENDING']) {
      assert.equal(isInFlight(status), true, status);
    }

    for (const status of ['COMPLETED', 'FAILED', 'COMPENSATED']) {
      assert.equal(isInFlight(status), false, status);
    }
  });
});

describe('the status filter', () => {
  /**
   * Derived from `STATUS_PRESENTATION` rather than restated, so a label can
   * never differ between the filter and the badge it filters for.
   */
  test('offers every state, labelled the way the badge labels it', () => {
    const options = statusFilterOptions();

    assert.equal(options.length, Object.keys(STATUS_PRESENTATION).length);

    for (const option of options) {
      assert.equal(option.label, STATUS_PRESENTATION[option.value].label);
    }
  });
});
