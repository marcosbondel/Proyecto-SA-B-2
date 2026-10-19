import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  AUDIT_SERVICES,
  auditFilterIsActive,
  auditFilterProblems,
  isTraceId,
  messageTypeLabel,
  normaliseTraceId,
  notificationLabel,
  notificationLink,
  recentAuditQuery,
} from '../app/lib/audit.ts';
import {
  MAX_REMEMBERED_TRACES,
  QUERY_TRACE_LABEL,
  remember,
  traceFor,
  traceIdFrom,
  traceToShow,
} from '../app/lib/trace.ts';

/**
 * T-45's frontend rules, as the pure functions the screens decide with.
 *
 * What can be wrong here is what an audit screen says about evidence: a filter
 * that is sent when it is empty and makes the Gateway refuse the whole search,
 * a half-typed identifier that is searched anyway, a trace shown for the wrong
 * operation, or a made-up one shown when nothing recorded any.
 */

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const OTHER_TRACE = '0af7651916cd43dd8448eb211c80319c';
const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';

const off = { correlationId: '', traceId: '', service: 'TODOS', severity: 'TODOS' };

describe('a trace id', () => {
  test('is thirty-two lowercase hex digits', () => {
    assert.equal(isTraceId(TRACE), true);
  });

  test('is not the reserved all-zero value, nor anything that only looks like one', () => {
    for (const bad of [
      '0'.repeat(32),
      TRACE.toUpperCase(),
      TRACE.slice(1),
      `${TRACE}0`,
      'z'.repeat(32),
      `00-${TRACE}-00f067aa0ba902b7-01`,
      '',
    ]) {
      assert.equal(isTraceId(bad), false, `"${bad}" was taken for a trace id`);
    }
  });

  test('is made askable by trimming and lowercasing what was pasted', () => {
    assert.equal(normaliseTraceId(`  ${TRACE.toUpperCase()} \n`), TRACE);
    assert.equal(isTraceId(normaliseTraceId(`  ${TRACE.toUpperCase()} `)), true);
  });
});

describe('the audit filters', () => {
  test('say nothing about a box left empty: that is a filter left off', () => {
    assert.deepEqual(auditFilterProblems(off), {});
    assert.deepEqual(auditFilterProblems({ ...off, traceId: '   ', correlationId: '  ' }), {});
  });

  test('say what is wrong with each free-text box, beside that box', () => {
    const problems = auditFilterProblems({ ...off, correlationId: 'not-a-uuid', traceId: 'not-a-trace' });

    assert.match(problems.correlationId, /UUID/);
    assert.match(problems.traceId, /32 caracteres/);
  });

  test('accept a trace pasted in capitals, which is the same trace', () => {
    assert.deepEqual(auditFilterProblems({ ...off, traceId: TRACE.toUpperCase() }), {});
  });

  test('refuse a correlation that is a UUID of another version', () => {
    const v1 = '7d41e8b2-9a3f-1c15-8ee0-1b2f9a4c7d10';

    assert.ok(auditFilterProblems({ ...off, correlationId: v1 }).correlationId);
  });

  test('are active when any one of the four is on, and only then', () => {
    assert.equal(auditFilterIsActive(off), false);
    assert.equal(auditFilterIsActive({ ...off, correlationId: CORRELATION }), true);
    assert.equal(auditFilterIsActive({ ...off, traceId: TRACE }), true);
    assert.equal(auditFilterIsActive({ ...off, service: 'payment-service' }), true);
    assert.equal(auditFilterIsActive({ ...off, severity: 'ERROR' }), true);
    assert.equal(auditFilterIsActive({ ...off, traceId: '  ' }), false);
  });
});

