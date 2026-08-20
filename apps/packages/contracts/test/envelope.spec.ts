import { createEnvelope, followUpEnvelope } from '../src/envelope';

const OPTIONS = {
  messageType: 'transfer.requested.v1',
  producer: 'gateway',
  identity: { customerId: '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60', role: 'CLIENTE' },
} as const;

describe('createEnvelope', () => {
  it('fills in the identifiers the caller left out', () => {
    const envelope = createEnvelope({ amount: 1 }, OPTIONS);

    expect(envelope.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(envelope.occurredAt).toMatch(/Z$/);
    expect(envelope.payload).toEqual({ amount: 1 });
  });

  it('makes a flow that starts here its own correlation root', () => {
    const envelope = createEnvelope({}, OPTIONS);

    expect(envelope.correlationId).toBe(envelope.messageId);
    expect(envelope.causationId).toBeNull();
  });

  it('derives the message version from the name suffix, so the two cannot drift', () => {
    expect(
      createEnvelope({}, { ...OPTIONS, messageType: 'account.debited.v3' }).messageVersion,
    ).toBe(3);
  });

  it('refuses a message name with no version suffix', () => {
    expect(() => createEnvelope({}, { ...OPTIONS, messageType: 'account.debited' })).toThrow(
      /version suffix/i,
    );
  });

  it('records the producer, because "who sent this" is not guessable downstream', () => {
    expect(createEnvelope({}, OPTIONS).producer).toBe('gateway');
  });

  it('carries the identity the gateway already verified', () => {
    expect(createEnvelope({}, OPTIONS).identity).toEqual({
      customerId: '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60',
      role: 'CLIENTE',
    });
  });

  it('accepts a null identity for work no user originated', () => {
    const envelope = createEnvelope(
      {},
      { messageType: 'account.deactivated.v1', producer: 'account-service', identity: null },
    );

    expect(envelope.identity).toBeNull();
  });
});

describe('followUpEnvelope', () => {
  const cause = createEnvelope({}, OPTIONS);

  it('keeps the correlation of the flow it belongs to', () => {
    expect(
      followUpEnvelope(
        cause,
        {},
        { messageType: 'account.debit.requested.v1', producer: 'transaction-service' },
      ).correlationId,
    ).toBe(cause.correlationId);
  });

  it('records what caused it, which is what makes the saga reconstructible', () => {
    expect(
      followUpEnvelope(
        cause,
        {},
        { messageType: 'account.debit.requested.v1', producer: 'transaction-service' },
      ).causationId,
    ).toBe(cause.messageId);
  });

  it('copies the verified identity forward without re-deciding it', () => {
    expect(
      followUpEnvelope(
        cause,
        {},
        { messageType: 'account.debit.requested.v1', producer: 'transaction-service' },
      ).identity,
    ).toEqual(cause.identity);
  });

  it('gives the follow-up its own message id', () => {
    expect(
      followUpEnvelope(
        cause,
        {},
        { messageType: 'account.debit.requested.v1', producer: 'transaction-service' },
      ).messageId,
    ).not.toBe(cause.messageId);
  });
});
