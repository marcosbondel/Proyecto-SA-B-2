import { DepositUseCase } from '../src/application/deposit.use-case';
import { openAccount } from '../src/domain/account';
import {
  FixedClock,
  InMemoryAccountRepository,
  RecordingActivity,
  RecordingPublisher,
} from './support/in-memory';

/**
 * `A-05` — cash taken at a window.
 *
 * The properties worth asserting are the ones that make a deposit *not* a
 * transfer: it needs no counterparty and no Saga, it is refused to a client
 * because it mints money into an account from outside the system, and — the one
 * that reads backwards until you think about it — **it is not refused for an
 * inactive account**. A deposit into a dormant account is the one thing that
 * should still work, and it wakes the account up (A-3). Refusing it would mean
 * telling somebody the money in their hand cannot go into their own account
 * until they first put money into it.
 */

const NOW = new Date('2026-08-30T12:00:00.000Z');
const ACCOUNT = '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60';
const CUSTOMER = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';
const DEPOSIT = '2c4e6a80-1b3d-4f57-9a02-3b4c5d6e7f81';

const CLIENT = { customerId: CUSTOMER, role: 'CLIENTE' as const };
const TELLER = {
  customerId: 'a0b1c2d3-e4f5-4061-8273-8495a6b7c8d9',
  role: 'CAJERO_RECEPTOR' as const,
};
const ADMIN = {
  customerId: 'b1c2d3e4-f506-4172-8384-95a6b7c8d9e0',
  role: 'ADMINISTRADOR' as const,
};

const PAYLOAD = {
  depositId: DEPOSIT,
  accountId: ACCOUNT,
  amount: { amountMinor: 40_000, currency: 'GTQ' },
  description: 'Depósito en efectivo, Agencia Central',
};

function fixture(status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE', balanceMinor = 0) {
  const repository = new InMemoryAccountRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(NOW);
  const activity = new RecordingActivity();

  repository.accounts.set(ACCOUNT, {
    ...openAccount({
      accountId: ACCOUNT,
      customerId: CUSTOMER,
      accountType: 'MONETARIA' as const,
      now: NOW,
    }),
    balanceMinor,
    status,
  });

  return {
    repository,
    publisher,
    activity,
    deposit: new DepositUseCase({ repository, publisher, clock, activity }),
  };
}

const typesOf = (publisher: RecordingPublisher): string[] => publisher.typesPublished();

