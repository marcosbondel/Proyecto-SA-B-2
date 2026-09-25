import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  CORRELATION_PROBLEM_TEXT,
  NOTIFICATION_STATUS_PRESENTATION,
  PROCESSING_STATUS_PRESENTATION,
  REDACTION_MARKER,
  SEVERITY_PRESENTATION,
  correlationProblem,
  filterTrail,
  formatPayload,
  formatSpan,
  isCorrelationId,
  mayQueryAudit,
  messageTypeLabel,
  messageTypesIn,
  notificationLabel,
  notificationLink,
  notificationStatusFrom,
  orderedTrail,
  producersIn,
  redactedCount,
  severityTint,
  summariseTrail,
  tintFor,
} from '../app/lib/audit.ts';

const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';

const event = (overrides = {}) => ({
  messageId: '8f21c9a0-4d7b-4f0e-9c1e-0242ac120002',
  messageType: 'transaction.completed.v1',
  producer: 'transaction-service',
  causationId: null,
  occurredAt: '2026-08-27T15:00:00.000Z',
  processingStatus: 'PROCESSED',
  ...overrides,
});

describe('the identifier this module is keyed by', () => {
  test('accepts a UUID v4', () => {
    assert.equal(isCorrelationId(CORRELATION), true);
  });

  test('accepts one with surrounding whitespace, because pasting adds it', () => {
    assert.equal(isCorrelationId(`  ${CORRELATION}\n`), true);
  });

  /**
   * A v1 UUID pasted from somewhere else is the realistic mistake, and the
   * Gateway refuses it. Catching it here is the difference between a message
   * next to the field and a `400` that reads like a lost record.
   */
  test('refuses a UUID of another version', () => {
    assert.equal(isCorrelationId('7d41e8b2-9a3f-1c15-8ee0-1b2f9a4c7d10'), false);
  });

  test('names what is wrong, and says nothing when nothing is', () => {
    assert.equal(correlationProblem(''), 'EMPTY');
    assert.equal(correlationProblem('   '), 'EMPTY');
    assert.equal(correlationProblem('no soy un uuid'), 'NOT_A_UUID');
    assert.equal(correlationProblem(CORRELATION), null);
  });

  test('has a sentence for each problem', () => {
    for (const problem of ['EMPTY', 'NOT_A_UUID']) {
      assert.ok(CORRELATION_PROBLEM_TEXT[problem].length > 0);
    }
  });
});

describe('the order a trail is shown in', () => {
  test('is oldest first', () => {
    const ordered = orderedTrail([
      event({ messageId: 'c', occurredAt: '2026-08-27T15:00:02.000Z' }),
      event({ messageId: 'a', occurredAt: '2026-08-27T15:00:00.000Z' }),
      event({ messageId: 'b', occurredAt: '2026-08-27T15:00:01.000Z' }),
    ]);

    assert.deepEqual(
      ordered.map((entry) => entry.messageId),
      ['a', 'b', 'c'],
    );
  });

  /**
   * Five services on five clocks produce equal timestamps often enough that
   * "sorted by time" is not a total order. Without the tie-break the same trail
   * renders in two orders on two loads, which is how somebody stops trusting an
   * audit screen.
   */
  test('breaks a tie deterministically rather than leaving it to the sort', () => {
    const same = '2026-08-27T15:00:00.000Z';
    const forward = orderedTrail([
      event({ messageId: 'z', occurredAt: same }),
      event({ messageId: 'a', occurredAt: same }),
    ]);
    const backward = orderedTrail([
      event({ messageId: 'a', occurredAt: same }),
      event({ messageId: 'z', occurredAt: same }),
    ]);

    assert.deepEqual(
      forward.map((entry) => entry.messageId),
      backward.map((entry) => entry.messageId),
    );
  });

  test('leaves the array it was handed alone', () => {
    const original = [
      event({ messageId: 'c', occurredAt: '2026-08-27T15:00:02.000Z' }),
      event({ messageId: 'a', occurredAt: '2026-08-27T15:00:00.000Z' }),
    ];
    orderedTrail(original);

    assert.deepEqual(
      original.map((entry) => entry.messageId),
      ['c', 'a'],
    );
  });
});