describe('the query the filters make', () => {
  test('carries only the page when nothing is filtered — never an empty parameter', () => {
    assert.deepEqual(recentAuditQuery(off, 1, 10), { page: '1', limit: '10' });
  });

  test('carries every filter that is on, and no other', () => {
    assert.deepEqual(
      recentAuditQuery(
        { correlationId: CORRELATION, traceId: TRACE, service: 'payment-service', severity: 'ERROR' },
        3,
        10,
      ),
      {
        page: '3',
        limit: '10',
        correlationId: CORRELATION,
        traceId: TRACE,
        service: 'payment-service',
        severity: 'ERROR',
      },
    );
  });

  test('sends a pasted trace the way the Gateway wants it: trimmed, lowercase', () => {
    assert.equal(recentAuditQuery({ ...off, traceId: ` ${TRACE.toUpperCase()} ` }, 1, 10).traceId, TRACE);
  });

  test('lowercases a correlation, which the Gateway matches case-insensitively and the table does not', () => {
    assert.equal(
      recentAuditQuery({ ...off, correlationId: ` ${CORRELATION.toUpperCase()} ` }, 1, 10).correlationId,
      CORRELATION,
    );
  });

  test('sends a menu left on TODOS as nothing', () => {
    const query = recentAuditQuery({ ...off, service: 'TODOS', severity: 'WARNING' }, 1, 10);

    assert.equal('service' in query, false);
    assert.equal(query.severity, 'WARNING');
  });

  test('offers only services that publish, and every one of them', () => {
    assert.deepEqual([...AUDIT_SERVICES].sort(), [
      'account-service',
      'customer-service',
      'gateway',
      'notification-audit-service',
      'payment-service',
      'transaction-service',
    ]);
  });
});

describe('what the anomaly and the alert are called', () => {
  test('the anomaly has a name in the trail and in the inbox', () => {
    assert.equal(messageTypeLabel('account.anomaly.detected.v1'), 'Actividad inusual detectada en la cuenta');
    assert.equal(notificationLabel('account.anomaly'), 'Actividad inusual en la cuenta');
  });

  test('the SLO alert has a name in the trail and in the console', () => {
    assert.equal(messageTypeLabel('alert.slo.received.v1'), 'Alerta de SLO recibida');
    assert.equal(notificationLabel('alert.slo'), 'Alerta de SLO');
  });

  test('an alert nobody has named is still called an alert, not a system event', () => {
    assert.equal(messageTypeLabel('alert.something-new.v1'), 'Evento de alerta');
  });

  test('the holder is taken to the account the anomaly was about', () => {
    assert.equal(
      notificationLink({
        notificationId: 'n',
        type: 'account.anomaly',
        subject: 's',
        referenceId: '5a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
        correlationId: CORRELATION,
        createdAt: '2026-10-05T18:00:00.000Z',
        readAt: null,
        severity: 'WARNING',
      }),
      '/cuentas/5a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
    );
  });
});

describe('the trace of an operation', () => {
  test('is what the Gateway sent, when that is a trace id', () => {
    assert.equal(traceIdFrom(TRACE), TRACE);
    assert.equal(traceIdFrom(`  ${TRACE.toUpperCase()} `), TRACE);
  });

  test('is nothing when the Gateway sent nothing, or something that is not a trace', () => {
    for (const header of [null, undefined, '', '   ', '0'.repeat(32), 'garbage', `${TRACE}00`]) {
      assert.equal(traceIdFrom(header), null, `"${String(header)}" was shown as a trace`);
    }
  });

  test('is remembered by the correlation of the operation, and found by it', () => {
    const ledger = remember({}, CORRELATION, TRACE);

    assert.equal(traceFor(ledger, CORRELATION), TRACE);
  });

  test('is never found for another operation, nor for none', () => {
    const ledger = remember({}, CORRELATION, TRACE);

    assert.equal(traceFor(ledger, '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93'), null);
    assert.equal(traceFor(ledger, null), null);
  });

  test('is not invented when there is no trace to remember: the ledger stays as it was', () => {
    const ledger = remember({}, CORRELATION, TRACE);

    assert.equal(remember(ledger, CORRELATION, null), ledger);
    assert.equal(remember(ledger, null, OTHER_TRACE), ledger);
    assert.equal(remember(ledger, '', OTHER_TRACE), ledger);
  });

  test('is replaced by the latest when the same operation is asked about twice', () => {
    const first = remember({}, CORRELATION, TRACE);
    const second = remember(first, CORRELATION, OTHER_TRACE);

    assert.equal(traceFor(second, CORRELATION), OTHER_TRACE);
    assert.equal(Object.keys(second).length, 1);
  });

  test('is returned as a new ledger, never the old one changed — a reactive store has to see it', () => {
    const before = {};
    const after = remember(before, CORRELATION, TRACE);

    assert.notEqual(after, before);
    assert.deepEqual(before, {});
  });

  test('forgets the oldest operation past the bound, and keeps the newest', () => {
    let ledger = {};

    for (let index = 0; index < MAX_REMEMBERED_TRACES + 5; index += 1) {
      ledger = remember(ledger, `correlation-${String(index)}`, TRACE);
    }

    assert.equal(Object.keys(ledger).length, MAX_REMEMBERED_TRACES);
    assert.equal(traceFor(ledger, 'correlation-0'), null);
    assert.equal(traceFor(ledger, `correlation-${String(MAX_REMEMBERED_TRACES + 4)}`), TRACE);
  });

  test('keeps an operation asked about again, instead of forgetting it as the oldest', () => {
    let ledger = remember({}, 'first', TRACE);

    for (let index = 0; index < MAX_REMEMBERED_TRACES - 1; index += 1) {
      ledger = remember(ledger, `other-${String(index)}`, TRACE);
    }

    ledger = remember(ledger, 'first', OTHER_TRACE);
    ledger = remember(ledger, 'one-more', TRACE);

    assert.equal(traceFor(ledger, 'first'), OTHER_TRACE);
  });
});

