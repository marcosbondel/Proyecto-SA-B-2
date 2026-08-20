import { envelopeForRequest } from '../src/application/request-envelope';

const IDENTITY = { customerId: '55555555-5555-4555-8555-555555555555', role: 'CLIENTE' } as const;
const CORRELATION = '7c1a5e28-3b4f-4d90-a6e2-1f8b0c3d5a47';

describe('gateway request envelope', () => {
  it('wraps a payload in the shared transport shape', () => {
    const envelope = envelopeForRequest({ accountId: '1' }, 'account.balance.query.v1', IDENTITY);

    expect(envelope.messageType).toBe('account.balance.query.v1');
    expect(envelope.correlationId).toBe(envelope.messageId);
    expect(envelope.payload).toEqual({ accountId: '1' });
  });

  it('keeps an incoming correlation id so a retry stays on the same trace', () => {
    const envelope = envelopeForRequest(
      { accountId: '1' },
      'account.balance.query.v1',
      IDENTITY,
      CORRELATION,
    );

    expect(envelope.correlationId).toBe(CORRELATION);
  });

  it('stamps the gateway as producer, since it is the only one that starts a flow', () => {
    expect(envelopeForRequest({}, 'account.balance.query.v1', IDENTITY).producer).toBe('gateway');
  });

  it('carries the identity it verified, so no service re-checks the token', () => {
    expect(envelopeForRequest({}, 'account.balance.query.v1', IDENTITY).identity).toEqual(IDENTITY);
  });

  it('accepts a null identity for work no user originated', () => {
    expect(envelopeForRequest({}, 'account.balance.query.v1', null).identity).toBeNull();
  });
});