describe('how a message name is read', () => {
  test('tints a failure, a success and everything else apart', () => {
    assert.equal(tintFor('payment.failed.v1'), 'failure');
    assert.equal(tintFor('transaction.compensated.v1'), 'failure');
    assert.equal(tintFor('account.debit.rejected.v1'), 'failure');
    assert.equal(tintFor('transaction.completed.v1'), 'success');
    assert.equal(tintFor('account.credited.v1'), 'success');
    assert.equal(tintFor('account.debit.requested.v1'), 'neutral');
  });

});

describe('§4.1 classification (T-30)', () => {
  test('has a sentence for each severity', () => {
    for (const severity of ['INFO', 'WARNING', 'ERROR']) {
      assert.ok(SEVERITY_PRESENTATION[severity].label.length > 0);
      assert.ok(SEVERITY_PRESENTATION[severity].explanation.length > 0);
    }
  });

  test('prefers the recorded severity over the inferred tint', () => {
    // Its own name would guess "success" (registered), but the recorded
    // severity is what the audit service actually decided.
    assert.equal(
      severityTint({ messageType: 'customer.registered.v1', severity: 'WARNING' }),
      'neutral',
    );
    assert.equal(severityTint({ messageType: 'transaction.completed.v1', severity: 'ERROR' }), 'failure');
    assert.equal(severityTint({ messageType: 'transaction.completed.v1', severity: 'INFO' }), 'success');
  });

  /**
   * A row recorded before T-30 carries no `severity` at all. Falling back to
   * `tintFor`'s guess is the honest thing to show rather than crashing or
   * hiding the row.
   */
  test('falls back to the inferred tint for a row with no recorded severity', () => {
    assert.equal(
      severityTint({ messageType: 'transaction.completed.v1' }),
      tintFor('transaction.completed.v1'),
    );
  });
});

describe('narrowing a trail', () => {
  const trail = [
    event({ messageId: 'a', producer: 'account-service', messageType: 'account.debited.v1' }),
    event({ messageId: 'b', producer: 'payment-service', messageType: 'payment.succeeded.v1' }),
    event({ messageId: 'c', producer: 'account-service', messageType: 'account.credited.v1' }),
  ];

  test('returns everything when nothing is asked', () => {
    assert.equal(filterTrail(trail, {}).length, 3);
  });

  test('narrows by producer', () => {
    assert.equal(filterTrail(trail, { producer: 'account-service' }).length, 2);
  });

  test('narrows by message type', () => {
    assert.equal(filterTrail(trail, { messageType: 'payment.succeeded.v1' }).length, 1);
  });

  test('combines the two rather than choosing one', () => {
    assert.equal(
      filterTrail(trail, { producer: 'account-service', messageType: 'payment.succeeded.v1' })
        .length,
      0,
    );
  });

  test('offers only the values the trail actually contains, sorted', () => {
    assert.deepEqual(producersIn(trail), ['account-service', 'payment-service']);
    assert.deepEqual(messageTypesIn(trail), [
      'account.credited.v1',
      'account.debited.v1',
      'payment.succeeded.v1',
    ]);
  });
});