describe('the edges of the filters and the ledger', () => {
  test('a problem in one box is not reported against the other', () => {
    const onlyTrace = auditFilterProblems({ ...off, traceId: 'nope' });
    const onlyCorrelation = auditFilterProblems({ ...off, correlationId: 'nope' });

    assert.deepEqual(Object.keys(onlyTrace), ['traceId']);
    assert.deepEqual(Object.keys(onlyCorrelation), ['correlationId']);
  });

  test('a correlation pasted in capitals is a correlation, because the Gateway matches it case-insensitively', () => {
    assert.deepEqual(auditFilterProblems({ ...off, correlationId: CORRELATION.toUpperCase() }), {});
  });

  test('pasting something that is not hex does not make it a trace by lowercasing it', () => {
    assert.equal(isTraceId(normaliseTraceId('ZZZZ'.repeat(8))), false);
  });

  test('pages and limits travel as the strings a query string is made of', () => {
    const query = recentAuditQuery(off, 12, 25);

    assert.equal(query.page, '12');
    assert.equal(query.limit, '25');
  });

  test('an operation keeps its own trace when others are remembered after it', () => {
    let ledger = remember({}, 'one', TRACE);

    ledger = remember(ledger, 'two', OTHER_TRACE);

    assert.equal(traceFor(ledger, 'one'), TRACE);
    assert.equal(traceFor(ledger, 'two'), OTHER_TRACE);
  });

  test('a header read off a response with a trailing newline is still the trace', () => {
    assert.equal(traceIdFrom(`${TRACE}
`), TRACE);
  });
});

describe('the trace a detail screen shows for an operation it did not start', () => {
  test('is the operation\'s own trace when this session sent it', () => {
    const ledger = remember({}, CORRELATION, TRACE);

    assert.deepEqual(traceToShow(ledger, CORRELATION, OTHER_TRACE), { traceId: TRACE, ofQuery: false });
  });

  test('falls back to the trace of the question asked, and says so, when the page was opened from a link', () => {
    assert.deepEqual(traceToShow({}, CORRELATION, OTHER_TRACE), { traceId: OTHER_TRACE, ofQuery: true });
    assert.match(QUERY_TRACE_LABEL, /consulta/);
  });

  test('is nothing at all when the Gateway sent no trace, rather than an invented one', () => {
    assert.equal(traceToShow({}, CORRELATION, null), null);
    assert.equal(traceToShow({}, null, null), null);
  });

  test('never takes another operation\'s trace for this one', () => {
    const ledger = remember({}, 'someone-else', TRACE);

    assert.deepEqual(traceToShow(ledger, CORRELATION, OTHER_TRACE), { traceId: OTHER_TRACE, ofQuery: true });
  });
});
