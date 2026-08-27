import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test, describe } from 'node:test';

import {
  ERROR_TYPE_PRESENTATION,
  MAX_ATTEMPTS,
  POLL_CEILING_MS,
  RETRY_LADDER_MS,
  VERDICT_PRESENTATION,
  attemptProgress,
  formatDelay,
  isRetrying,
  mayMonitorPayments,
  nextRetryDelayMs,
  shouldKeepPolling,
  signalsOf,
  summariseFailures,
  verdictOf,
} from '../app/lib/payment.ts';

const signals = (overrides = {}) => ({
  status: 'FAILED',
  errorType: null,
  failureReason: null,
  attempt: null,
  ...overrides,
});

const row = (overrides = {}) => ({
  paymentId: '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
  transactionId: '9b2d4e70-1c3a-4f52-8d61-0a7b3c9e5d24',
  status: 'SUCCEEDED',
  amount: { amountMinor: 125_000, currency: 'GTQ' },
  attempt: 1,
  errorType: null,
  failureReason: null,
  providerReference: null,
  scenario: null,
  originCorrelationId: null,
  createdAt: '2026-08-19T14:32:08.100Z',
  updatedAt: '2026-08-19T14:32:09.100Z',
  decidedAt: '2026-08-19T14:32:09.100Z',
  ...overrides,
});

describe('which of the four endings a payment reached', () => {
  test('a payment still running is processing, whatever else it carries', () => {
    assert.equal(verdictOf(signals({ status: 'PENDING' })), 'PROCESSING');
    assert.equal(
      verdictOf(signals({ status: 'PENDING', errorType: 'TRANSIENT', attempt: 2 })),
      'PROCESSING',
    );
  });

  test('a payment that went through is approved', () => {
    assert.equal(verdictOf(signals({ status: 'SUCCEEDED' })), 'APPROVED');
  });

  test('a permanent failure is a rejection, a transient one is not', () => {
    assert.equal(verdictOf(signals({ errorType: 'PERMANENT' })), 'REJECTED');
    assert.equal(verdictOf(signals({ errorType: 'TRANSIENT' })), 'FAILED');
  });

  /**
   * The distinction the whole module exists for. `REJECTED` tells somebody not
   * to bother trying again; `FAILED` tells them it is worth it. Getting these
   * two the wrong way round is the most expensive mistake this file can make.
   */
  test('the two failures are never the same verdict', () => {
    const rejected = verdictOf(signals({ errorType: 'PERMANENT' }));
    const failed = verdictOf(signals({ errorType: 'TRANSIENT' }));

    assert.notEqual(rejected, failed);
    assert.notEqual(
      VERDICT_PRESENTATION[rejected].explanation,
      VERDICT_PRESENTATION[failed].explanation,
    );
  });

  test('the failure code decides when the policy said nothing', () => {
    assert.equal(verdictOf(signals({ failureReason: 'PAYMENT_DECLINED' })), 'REJECTED');
    assert.equal(verdictOf(signals({ failureReason: 'PAYMENT_RETRIES_EXHAUSTED' })), 'FAILED');
  });

  /**
   * The policy's own statement beats an inference drawn from the code. They
   * normally agree; when they do not, the one that is not guessing wins.
   */
  test('the error kind outranks the failure code when they disagree', () => {
    assert.equal(
      verdictOf(signals({ errorType: 'TRANSIENT', failureReason: 'PAYMENT_DECLINED' })),
      'FAILED',
    );
    assert.equal(
      verdictOf(signals({ errorType: 'PERMANENT', failureReason: 'PAYMENT_RETRIES_EXHAUSTED' })),
      'REJECTED',
    );
  });

  /**
   * Claiming a refusal nobody recorded puts words in a provider's mouth.
   * Admitting the system gave up is the smaller claim and the true one.
   */
  test('a failure with nothing to say is a technical failure, not a refusal', () => {
    assert.equal(verdictOf(signals()), 'FAILED');
  });

  test('every verdict says out loud what happened to the money', () => {
    for (const presentation of Object.values(VERDICT_PRESENTATION)) {
      assert.ok(presentation.label.length > 0);
      assert.ok(presentation.headline.length > 0);
      assert.match(presentation.explanation, /dinero|crédito/i);
    }
  });
});

describe('whether a retry is under way', () => {
  /**
   * A payment that is still pending and already carries the kind of a failure
   * is one whose attempt did not work and whose next has not happened. That is
   * the only moment the retry policy is visible from outside.
   */
  test('pending with a transient failure behind it is retrying', () => {
    assert.equal(isRetrying(signals({ status: 'PENDING', errorType: 'TRANSIENT' })), true);
  });

  test('pending with nothing behind it is a first attempt, not a retry', () => {
    assert.equal(isRetrying(signals({ status: 'PENDING' })), false);
  });

  /** The policy does not retry those, so neither does the sentence. */
  test('a permanent failure is never retrying, even while pending', () => {
    assert.equal(isRetrying(signals({ status: 'PENDING', errorType: 'PERMANENT' })), false);
  });

  test('a finished payment is never retrying', () => {
    for (const status of ['SUCCEEDED', 'FAILED']) {
      assert.equal(isRetrying(signals({ status, errorType: 'TRANSIENT', attempt: 2 })), false);
    }
  });

  test('the wait comes from the ladder, rung by rung', () => {
    const retrying = (attempt) => signals({ status: 'PENDING', errorType: 'TRANSIENT', attempt });

    assert.equal(nextRetryDelayMs(retrying(1)), RETRY_LADDER_MS[0]);
    assert.equal(nextRetryDelayMs(retrying(2)), RETRY_LADDER_MS[1]);
    assert.equal(nextRetryDelayMs(retrying(3)), RETRY_LADDER_MS[2]);
  });

  test('the ladder runs out rather than wrapping around', () => {
    const spent = signals({ status: 'PENDING', errorType: 'TRANSIENT', attempt: MAX_ATTEMPTS });

    assert.equal(nextRetryDelayMs(spent), null);
  });

  test('a payment that is not retrying has no next attempt', () => {
    assert.equal(nextRetryDelayMs(signals({ status: 'FAILED', attempt: 4 })), null);
  });

  test('a wait reads as seconds', () => {
    assert.equal(formatDelay(1_000), '1 segundo');
    assert.equal(formatDelay(30_000), '30 segundos');
  });
});