describe('what the header says about a flow', () => {
  test('counts the events and the services behind them', () => {
    const summary = summariseTrail([
      event({ messageId: 'a', producer: 'account-service' }),
      event({ messageId: 'b', producer: 'payment-service' }),
      event({ messageId: 'c', producer: 'account-service' }),
    ]);

    assert.equal(summary.events, 3);
    assert.equal(summary.producers, 2);
  });

  /**
   * Criterion 3 made visible. A single unreadable message in a trail of nine is
   * exactly the row somebody scrolls past, so the count is promoted to the
   * header.
   */
  test('counts the messages the audit service could not read', () => {
    const summary = summariseTrail([
      event({ messageId: 'a' }),
      event({ messageId: 'b', processingStatus: 'INVALID' }),
      event({ messageId: 'c', processingStatus: 'ERROR' }),
    ]);

    assert.equal(summary.invalid, 2);
  });

  test('counts nothing invalid on a reply that carries no status at all', () => {
    const summary = summariseTrail([{ ...event(), processingStatus: undefined }]);

    assert.equal(summary.invalid, 0);
  });

  test('has no span for a single event', () => {
    assert.equal(summariseTrail([event()]).spanMs, null);
    assert.equal(summariseTrail([]).spanMs, null);
  });

  test('measures the span between the first and last message', () => {
    const summary = summariseTrail([
      event({ messageId: 'a', occurredAt: '2026-08-27T15:00:00.000Z' }),
      event({ messageId: 'b', occurredAt: '2026-08-27T15:00:05.000Z' }),
    ]);

    assert.equal(summary.spanMs, 5_000);
  });

  test('writes a span the way somebody reads one', () => {
    assert.equal(formatSpan(240), '240 ms');
    assert.equal(formatSpan(5_400), '5.4 s');
    assert.equal(formatSpan(42_000), '42 s');
    assert.equal(formatSpan(180_000), '3 min');
  });
});

describe('the payload the detail panel prints', () => {
  test('sorts the keys so the same message renders the same way twice', () => {
    const printed = formatPayload({ zeta: 1, alpha: 2 });

    assert.ok(printed.indexOf('"alpha"') < printed.indexOf('"zeta"'));
  });

  /**
   * `null` rather than `{}`, because an empty object reads as "this message
   * carried no data" — a claim about the producer rather than about the audit
   * service's own privacy rule.
   */
  test('is null when there is nothing left to show', () => {
    assert.equal(formatPayload(undefined), null);
    assert.equal(formatPayload({}), null);
  });

  test('counts the fields the service hid', () => {
    assert.equal(
      redactedCount({ customerId: 'cus-1', email: REDACTION_MARKER, dpi: REDACTION_MARKER }),
      2,
    );
    assert.equal(redactedCount({ customerId: 'cus-1' }), 0);
    assert.equal(redactedCount(undefined), 0);
  });
});

describe('what a notification status means', () => {
  test('has a sentence for each of the three', () => {
    for (const status of ['PENDING', 'SENT', 'FAILED']) {
      assert.ok(NOTIFICATION_STATUS_PRESENTATION[status].label.length > 0);
      assert.ok(NOTIFICATION_STATUS_PRESENTATION[status].explanation.length > 0);
    }
  });

  test('has a sentence for each processing status', () => {
    for (const status of ['PROCESSED', 'INVALID', 'ERROR']) {
      assert.ok(PROCESSING_STATUS_PRESENTATION[status].explanation.length > 0);
    }
  });

  /**
   * The audit reply carries only `sentAt`, so a failed delivery is
   * indistinguishable there from a pending one (TD-040). This function is the
   * one place that reading lives, so two components cannot disagree about what
   * a `null` means.
   */
  test('reads only two of the three states out of the audit reply', () => {
    assert.equal(notificationStatusFrom(null), 'PENDING');
    assert.equal(notificationStatusFrom('2026-08-27T15:00:00.000Z'), 'SENT');
  });
});

describe('who may open the module', () => {
  /**
   * The one route D-06 restricts by role outright rather than by scope. This is
   * convenience — the Gateway's `@Roles('ADMINISTRADOR')` refuses the query
   * whether or not this was called — and `navigation-parity.test.mjs` holds the
   * two against each other.
   */
  test('is the administrator, and nobody else', () => {
    assert.equal(mayQueryAudit('ADMINISTRADOR'), true);
    assert.equal(mayQueryAudit('CAJERO_RECEPTOR'), false);
    assert.equal(mayQueryAudit('CLIENTE'), false);
    assert.equal(mayQueryAudit(null), false);
  });
});

