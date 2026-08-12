import type { MoneyDto } from '../src';
import { createEnvelope, followUpEnvelope } from '../src';

// The example contract test wired to the root `pnpm test:contract` script
// (SC-004). T-05 replaces it with tests over the real message contracts.

const total: MoneyDto = { amountMinor: 125_00, currency: 'GTQ' };

describe('message envelope', () => {
  it('makes a first message its own correlation root', () => {
    const envelope = createEnvelope(total, { messageType: 'amount.quoted.v1' });

    expect(envelope.correlationId).toBe(envelope.messageId);
    expect(envelope.causationId).toBeNull();
    expect(envelope.idempotencyKey).toBe(envelope.messageId);
    expect(envelope.payload).toBe(total);
  });

  it('stamps an ISO-8601 timestamp', () => {
    const envelope = createEnvelope(total, { messageType: 'amount.quoted.v1' });

    expect(new Date(envelope.occurredAt).toISOString()).toBe(envelope.occurredAt);
  });

  it('keeps the caller-supplied tracing fields untouched', () => {
    const envelope = createEnvelope(total, {
      messageType: 'amount.quoted.v1',
      correlationId: 'correlation-1',
      causationId: 'message-0',
      idempotencyKey: 'transfer-42',
    });

    expect(envelope.correlationId).toBe('correlation-1');
    expect(envelope.causationId).toBe('message-0');
    expect(envelope.idempotencyKey).toBe('transfer-42');
  });

  it('carries the correlation forward and records what caused the follow-up', () => {
    const cause = createEnvelope(total, { messageType: 'amount.quoted.v1' });
    const effect = followUpEnvelope(cause, total, { messageType: 'amount.settled.v1' });

    expect(effect.correlationId).toBe(cause.correlationId);
    expect(effect.causationId).toBe(cause.messageId);
    expect(effect.messageId).not.toBe(cause.messageId);
  });

  it('gives every message a distinct id so a redelivery is recognisable', () => {
    const first = createEnvelope(total, { messageType: 'amount.quoted.v1' });
    const second = createEnvelope(total, { messageType: 'amount.quoted.v1' });

    expect(first.messageId).not.toBe(second.messageId);
  });
});