describe('taking a deposit at a window', () => {
  it('credits the account and says so, with the resulting balance', async () => {
    const { repository, publisher, deposit } = fixture('ACTIVE', 10_000);

    await deposit.execute(PAYLOAD, TELLER, 'key-1');

    expect(typesOf(publisher)).toEqual(['account.deposited.v1']);

    const event = publisher.events[0]!.payload as {
      depositId: string;
      balanceAfter: { amountMinor: number };
      reactivated: boolean;
    };

    expect(event.depositId).toBe(DEPOSIT);
    expect(event.balanceAfter.amountMinor).toBe(50_000);
    expect(event.reactivated).toBe(false);
    expect(repository.accounts.get(ACCOUNT)!.balanceMinor).toBe(50_000);
  });

  it('is a movement with no transaction, because nothing is being orchestrated', async () => {
    const { repository, deposit } = fixture();

    await deposit.execute(PAYLOAD, TELLER, 'key-1');

    const movement = repository.operations.at(-1)!;

    expect(movement.type).toBe('CREDIT');
    expect(movement.transactionId).toBeNull();
  });

  it('an administrator may take one too', async () => {
    const { publisher, deposit } = fixture();

    await deposit.execute(PAYLOAD, ADMIN, 'key-1');

    expect(typesOf(publisher)).toEqual(['account.deposited.v1']);
  });

  /**
   * The one refusal that is about who asked rather than about the money. It is
   * checked here and at the Gateway, and the duplication is deliberate: this
   * command adds money from outside the system, so the service that moves the
   * balance must be sure a teller asked for it.
   */
  it.each([
    ['a client', CLIENT],
    ['nobody at all', null],
  ])('is refused for %s, and no money moves', async (_who, actor) => {
    const { repository, publisher, deposit } = fixture('ACTIVE', 10_000);

    await deposit.execute(PAYLOAD, actor, 'key-1');

    expect(typesOf(publisher)).toEqual(['account.deposit.rejected.v1']);
    expect((publisher.events[0]!.payload as { reason: string }).reason).toBe(
      'FORBIDDEN_ACCOUNT_ACCESS',
    );
    expect(repository.accounts.get(ACCOUNT)!.balanceMinor).toBe(10_000);
  });

  it('refuses an account that does not exist', async () => {
    const { publisher, deposit } = fixture();

    await deposit.execute(
      { ...PAYLOAD, accountId: '00000000-0000-4000-8000-000000000000' },
      TELLER,
      'key-1',
    );

    expect((publisher.events[0]!.payload as { reason: string }).reason).toBe(
      'ACCOUNT_NOT_FOUND',
    );
  });

  /**
   * Not `ACCOUNT_INACTIVE`. A deposit is the one movement that should reach a
   * dormant account, and it wakes it up — the same invariant the Saga's credit
   * obeys (A-3), reached through the same domain rule.
   */
  it('wakes a dormant account rather than refusing it', async () => {
    const { repository, publisher, deposit } = fixture('INACTIVE', 4_000);

    await deposit.execute(PAYLOAD, TELLER, 'key-1');

    expect(typesOf(publisher)).toEqual(['account.deposited.v1', 'account.reactivated.v1']);
    expect((publisher.events[0]!.payload as { reactivated: boolean }).reactivated).toBe(true);
    expect(repository.accounts.get(ACCOUNT)!.status).toBe('ACTIVE');
  });

  /**
   * At-least-once delivery, and the case that matters most in this whole
   * feature: a redelivered deposit must not credit twice, and must still answer
   * — a teller waiting out a five-second timeout is a teller who takes the
   * money again.
   */
  it('credits once and answers twice when the command is redelivered', async () => {
    const { repository, publisher, deposit } = fixture('ACTIVE', 10_000);

    await deposit.execute(PAYLOAD, TELLER, 'key-1');
    await deposit.execute(PAYLOAD, TELLER, 'key-1');

    expect(typesOf(publisher)).toEqual(['account.deposited.v1', 'account.deposited.v1']);
    expect(repository.accounts.get(ACCOUNT)!.balanceMinor).toBe(50_000);

    const [first, second] = publisher.events.map(
      (message) => message.payload as { operationId: string; balanceAfter: { amountMinor: number } },
    );

    // The second answer names the same movement, not a new one.
    expect(second!.operationId).toBe(first!.operationId);
    expect(second!.balanceAfter.amountMinor).toBe(50_000);
  });

  it('repeats a refusal on redelivery instead of reconsidering it', async () => {
    const { publisher, deposit } = fixture();

    await deposit.execute(PAYLOAD, CLIENT, 'key-1');
    // Even with a teller the second time: the first delivery settled it.
    await deposit.execute(PAYLOAD, TELLER, 'key-1');

    expect(typesOf(publisher)).toEqual([
      'account.deposit.rejected.v1',
      'account.deposit.rejected.v1',
    ]);
  });
});

describe('reporting the deposit to the activity monitor (T-42)', () => {
  it('reports it as a credit with no transaction, because that is how it enters the account', async () => {
    const { activity, deposit } = fixture();

    await deposit.execute(PAYLOAD, TELLER, 'key-1');

    expect(activity.movements).toMatchObject([
      { type: 'CREDIT', transactionId: null, account: { accountId: ACCOUNT, customerId: CUSTOMER } },
    ]);
  });

  it('does not report a refused deposit, nor a redelivered one twice', async () => {
    const { activity, deposit } = fixture();

    await deposit.execute(PAYLOAD, CLIENT, 'key-refused');
    expect(activity.movements).toEqual([]);

    await deposit.execute(PAYLOAD, TELLER, 'key-1');
    await deposit.execute(PAYLOAD, TELLER, 'key-1');
    expect(activity.movements).toHaveLength(1);
  });
});
