import { createEnvelope, followUpEnvelope } from '../../src/envelope';

/**
 * SC-003: given any correlationId, the causal chain of its flow reconstructs
 * without ambiguity. This is the property the whole traceability requirement
 * rests on, so it is tested over a chain, not a single hop.
 */
describe('causal chain across a flow', () => {
  const first = createEnvelope(
    {},
    { messageType: 'transfer.requested.v1', producer: 'gateway', identity: null },
  );
  const second = followUpEnvelope(
    first,
    {},
    {
      messageType: 'account.debit.requested.v1',
      producer: 'transaction-service',
    },
  );
  const third = followUpEnvelope(
    second,
    {},
    {
      messageType: 'account.debited.v1',
      producer: 'account-service',
    },
  );

  it('shares one correlation across every hop', () => {
    expect(new Set([first, second, third].map((m) => m.correlationId)).size).toBe(1);
  });

  it('never regenerates the correlation at an intermediate step', () => {
    expect(third.correlationId).toBe(first.messageId);
  });

  it('links each message to the one that caused it', () => {
    expect(second.causationId).toBe(first.messageId);
    expect(third.causationId).toBe(second.messageId);
  });

  it('reconstructs the chain backwards from the last message', () => {
    const byId = new Map([first, second, third].map((m) => [m.messageId, m]));

    const chain: string[] = [];
    let cursor: string | null = third.messageId;
    while (cursor !== null) {
      chain.push(cursor);
      cursor = byId.get(cursor)?.causationId ?? null;
    }

    expect(chain).toEqual([third.messageId, second.messageId, first.messageId]);
  });
});