/**
 * `N-01`'s two presentation decisions, in a plain module so they are testable
 * despite TD-010. Both are the kind of mapping that looks obvious until the
 * fallback case is wrong on a screen nobody was looking at.
 */
describe('where a notification links', () => {
  const notification = (overrides = {}) => ({
    notificationId: '5f3a19c8-2b47-4de0-9a15-7c8e3b0d6142',
    type: 'transfer.completed',
    subject: 'Tu transferencia se completó',
    referenceId: '7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70',
    correlationId: '44444444-4444-4444-8444-444444444401',
    createdAt: '2026-08-19T14:32:08.100Z',
    readAt: null,
    ...overrides,
  });

  test('a transfer notification opens the transfer', () => {
    assert.equal(
      notificationLink(notification()),
      '/transferencias/7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70',
    );
  });

  test('an account notification opens the account', () => {
    assert.equal(
      notificationLink(notification({ type: 'account.deactivated' })),
      '/cuentas/7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70',
    );
  });

  test('a customer notification opens the profile, whatever it references', () => {
    assert.equal(notificationLink(notification({ type: 'identity.validated' })), '/perfil');
    assert.equal(notificationLink(notification({ type: 'customer.activated' })), '/perfil');
  });

  /**
   * A notification that cannot be opened is better than one whose link lands on
   * a 404, so both unknowns resolve to no link at all.
   */
  test('nothing to reference and nothing recognised both mean no link', () => {
    assert.equal(notificationLink(notification({ referenceId: null })), null);
    assert.equal(notificationLink(notification({ type: 'payment.settled' })), null);
  });
});

describe('what a notification is called', () => {
  test('the known kinds are written in words', () => {
    assert.equal(notificationLabel('transfer.compensated'), 'Transferencia revertida');
    assert.equal(notificationLabel('customer.password-changed'), 'Contraseña cambiada');
  });

  /**
   * Falls back to the raw type rather than to "Notificación": a reader who sees
   * an untranslated `payment.settled` learns something and can report it; one
   * who sees a generic label learns nothing.
   */
  test('an unknown kind falls back to its own name', () => {
    assert.equal(notificationLabel('payment.settled'), 'payment.settled');
  });
});

/**
 * The trail table's "Qué pasó" column. It sits *next to* `event.messageType`,
 * never instead of it — the technical name is itself part of the record — so
 * this only has to be legible, not exhaustive.
 */
describe('what a message type means to an administrator reading the trail', () => {
  test('translates a message from every family the trail can actually show', () => {
    const known = {
      'account.opened.v1': 'Cuenta abierta',
      'transaction.completed.v1': 'Transferencia completada',
      'payment.attempt.failed.v1': 'Intento de pago fallido',
      'customer.registered.v1': 'Cliente registrado',
      'notification.mark-read.v1': 'Notificación marcada como leída',
      'audit.query.requested.v1': 'Consulta de auditoría solicitada',
    };

    for (const [type, label] of Object.entries(known)) {
      assert.equal(messageTypeLabel(type), label);
    }
  });

  /**
   * Every type `notification-audit-service` actually consumes is in the map
   * above; nothing else can reach `audit_events`. This is the safety net for
   * the day the catalogue grows and this file has not caught up yet.
   */
  test('falls back to the family rather than the raw enum for an unlisted type', () => {
    assert.equal(messageTypeLabel('account.something-new.v1'), 'Evento de cuenta');
    assert.equal(messageTypeLabel('payment.something-new.v1'), 'Evento de pago');
  });

  test('falls back once more when even the family is not recognised', () => {
    assert.equal(messageTypeLabel('unicorn.something.v1'), 'Evento del sistema');
  });
});

