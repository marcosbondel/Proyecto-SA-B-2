import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contractFor } from '../../src/events';
import { envelopeSchema } from '../../src/schemas/envelope.schema';

const EXAMPLES = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'events', 'examples');

interface Message {
  readonly messageId: string;
  readonly messageType: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly payload: unknown;
}

const load = (name: string): Message[] =>
  JSON.parse(readFileSync(join(EXAMPLES, `${name}.json`), 'utf8')) as Message[];

/** Rebuilds the flow backwards from its last message, the way an operator would. */
function chainFrom(messages: Message[]): string[] {
  const byId = new Map(messages.map((m) => [m.messageId, m]));
  const chain: string[] = [];

  let cursor: string | null = messages[messages.length - 1]?.messageId ?? null;
  while (cursor !== null) {
    const message = byId.get(cursor);
    if (message === undefined) {
      break;
    }

    chain.push(message.messageType);
    cursor = message.causationId;
  }

  return chain.reverse();
}

describe.each([
  ['happy-path', 9, 'transaction.completed.v1'],
  ['rejected', 5, 'transaction.failed.v1'],
  ['compensated', 9, 'transaction.compensated.v1'],
])('the %s example', (name, length, closing) => {
  const messages = load(name);

  it('has the expected number of messages', () => {
    expect(messages).toHaveLength(length);
  });

  it('is made of well-formed envelopes', () => {
    for (const message of messages) {
      expect(envelopeSchema.safeParse(message).success).toBe(true);
    }
  });

  it('carries a payload that satisfies its own contract', () => {
    for (const message of messages) {
      const contract = contractFor(message.messageType);

      expect(contract).toBeDefined();
      expect(contract?.schema.safeParse(message.payload).success).toBe(true);
    }
  });

  it('shares one correlation across the whole flow', () => {
    expect(new Set(messages.map((m) => m.correlationId)).size).toBe(1);
  });

  it('starts from a message nothing caused', () => {
    expect(messages[0]?.causationId).toBeNull();
  });

  it('reconstructs end to end with no gaps, which is what SC-003 asks for', () => {
    expect(chainFrom(messages)).toHaveLength(length);
  });

  it('closes where the saga says it should', () => {
    expect(messages[messages.length - 1]?.messageType).toBe(closing);
  });
});

describe('the two endings are not interchangeable', () => {
  it('closes in FAILED only when the debit never happened', () => {
    const rejected = load('rejected').map((m) => m.messageType);

    expect(rejected).toContain('account.debit.rejected.v1');
    expect(rejected).not.toContain('account.debited.v1');
    expect(rejected).not.toContain('account.debit.compensation.requested.v1');
  });

  it('closes in COMPENSATED only when the money had already left', () => {
    const compensated = load('compensated').map((m) => m.messageType);

    expect(compensated).toContain('account.debited.v1');
    expect(compensated).toContain('account.debit.compensated.v1');
    expect(compensated).not.toContain('transaction.failed.v1');
  });
});
