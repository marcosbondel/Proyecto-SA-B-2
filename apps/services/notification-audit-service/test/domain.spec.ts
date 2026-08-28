import { orderTrail, statusForRejection } from '../src/domain/audit-event';
import { deduplicationKeyOf } from '../src/domain/deduplication';
import {
  notificationFor,
  notifyingMessageTypes,
  simulatedRecipientFor,
  subjectCustomerIdFrom,
} from '../src/domain/notification';
import { REDACTION_MARKER, isSensitiveField, redactPayload } from '../src/domain/redaction';

/**
 * The rules that decide what this service stores and what it says, argued
 * without a database and without a broker.
 *
 * Everything here is a pure function on purpose. The privacy rule in particular
 * is the one thing in this service that cannot be tested after the fact: once a
 * payload has been written unredacted, no later test can un-write it.
 */

describe('what may be written down', () => {
  it('hides the fields that identify a person', () => {
    const redacted = redactPayload({
      customerId: 'cus-1',
      fullName: 'María Fernanda López García',
      email: 'maria@example.gt',
      documentId: '2547896320101',
      address: 'Zona 10',
      phone: '55512345',
      birthDate: '1998-04-02',
    });

    expect(redacted.customerId).toBe('cus-1');

    for (const field of ['fullName', 'email', 'documentId', 'address', 'phone', 'birthDate']) {
      expect(redacted[field]).toBe(REDACTION_MARKER);
    }
  });

  /**
   * Amounts are hidden by decision rather than by obligation: the money is
   * visible to anyone entitled to see it on the transfer screen itself, so
   * hiding it here costs a reader little and keeps the one database that hears
   * every event from also being a ledger of what everybody moved.
   */
  it('hides money, including inside the money object', () => {
    const redacted = redactPayload({
      transactionId: 'tx-1',
      amount: { amountMinor: 125_000, currency: 'GTQ' },
      balanceAfter: { amountMinor: 40_000, currency: 'GTQ' },
    });

    expect(redacted.transactionId).toBe('tx-1');
    expect(redacted.amount).toBe(REDACTION_MARKER);
    expect(redacted.balanceAfter).toBe(REDACTION_MARKER);
  });

  it('hides credentials and tokens wherever they are nested', () => {
    const redacted = redactPayload({
      customer: { credential: 'hunter2', activationToken: 'abc', customerId: 'cus-1' },
    });

    expect(redacted.customer).toEqual({
      credential: REDACTION_MARKER,
      activationToken: REDACTION_MARKER,
      customerId: 'cus-1',
    });
  });

  /**
   * A marker rather than a deletion. A missing key and a hidden key are
   * different facts: deleting it would tell a reader the producer never sent
   * the field, which is a claim about somebody else's code.
   */
  it('marks a hidden field rather than removing it', () => {
    expect(Object.keys(redactPayload({ email: 'a@b.gt' }))).toEqual(['email']);
  });

  it('keeps the identifiers, statuses and reasons that make a trail readable', () => {
    const redacted = redactPayload({
      transactionId: 'tx-1',
      status: 'COMPLETED',
      reason: 'INSUFFICIENT_FUNDS',
      occurredAt: '2026-08-27T15:00:00.000Z',
      attempt: 3,
      compensated: false,
    });

    expect(redacted).toEqual({
      transactionId: 'tx-1',
      status: 'COMPLETED',
      reason: 'INSUFFICIENT_FUNDS',
      occurredAt: '2026-08-27T15:00:00.000Z',
      attempt: 3,
      compensated: false,
    });
  });

  it('stops at a depth nothing in the catalogue reaches', () => {
    const redacted = redactPayload({ a: { b: { c: { d: { e: 'too deep' } } } } });

    expect(redacted).toEqual({ a: { b: { c: { d: REDACTION_MARKER } } } });
  });

  it('caps a long string rather than storing a document', () => {
    const redacted = redactPayload({ note: 'x'.repeat(500) });

    expect(String(redacted.note)).toHaveLength(201);
  });

  it('counts what it left out of a long array instead of silently truncating', () => {
    const redacted = redactPayload({ items: Array.from({ length: 25 }, (_, i) => i) });

    expect((redacted.items as unknown[]).at(-1)).toBe('[5 más]');
  });

  it('answers with an object for anything that is not one', () => {
    expect(redactPayload('a string')).toEqual({});
    expect(redactPayload(null)).toEqual({});
  });

  it('matches a sensitive name however it is cased', () => {
    expect(isSensitiveField('DocumentId')).toBe(true);
    expect(isSensitiveField('transactionId')).toBe(false);
  });
});

