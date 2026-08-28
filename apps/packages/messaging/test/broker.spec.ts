import { createEnvelope } from '@bank/contracts';

import { parseEnvelope } from '../src';

// These tests exercise the wire format only. Anything that needs a live broker
// belongs to the local stack, which arrives with T-06.

describe('envelope wire format', () => {
  it('round-trips an envelope through the delivery body', () => {
    const original = createEnvelope(
      { transactionId: '33333333-3333-4333-8333-333333333333' },
      { messageType: 'account.debited.v1', producer: 'account-service', identity: null },
    );

    const restored = parseEnvelope(Buffer.from(JSON.stringify(original)));

    expect(restored).toEqual(original);
  });

  it('refuses a body that is not an envelope', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));

    expect(() => parseEnvelope(body)).toThrow(/well-formed message envelope/);
  });

  it('refuses a body that is missing a tracing field', () => {
    const original = createEnvelope(
      { transactionId: '33333333-3333-4333-8333-333333333333' },
      { messageType: 'account.debited.v1', producer: 'account-service', identity: null },
    );
    const { idempotencyKey, ...incomplete } = original;
    void idempotencyKey;

    expect(() => parseEnvelope(Buffer.from(JSON.stringify(incomplete)))).toThrow(
      /well-formed message envelope/,
    );
  });

  /*
   * The structural gate checks the *whole* envelope shape, not a subset — so a
   * body missing any of the fields below is refused before it can reach the one
   * consumer (the audit service) that runs no validator of its own.
   */
  it.each(['messageVersion', 'producer', 'identity', 'occurredAt'])(
    'refuses a body missing %s',
    (field) => {
      const original = createEnvelope(
        { transactionId: '33333333-3333-4333-8333-333333333333' },
        { messageType: 'account.debited.v1', producer: 'account-service', identity: null },
      );
      const incomplete: Record<string, unknown> = { ...original };
      delete incomplete[field];

      expect(() => parseEnvelope(Buffer.from(JSON.stringify(incomplete)))).toThrow(
        /well-formed message envelope/,
      );
    },
  );

  it('round-trips an envelope that carries an identity and a causation', () => {
    const cause = createEnvelope(
      { transactionId: '33333333-3333-4333-8333-333333333333' },
      { messageType: 'account.debited.v1', producer: 'account-service', identity: null },
    );
    const effect = createEnvelope(
      { transactionId: '33333333-3333-4333-8333-333333333333' },
      {
        messageType: 'account.debited.v1',
        producer: 'account-service',
        identity: { customerId: '44444444-4444-4444-8444-444444444444', role: 'CLIENTE' },
        causationId: cause.messageId,
        correlationId: cause.correlationId,
      },
    );

    const restored = parseEnvelope(Buffer.from(JSON.stringify(effect)));

    expect(restored).toEqual(effect);
  });
});