describe('the retry counter', () => {
  /** "intento 1 de 4" on a clean payment is noise dressed as diagnostics. */
  test('says nothing about a first attempt', () => {
    assert.equal(attemptProgress(signals({ attempt: 1 })), null);
    assert.equal(attemptProgress(signals({ attempt: null })), null);
  });

  test('counts attempts, not retries', () => {
    assert.deepEqual(attemptProgress(signals({ attempt: 3 })), {
      attempt: 3,
      of: 4,
      exhausted: false,
    });
  });

  test('knows when the ladder is spent', () => {
    assert.deepEqual(attemptProgress(signals({ attempt: 4 })), {
      attempt: 4,
      of: 4,
      exhausted: true,
    });
  });

  /**
   * A fifth attempt would be a bug in Payment Service. Rendering "intento 5 de
   * 4" would make the interface look like the broken thing instead.
   */
  test('clamps a count the service should never have sent', () => {
    assert.deepEqual(attemptProgress(signals({ attempt: 9 })), {
      attempt: 4,
      of: 4,
      exhausted: true,
    });
  });
});

describe('the copy of the retry ladder agrees with the contracts', () => {
  /**
   * `apps/web` does not depend on `@bank/contracts`, so the ladder is restated
   * here. What keeps the restatement honest is this test rather than
   * discipline: change `RETRY_DELAYS_MS` in the contracts package and the
   * frontend's "espera 30 segundos" becomes a lie the moment nobody checks.
   */
  test('the delays are the ones the topology declares', async () => {
    const source = await readFile(
      new URL('../../packages/contracts/src/routing/topology.ts', import.meta.url),
      'utf8',
    );

    const match = /export const RETRY_DELAYS_MS = \[([^\]]+)\]/.exec(source);

    assert.ok(match, 'the contracts package no longer declares RETRY_DELAYS_MS');

    const declared = match[1]
      .split(',')
      .map((entry) => Number(entry.trim().replaceAll('_', '')))
      .filter((value) => Number.isFinite(value));

    assert.deepEqual([...RETRY_LADDER_MS], declared);
    assert.equal(MAX_ATTEMPTS, declared.length + 1);
  });

  /** Stopping before the ladder is spent reports "no sabemos" about a payment
   * that was still on schedule. */
  test('the polling ceiling outlasts the whole ladder', () => {
    const ladder = RETRY_LADDER_MS.reduce((total, delay) => total + delay, 0);

    assert.ok(POLL_CEILING_MS > ladder);
  });

  test('nothing is followed once a payment has stopped moving', () => {
    assert.equal(shouldKeepPolling('PENDING'), true);
    assert.equal(shouldKeepPolling('SUCCEEDED'), false);
    assert.equal(shouldKeepPolling('FAILED'), false);
  });
});

describe('the two kinds of failure, said out loud', () => {
  test('each one answers whether anything is still going to happen', () => {
    assert.match(ERROR_TYPE_PRESENTATION.TRANSIENT.explanation, /reintent/i);
    assert.match(ERROR_TYPE_PRESENTATION.PERMANENT.explanation, /No se reintenta/i);
  });
});

describe('who may open the monitoring screen', () => {
  test('staff may', () => {
    assert.equal(mayMonitorPayments('CAJERO_RECEPTOR'), true);
    assert.equal(mayMonitorPayments('ADMINISTRADOR'), true);
  });

  /**
   * Not a stricter reading of D-06 — the only defence available. Payment
   * Service holds no customer reference, so an unrestricted listing would hand
   * every client every payment in the bank (TD-037).
   */
  test('a client does not, and neither does a session that is not signed in', () => {
    assert.equal(mayMonitorPayments('CLIENTE'), false);
    assert.equal(mayMonitorPayments(null), false);
  });
});

describe('what the monitoring banner counts', () => {
  test('separates refusals from exhausted ladders', () => {
    const summary = summariseFailures([
      row({ status: 'FAILED', errorType: 'PERMANENT' }),
      row({ status: 'FAILED', errorType: 'TRANSIENT' }),
      row({ status: 'FAILED', errorType: 'TRANSIENT' }),
      row(),
    ]);

    assert.deepEqual(summary, { total: 3, permanent: 1, transient: 2 });
  });

  /** A payment still climbing has not failed. Counting it would alarm about
   * work that is going fine. */
  test('a payment still being attempted is not a failure yet', () => {
    const summary = summariseFailures([
      row({ status: 'PENDING', errorType: 'TRANSIENT', attempt: 2, decidedAt: null }),
    ]);

    assert.deepEqual(summary, { total: 0, permanent: 0, transient: 0 });
  });

  test('an empty list produces an empty banner rather than a zero-shaped alarm', () => {
    assert.deepEqual(summariseFailures([]), { total: 0, permanent: 0, transient: 0 });
  });

  test('a row is already the shape the verdict needs', () => {
    assert.deepEqual(signalsOf(row({ attempt: 3, errorType: 'TRANSIENT' })), {
      status: 'SUCCEEDED',
      errorType: 'TRANSIENT',
      failureReason: null,
      attempt: 3,
    });
  });
});