describe('which events are worth telling somebody about', () => {
  /**
   * The three the ticket names. `compensated` is not a variant of `failed`: a
   * failed transfer is money that never left, a compensated one is money that
   * left and came back, and somebody who already saw the debit on their
   * statement needs to be told the second thing specifically.
   */
  it.each([
    ['transaction.completed.v1', 'transfer.completed'],
    ['transaction.failed.v1', 'transfer.failed'],
    ['transaction.compensated.v1', 'transfer.compensated'],
  ])('notifies on %s', (messageType, expected) => {
    const intent = notificationFor(messageType, { transactionId: 'tx-1' });

    expect(intent?.type).toBe(expected);
    expect(intent?.referenceId).toBe('tx-1');
  });

  it('says nothing about the plumbing', () => {
    for (const messageType of [
      'account.debit.requested.v1',
      'account.debited.v1',
      'payment.attempt.failed.v1',
      'transaction.initiated.v1',
    ]) {
      expect(notificationFor(messageType, {})).toBeNull();
    }
  });

  it('notifies on eleven message types and no more', () => {
    expect(notifyingMessageTypes()).toHaveLength(11);
  });

  it('has no reference when the payload carries none', () => {
    expect(notificationFor('transaction.completed.v1', {})?.referenceId).toBeNull();
  });

  /**
   * Derived, never copied from an `email` field. A real address in a table
   * built to be read by staff is the exact disclosure the redaction rule
   * exists to prevent.
   */
  it('derives a simulated recipient from the customer, and none without one', () => {
    expect(simulatedRecipientFor('3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93')).toBe(
      'cliente-3f2a1c04@simulado.bonking.gt',
    );
    expect(simulatedRecipientFor(null)).toBeNull();
  });
});

describe('the order a trail is read in', () => {
  const at = (iso: string, eventId: string) => ({ occurredAt: new Date(iso), eventId });

  it('sorts by the moment the producer says it happened', () => {
    const ordered = orderTrail([
      at('2026-08-27T15:00:02.000Z', 'c'),
      at('2026-08-27T15:00:00.000Z', 'a'),
      at('2026-08-27T15:00:01.000Z', 'b'),
    ]);

    expect(ordered.map((event) => event.eventId)).toEqual(['a', 'b', 'c']);
  });

  /**
   * Five processes on five clocks produce equal timestamps often enough that
   * "sorted by time" is not a total order. Without the tie-break the same trail
   * renders in two orders on two loads, which is how somebody stops trusting an
   * audit screen.
   */
  it('breaks a tie deterministically instead of leaving it to the sort', () => {
    const same = '2026-08-27T15:00:00.000Z';

    expect(orderTrail([at(same, 'z'), at(same, 'a')]).map((e) => e.eventId)).toEqual(['a', 'z']);
    expect(orderTrail([at(same, 'a'), at(same, 'z')]).map((e) => e.eventId)).toEqual(['a', 'z']);
  });

  it('leaves the array it was handed alone', () => {
    const original = [at('2026-08-27T15:00:02.000Z', 'c'), at('2026-08-27T15:00:00.000Z', 'a')];
    orderTrail(original);

    expect(original.map((event) => event.eventId)).toEqual(['c', 'a']);
  });
});

describe('deduplication', () => {
  it('is keyed by the message and the consumer that saw it', () => {
    expect(deduplicationKeyOf({ eventId: 'e-1', consumer: 'audit.account' })).not.toBe(
      deduplicationKeyOf({ eventId: 'e-1', consumer: 'audit.customer' }),
    );
  });

  /**
   * "The producer sent rubbish" and "our database was down" are different
   * incidents, and the screen that is supposed to tell them apart cannot if
   * they arrive under the same status.
   */
  it('separates a message this consumer cannot read from a failure of its own', () => {
    expect(statusForRejection('invalid-payload')).toBe('INVALID');
    expect(statusForRejection('unknown-type')).toBe('INVALID');
    expect(statusForRejection('error')).toBe('ERROR');
  });
});

describe('whom a notification is about when nobody is signed in', () => {
  /**
   * The bug this exists to keep fixed, and it was invisible for a whole ticket.
   *
   * The recipient was derived from the envelope's identity alone, and the
   * envelope's identity is `null` for exactly one flow: **public registration**,
   * which has no session by design. So the activation notification — the only
   * one that ever carries a link, for the only actor that ever needs it — had
   * no recipient, the channel reported `FAILED`, and no activation link was
   * written anywhere in any environment. Nobody could complete a sign-up
   * (TD-044).
   */
  it('reads the subject from the payload for the customer family', () => {
    expect(
      subjectCustomerIdFrom('customer.activation.requested.v1', {
        customerId: '964b1516-0e35-4ad4-89dd-17997424d291',
        email: 'someone@example.gt',
      }),
    ).toBe('964b1516-0e35-4ad4-89dd-17997424d291');
  });

  /**
   * And only for that family. An `account.*` or `transaction.*` payload carries
   * account and transaction references, not people, and reading a `customerId`
   * out of one would be inventing a subject.
   */
  it.each([
    'account.debited.v1',
    'transaction.completed.v1',
    'payment.failed.v1',
    'notification.sent.v1',
  ])('reads nothing from %s', (messageType) => {
    expect(subjectCustomerIdFrom(messageType, { customerId: 'anything' })).toBeNull();
  });

  it('reads nothing from a payload that has no subject', () => {
    expect(subjectCustomerIdFrom('customer.registered.v1', { email: 'a@b.gt' })).toBeNull();
    expect(subjectCustomerIdFrom('customer.registered.v1', null)).toBeNull();
  });

  /**
   * The address is *derived* from the identifier and never copied from the
   * payload's `email`. That is what stops the one database that hears every
   * event in the bank from becoming a mailing list — the same rule
   * `redaction.ts` keeps for everything else.
   */
  it('derives an address rather than copying one', () => {
    const recipient = simulatedRecipientFor('964b1516-0e35-4ad4-89dd-17997424d291');

    expect(recipient).toBe('cliente-964b1516@simulado.bonking.gt');
    expect(recipient).not.toContain('@example');
  });
});
