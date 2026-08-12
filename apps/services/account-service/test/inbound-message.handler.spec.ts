import { createEnvelope } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';

import { InboundMessageRouter } from '../src/interfaces/inbound-message.handler';
import type { InboundMessageHandler } from '../src/interfaces/inbound-message.handler';

const recordingHandler = (messageType: string, seen: MessageEnvelope<unknown>[]) =>
  ({
    messageType,
    handle: async (envelope) => {
      seen.push(envelope);
    },
  }) satisfies InboundMessageHandler;

describe('account-service inbound message router', () => {
  it('hands a delivery to the handler that claimed its type', async () => {
    const seen: MessageEnvelope<unknown>[] = [];
    const router = new InboundMessageRouter([recordingHandler('amount.quoted.v1', seen)]);
    const envelope = createEnvelope({ reference: 'INV-1' }, { messageType: 'amount.quoted.v1' });

    await expect(router.route(envelope)).resolves.toBe(true);
    expect(seen).toEqual([envelope]);
  });

  it('reports an unclaimed message instead of failing', async () => {
    const router = new InboundMessageRouter([recordingHandler('amount.quoted.v1', [])]);
    const envelope = createEnvelope({}, { messageType: 'something.else.v1' });

    await expect(router.route(envelope)).resolves.toBe(false);
  });

  it('refuses two handlers claiming the same type', () => {
    const seen: MessageEnvelope<unknown>[] = [];

    expect(
      () =>
        new InboundMessageRouter([
          recordingHandler('amount.quoted.v1', seen),
          recordingHandler('amount.quoted.v1', seen),
        ]),
    ).toThrow(/Two handlers claim/);
  });
});
