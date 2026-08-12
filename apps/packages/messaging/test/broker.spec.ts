import { createEnvelope } from '@bank/contracts';

import { parseEnvelope } from '../src';

// These tests exercise the wire format only. Anything that needs a live broker
// belongs to the local stack, which arrives with T-06.

describe('envelope wire format', () => {
  it('round-trips an envelope through the delivery body', () => {
    const original = createEnvelope({ reference: 'INV-1' }, { messageType: 'amount.quoted.v1' });

    const restored = parseEnvelope(Buffer.from(JSON.stringify(original)));

    expect(restored).toEqual(original);
  });

  it('refuses a body that is not an envelope', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));

    expect(() => parseEnvelope(body)).toThrow(/well-formed message envelope/);
  });

  it('refuses a body that is missing a tracing field', () => {
    const original = createEnvelope({ reference: 'INV-1' }, { messageType: 'amount.quoted.v1' });
    const { idempotencyKey, ...incomplete } = original;
    void idempotencyKey;

    expect(() => parseEnvelope(Buffer.from(JSON.stringify(incomplete)))).toThrow(
      /well-formed message envelope/,
    );
  });
});
