import { createEnvelope } from '@bank/contracts';
import type { MessageBroker } from '@bank/messaging';

import { BrokerPublisherAdapter } from '../src/infrastructure/messaging/broker-publisher.adapter';

describe('BrokerPublisherAdapter with the broker gone', () => {
  const envelope = createEnvelope(
    { accountId: '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93' },
    {
      messageType: 'account.balance.query.v1',
      producer: 'gateway',
      identity: null,
    },
  );

  it('answers BROKER_UNAVAILABLE at once, without handing the publish to the library', async () => {
    const publish = jest.fn().mockReturnValue(new Promise<void>(() => undefined));
    const broker = { isConnected: () => false, publish } as unknown as MessageBroker;

    await expect(new BrokerPublisherAdapter(broker).publish(envelope)).rejects.toMatchObject({
      type: 'BROKER_UNAVAILABLE',
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes normally while the connection is up', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const broker = { isConnected: () => true, publish } as unknown as MessageBroker;

    await new BrokerPublisherAdapter(broker).publish(envelope);

    expect(publish).toHaveBeenCalledTimes(1);
  });
});
