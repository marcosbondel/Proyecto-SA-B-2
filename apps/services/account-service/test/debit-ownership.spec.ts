import { createEnvelope } from '@bank/contracts';
import type { Identity } from '@bank/contracts';

import { DebitAccountUseCase } from '../src/application/debit-account.use-case';
import { quetzales } from '../src/domain/money';
import { DebitAccountHandler } from '../src/interfaces/message-handlers';
import {
  FixedClock,
  InMemoryAccountRepository,
  RecordingActivity,
  RecordingPublisher,
  cuentaPersistida,
} from './support/in-memory';

const NOW = new Date('2026-10-19T12:00:00.000Z');

const ACCOUNT_OF_B = '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60';
const CUSTOMER_A = '1e2d3c4b-5a69-4f78-9012-3456789abcde';
const CUSTOMER_B = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';
const TRANSACTION = '7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70';

const AS_A: Identity = { customerId: CUSTOMER_A, role: 'CLIENTE' };
const AS_B: Identity = { customerId: CUSTOMER_B, role: 'CLIENTE' };
const TELLER: Identity = {
  customerId: 'a0b1c2d3-e4f5-4061-8273-8495a6b7c8d9',
  role: 'CAJERO_RECEPTOR',
};
const ADMIN: Identity = {
  customerId: 'b1c2d3e4-f506-4172-8384-95a6b7c8d9e0',
  role: 'ADMINISTRADOR',
};

/**
 * T-60 — the debit of a transfer must belong to the person who ordered it.
 *
 * These go through `DebitAccountHandler`, the real entry point, because the
 * defect was in what the handler threw away: the envelope's identity.
 */
function fixture() {
  const repository = new InMemoryAccountRepository();
  const publisher = new RecordingPublisher();
  const useCase = new DebitAccountUseCase({
    repository,
    publisher,
    clock: new FixedClock(NOW),
    activity: new RecordingActivity(),
  });

  repository.accounts.set(ACCOUNT_OF_B, {
    ...cuentaPersistida({
      accountId: ACCOUNT_OF_B,
      customerId: CUSTOMER_B,
      accountType: 'MONETARIA',
      now: NOW,
    }),
    balanceMinor: 10_000,
  });

  const handler = new DebitAccountHandler(useCase);

  const debitAs = async (identity: Identity | null, amountMinor = 2_500): Promise<void> => {
    await handler.handle(
      createEnvelope(
        { transactionId: TRANSACTION, accountId: ACCOUNT_OF_B, amount: quetzales(amountMinor) },
        {
          messageType: 'account.debit.requested.v1',
          producer: 'transaction-service',
          identity,
        },
      ),
    );
  };

  return { repository, publisher, debitAs };
}

describe('the debit of a transfer belongs to the person who ordered it', () => {
  it('REFUSES a CLIENTE naming somebody else`s account, and moves nothing', async () => {
    const { repository, publisher, debitAs } = fixture();

    await debitAs(AS_A);

    expect(repository.accounts.get(ACCOUNT_OF_B)?.balanceMinor).toBe(10_000);
    expect(publisher.typesPublished()).toEqual(['account.debit.rejected.v1']);
  });

  it('answers a foreign account exactly as it answers one that does not exist', async () => {
    const foreign = fixture();
    const missing = fixture();
    missing.repository.accounts.clear();

    await foreign.debitAs(AS_A);
    await missing.debitAs(AS_A);

    expect(foreign.publisher.events).toEqual(missing.publisher.events);
    expect(foreign.publisher.events[0]?.payload).toMatchObject({ reason: 'ACCOUNT_NOT_FOUND' });
  });

  it('decides ownership before the funds, so a foreign account never reveals its balance', async () => {
    const { publisher, debitAs } = fixture();

    await debitAs(AS_A, 99_999_999);

    expect(publisher.events[0]?.payload).toMatchObject({ reason: 'ACCOUNT_NOT_FOUND' });
  });

  it('debits the owner`s own account', async () => {
    const { repository, publisher, debitAs } = fixture();

    await debitAs(AS_B);

    expect(repository.accounts.get(ACCOUNT_OF_B)?.balanceMinor).toBe(7_500);
    expect(publisher.typesPublished()).toEqual(['account.debited.v1']);
  });

  it.each([
    ['a teller at the window', TELLER],
    ['an administrator', ADMIN],
  ])(
    'lets %s originate a transfer on behalf of a customer (D-06, CDU003.1)',
    async (_name, staff) => {
      const { repository, publisher, debitAs } = fixture();

      await debitAs(staff);

      expect(repository.accounts.get(ACCOUNT_OF_B)?.balanceMinor).toBe(7_500);
      expect(publisher.typesPublished()).toEqual(['account.debited.v1']);
    },
  );

  it('refuses a debit nobody ordered: no identity is not "the system"', async () => {
    const { repository, publisher, debitAs } = fixture();

    await debitAs(null);

    expect(repository.accounts.get(ACCOUNT_OF_B)?.balanceMinor).toBe(10_000);
    expect(publisher.typesPublished()).toEqual(['account.debit.rejected.v1']);
  });

  it('keeps the refusal on redelivery instead of debiting the second time', async () => {
    const { repository, publisher, debitAs } = fixture();
    const envelope = createEnvelope(
      { transactionId: TRANSACTION, accountId: ACCOUNT_OF_B, amount: quetzales(2_500) },
      {
        messageType: 'account.debit.requested.v1',
        producer: 'transaction-service',
        identity: AS_A,
      },
    );
    const useCase = new DebitAccountUseCase({
      repository,
      publisher,
      clock: new FixedClock(NOW),
      activity: new RecordingActivity(),
    });
    const handler = new DebitAccountHandler(useCase);

    await handler.handle(envelope);
    await handler.handle(envelope);
    await debitAs(AS_A);

    expect(repository.accounts.get(ACCOUNT_OF_B)?.balanceMinor).toBe(10_000);
    expect(publisher.typesPublished().every((type) => type === 'account.debit.rejected.v1')).toBe(
      true,
    );
  });
});
