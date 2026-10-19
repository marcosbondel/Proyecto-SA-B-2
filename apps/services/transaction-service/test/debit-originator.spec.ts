import { createEnvelope } from '@bank/contracts';
import type { Identity, MessageEnvelope } from '@bank/contracts';
import type { MessageBroker } from '@bank/messaging';

import { BrokerEventPublisher } from '../src/infrastructure/messaging/broker-event.publisher';

/**
 * T-60 — the debit has to say **who ordered it**, because Account Service
 * decides ownership from the envelope and from nothing else.
 *
 * Transaction Service does not put the originator in the payload: the contracts
 * already guarantee a follow-up keeps the identity of the message that caused
 * it. This pins that guarantee at the one place that matters — the command that
 * moves the money — so a refactor of the publisher cannot drop it silently and
 * turn every transfer into "nobody ordered this".
 */
const SOURCE = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';
const TRANSACTION = '7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70';
const ORIGINATOR: Identity = {
  customerId: '77777777-7777-4777-8777-777777777701',
  role: 'CLIENTE',
};

function causedBy(identity: Identity | null): MessageEnvelope<unknown> {
  return createEnvelope(
    {},
    { messageType: 'customer.kyc.checked.v1', producer: 'customer-service', identity },
  );
}

describe('the debit command carries the identity of whoever ordered the transfer', () => {
  const debit = {
    messageType: 'account.debit.requested.v1',
    payload: {
      transactionId: TRANSACTION,
      accountId: SOURCE,
      amount: { amountMinor: 2_500, currency: 'GTQ' },
    },
  };

  it('keeps the originator`s identity from the message that caused it', () => {
    const publisher = new BrokerEventPublisher({} as MessageBroker).forCause(causedBy(ORIGINATOR));

    const { envelope } = publisher.envelopeFor(debit, 'command');

    expect(envelope.identity).toEqual(ORIGINATOR);
  });

  it('does not invent one when the cause had none', () => {
    const publisher = new BrokerEventPublisher({} as MessageBroker).forCause(causedBy(null));

    expect(publisher.envelopeFor(debit, 'command').envelope.identity).toBeNull();
  });
});
