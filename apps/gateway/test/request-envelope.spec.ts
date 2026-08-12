import { envelopeForRequest } from '../src/application/request-envelope';

describe('gateway request envelope', () => {
  it('wraps a payload in the shared transport shape', () => {
    const envelope = envelopeForRequest({ reference: 'INV-1' }, 'amount.quoted.v1');

    expect(envelope.messageType).toBe('amount.quoted.v1');
    expect(envelope.correlationId).toBe(envelope.messageId);
    expect(envelope.payload).toEqual({ reference: 'INV-1' });
  });

  it('keeps an incoming correlation id so a retry stays on the same trace', () => {
    const envelope = envelopeForRequest({ reference: 'INV-1' }, 'amount.quoted.v1', 'trace-7');

    expect(envelope.correlationId).toBe('trace-7');
  });
});
