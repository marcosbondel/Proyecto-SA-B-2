import { CompensateDebitUseCase } from '../src/application/compensate-debit.use-case';
import { CreateAccountUseCase } from '../src/application/create-account.use-case';
import { CreditAccountUseCase } from '../src/application/credit-account.use-case';
import { InterbankAccountUseCase } from '../src/application/interbank-account.use-case';
import { DeactivateInactiveAccountsUseCase } from '../src/application/deactivate-inactive-accounts.use-case';
import { DebitAccountUseCase } from '../src/application/debit-account.use-case';
import { GetBalanceUseCase } from '../src/application/get-balance.use-case';
import { GetOperationsUseCase } from '../src/application/get-operations.use-case';
import { ListAccountsUseCase } from '../src/application/list-accounts.use-case';
import { SetAccountStatusUseCase } from '../src/application/set-account-status.use-case';
import { quetzales } from '../src/domain/money';
import {
  FixedClock,
  InMemoryAccountRepository,
  RecordingActivity,
  RecordingPublisher,
  cuentaPersistida,
} from './support/in-memory';

const NOW = new Date('2026-08-26T12:00:00.000Z');

const ACCOUNT = '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60';
const OTHER_ACCOUNT = '5b8e0f25-7c36-4a94-8d12-9f6b3e8c5a71';
const CUSTOMER = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';
const OTHER_CUSTOMER = '1e2d3c4b-5a69-4f78-9012-3456789abcde';
const TRANSACTION = '7c9f1a30-2b48-4d56-9e01-2f3a4b5c6d70';

const CLIENT = { customerId: CUSTOMER, role: 'CLIENTE' as const };
const TELLER = {
  customerId: 'a0b1c2d3-e4f5-4061-8273-8495a6b7c8d9',
  role: 'CAJERO_RECEPTOR' as const,
};
const ADMIN = {
  customerId: 'b1c2d3e4-f506-4172-8384-95a6b7c8d9e0',
  role: 'ADMINISTRADOR' as const,
};

function fixture() {
  const repository = new InMemoryAccountRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(NOW);
  const activity = new RecordingActivity();

  return {
    repository,
    publisher,
    clock,
    activity,
    dependencies: { repository, publisher, clock, activity },
  };
}

function seed(
  repository: InMemoryAccountRepository,
  overrides: {
    accountId?: string;
    customerId?: string;
    balanceMinor?: number;
    status?: 'ACTIVE' | 'INACTIVE';
    accountType?: 'MONETARIA' | 'AHORRO';
  } = {},
) {
  const account = {
    ...cuentaPersistida({
      accountId: overrides.accountId ?? ACCOUNT,
      customerId: overrides.customerId ?? CUSTOMER,
      accountType: overrides.accountType ?? ('MONETARIA' as const),
      now: NOW,
    }),
    balanceMinor: overrides.balanceMinor ?? 0,
    status: overrides.status ?? ('ACTIVE' as const),
  };

  repository.accounts.set(account.accountId, account);

  return account;
}

describe('incoming interbank deposits', () => {
  const query = { depositId: TRANSACTION, accountId: ACCOUNT };
  const command = { ...query, amount: quetzales(12500) };

  it('answers eligibility without changing the account', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository);
    const useCase = new InterbankAccountUseCase(dependencies);

    await useCase.eligibility(query);

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(0);
    expect(publisher.replies).toMatchObject([
      {
        messageType: 'account.interbank.eligibility.replied.v1',
        payload: { eligible: true, reason: null },
      },
    ]);
  });

  it('credits once and republishes the same verdict on redelivery', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository);
    const useCase = new InterbankAccountUseCase(dependencies);

    await useCase.credit(command);
    await useCase.credit(command);

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(12500);
    expect(publisher.typesPublished()).toEqual([
      'account.interbank.credited.v1',
      'account.interbank.credited.v1',
    ]);
  });

  it('refuses an account deactivated after eligibility without moving money', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { status: 'INACTIVE' });

    await new InterbankAccountUseCase(dependencies).credit(command);

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(0);
    expect(publisher.events[0]).toMatchObject({
      messageType: 'account.interbank.credit.rejected.v1',
      payload: { reason: 'ACCOUNT_INACTIVE' },
    });
  });
});

describe('opening an account', () => {
  const payload = { accountId: ACCOUNT, customerId: CUSTOMER, accountType: 'MONETARIA' as const };

  it('persists it and announces it, at Q0.00', async () => {
    const { repository, publisher, dependencies } = fixture();

    await new CreateAccountUseCase(dependencies).execute(payload, CLIENT, 'key-1');

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(0);
    expect(publisher.typesPublished()).toEqual(['account.opened.v1']);
    expect(publisher.events[0]?.payload).toMatchObject({
      accountId: ACCOUNT,
      status: 'ACTIVE',
      balance: quetzales(0),
    });
  });

  it('lets a teller open one for a client', async () => {
    const { publisher, dependencies } = fixture();

    await new CreateAccountUseCase(dependencies).execute(payload, TELLER, 'key-1');

    expect(publisher.typesPublished()).toEqual(['account.opened.v1']);
  });

  it('refuses a client opening one for somebody else, and says which refusal', async () => {
    const { repository, publisher, dependencies } = fixture();

    await new CreateAccountUseCase(dependencies).execute(
      { ...payload, customerId: OTHER_CUSTOMER },
      CLIENT,
      'key-1',
    );

    expect(repository.accounts.size).toBe(0);
    expect(publisher.typesPublished()).toEqual(['account.open.rejected.v1']);
    expect(publisher.events[0]?.payload).toMatchObject({ reason: 'FORBIDDEN_ACCOUNT_ACCESS' });
  });

  it('refuses staff holding their own account — invariant C-6', async () => {
    const { publisher, dependencies } = fixture();

    await new CreateAccountUseCase(dependencies).execute(
      { ...payload, customerId: ADMIN.customerId },
      ADMIN,
      'key-1',
    );

    expect(publisher.events[0]?.payload).toMatchObject({ reason: 'ROLE_NOT_ELIGIBLE' });
  });

  /**
   * The Gateway mints the id before publishing, so a redelivery carries the
   * same one. Two accounts would be the worst possible outcome; two
   * `account.opened.v1` events for one account is the second worst, because
   * Notification would tell the customer twice.
   */
  it('does not re-announce a redelivered opening', async () => {
    const { repository, publisher, dependencies } = fixture();
    const useCase = new CreateAccountUseCase(dependencies);

    await useCase.execute(payload, CLIENT, 'key-1');
    await useCase.execute(payload, CLIENT, 'key-1');

    expect(repository.accounts.size).toBe(1);
    expect(publisher.typesPublished()).toEqual(['account.opened.v1']);
  });

  /** T-27: AHORRO's minimum opening deposit — a condition of opening, checked once. */
  describe('the AHORRO minimum opening deposit', () => {
    const ahorroPayload = {
      accountId: ACCOUNT,
      customerId: CUSTOMER,
      accountType: 'AHORRO' as const,
    };

    it('refuses to open an AHORRO account below the Q100.00 minimum, and creates nothing', async () => {
      const { repository, publisher, dependencies } = fixture();

      await new CreateAccountUseCase(dependencies).execute(
        { ...ahorroPayload, initialDeposit: quetzales(9_999) },
        CLIENT,
        'key-1',
      );

      expect(repository.accounts.size).toBe(0);
      expect(publisher.typesPublished()).toEqual(['account.open.rejected.v1']);
      expect(publisher.events[0]?.payload).toMatchObject({ reason: 'MINIMUM_BALANCE_VIOLATION' });
    });

    it('opens an AHORRO account at exactly Q100.00', async () => {
      const { repository, publisher, dependencies } = fixture();

      await new CreateAccountUseCase(dependencies).execute(
        { ...ahorroPayload, initialDeposit: quetzales(10_000) },
        CLIENT,
        'key-1',
      );

      expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(10_000);
      expect(publisher.typesPublished()).toEqual(['account.opened.v1']);
      expect(publisher.events[0]?.payload).toMatchObject({ balance: quetzales(10_000) });
    });

    it('refuses an AHORRO opening with no deposit at all', async () => {
      const { repository, publisher, dependencies } = fixture();

      await new CreateAccountUseCase(dependencies).execute(ahorroPayload, CLIENT, 'key-1');

      expect(repository.accounts.size).toBe(0);
      expect(publisher.events[0]?.payload).toMatchObject({ reason: 'MINIMUM_BALANCE_VIOLATION' });
    });

    it('opens a MONETARIA account with no deposit, exactly as before T-27', async () => {
      const { repository, publisher, dependencies } = fixture();

      await new CreateAccountUseCase(dependencies).execute(payload, CLIENT, 'key-1');

      expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(0);
      expect(publisher.typesPublished()).toEqual(['account.opened.v1']);
    });
  });
});

describe('querying a balance', () => {
  it('answers with the balance, the status and the last movement', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 125_000 });

    await new GetBalanceUseCase(dependencies).execute({ accountId: ACCOUNT }, CLIENT);

    expect(publisher.lastReply()).toMatchObject({
      messageType: 'account.balance.replied.v1',
      payload: { outcome: 'FOUND', balance: quetzales(125_000), status: 'ACTIVE' },
    });
  });

  /**
   * Not "forbidden". A distinguishable refusal turns this query into a way to
   * discover which account numbers exist, which is exactly what somebody
   * probing would want.
   */
  it("answers NOT_FOUND for an account that is not the client's", async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { customerId: OTHER_CUSTOMER });

    await new GetBalanceUseCase(dependencies).execute({ accountId: ACCOUNT }, CLIENT);

    expect(publisher.lastReply()?.payload).toEqual({
      outcome: 'NOT_FOUND',
      reason: 'ACCOUNT_NOT_FOUND',
    });
  });

  it('lets staff read any account', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { customerId: OTHER_CUSTOMER });

    await new GetBalanceUseCase(dependencies).execute({ accountId: ACCOUNT }, TELLER);

    expect(publisher.lastReply()?.payload).toMatchObject({ outcome: 'FOUND' });
  });

  it('always replies, so the Gateway never waits out its five seconds', async () => {
    const { publisher, dependencies } = fixture();

    await new GetBalanceUseCase(dependencies).execute({ accountId: ACCOUNT }, CLIENT);

    expect(publisher.replies).toHaveLength(1);
  });
});

describe('listing accounts', () => {
  it('pins a client to their own, whatever they asked for', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository);
    seed(repository, { accountId: OTHER_ACCOUNT, customerId: OTHER_CUSTOMER });

    await new ListAccountsUseCase(dependencies).execute({ customerId: OTHER_CUSTOMER }, CLIENT);

    expect(publisher.lastReply()?.payload).toMatchObject({
      accounts: [expect.objectContaining({ accountId: ACCOUNT })],
    });
  });

  it('lets an administrator see everything', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository);
    seed(repository, { accountId: OTHER_ACCOUNT, customerId: OTHER_CUSTOMER });

    await new ListAccountsUseCase(dependencies).execute({}, ADMIN);

    expect((publisher.lastReply()?.payload as { accounts: unknown[] }).accounts).toHaveLength(2);
  });

  it('answers an empty list rather than an unfiltered one when nobody is identified', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository);

    await new ListAccountsUseCase(dependencies).execute({}, null);

    expect(publisher.lastReply()?.payload).toEqual({ accounts: [] });
  });
});

describe('reading the movements', () => {
  it('returns them for an account this identity may read', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000 });

    await new DebitAccountUseCase(dependencies).execute(
      { transactionId: TRANSACTION, accountId: ACCOUNT, amount: quetzales(2_500) },
      'key-1',
    );
    await new GetOperationsUseCase(dependencies).execute({ accountId: ACCOUNT }, CLIENT);

    expect(publisher.lastReply()?.payload).toMatchObject({
      outcome: 'FOUND',
      operations: [expect.objectContaining({ type: 'DEBIT', balanceAfter: quetzales(7_500) })],
    });
  });

  it("hides another client's statement behind NOT_FOUND", async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { customerId: OTHER_CUSTOMER });

    await new GetOperationsUseCase(dependencies).execute({ accountId: ACCOUNT }, CLIENT);

    expect(publisher.lastReply()?.payload).toEqual({
      outcome: 'NOT_FOUND',
      reason: 'ACCOUNT_NOT_FOUND',
    });
  });
});

describe('debiting, which is criteria 3 and 4', () => {
  const command = { transactionId: TRANSACTION, accountId: ACCOUNT, amount: quetzales(2_500) };

  it('moves the money and announces it', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000 });

    await new DebitAccountUseCase(dependencies).execute(command, 'key-1');

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(7_500);
    expect(publisher.typesPublished()).toEqual(['account.debited.v1']);
    expect(publisher.events[0]?.payload).toMatchObject({ balanceAfter: quetzales(7_500) });
  });

  it('leaves the balance untouched when the funds do not reach, and rejects', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 1_000 });

    await new DebitAccountUseCase(dependencies).execute(command, 'key-1');

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(1_000);
    expect(publisher.typesPublished()).toEqual(['account.debit.rejected.v1']);
    expect(publisher.events[0]?.payload).toMatchObject({ reason: 'INSUFFICIENT_FUNDS' });
  });

  it('rejects rather than throws, so the Saga is not left waiting on a dead letter', async () => {
    const { publisher, dependencies } = fixture();

    await expect(
      new DebitAccountUseCase(dependencies).execute(command, 'key-1'),
    ).resolves.toBeUndefined();

    expect(publisher.events[0]?.payload).toMatchObject({ reason: 'ACCOUNT_NOT_FOUND' });
  });

  it('does not debit twice for two deliveries of one message — criterion 4', async () => {
    const { repository, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000 });
    const useCase = new DebitAccountUseCase(dependencies);

    await useCase.execute(command, 'key-1');
    await useCase.execute(command, 'key-1');

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(7_500);
    expect(repository.operations).toHaveLength(1);
  });

  /**
   * Silence would be wrong here. The Saga may be re-delivering because the
   * first answer was lost, and a duplicate that answers nothing looks exactly
   * like one that was never processed.
   */
  it('re-announces the same verdict on a redelivery instead of going quiet', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000 });
    const useCase = new DebitAccountUseCase(dependencies);

    await useCase.execute(command, 'key-1');
    await useCase.execute(command, 'key-1');

    expect(publisher.typesPublished()).toEqual(['account.debited.v1', 'account.debited.v1']);
    expect(publisher.events[1]?.payload).toEqual(publisher.events[0]?.payload);
  });

  it('re-announces a rejection on a redelivery too', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 100 });
    const useCase = new DebitAccountUseCase(dependencies);

    await useCase.execute(command, 'key-1');
    await useCase.execute(command, 'key-1');

    expect(publisher.typesPublished()).toEqual([
      'account.debit.rejected.v1',
      'account.debit.rejected.v1',
    ]);
  });

  it('refuses an inactive account with its own reason', async () => {
    const { publisher, repository, dependencies } = fixture();
    seed(repository, { balanceMinor: 100_000, status: 'INACTIVE' });

    await new DebitAccountUseCase(dependencies).execute(command, 'key-1');

    expect(publisher.events[0]?.payload).toMatchObject({ reason: 'ACCOUNT_INACTIVE' });
  });
});

describe('the AHORRO commission a debit charges alongside itself (T-27)', () => {
  const command = { transactionId: TRANSACTION, accountId: ACCOUNT, amount: quetzales(2_500) };

  it('publishes account.commission.charged.v1 after account.debited.v1, never before it', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 20_000, accountType: 'AHORRO' });

    await new DebitAccountUseCase(dependencies).execute(command, 'key-1');

    expect(publisher.typesPublished()).toEqual([
      'account.debited.v1',
      'account.commission.charged.v1',
    ]);
    // account.debited.v1 carries the amount alone — never amount + commission.
    expect(publisher.events[0]?.payload).toMatchObject({ amount: quetzales(2_500) });
    expect(publisher.events[1]?.payload).toMatchObject({
      accountId: ACCOUNT,
      transactionId: TRANSACTION,
      amount: quetzales(300),
      balanceAfter: quetzales(17_200),
    });
    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(17_200);
  });

  it('publishes no commission event at all for a MONETARIA debit', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 20_000, accountType: 'MONETARIA' });

    await new DebitAccountUseCase(dependencies).execute(command, 'key-1');

    expect(publisher.typesPublished()).toEqual(['account.debited.v1']);
  });

  it('does not re-publish the commission twice for two deliveries of one message', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 20_000, accountType: 'AHORRO' });
    const useCase = new DebitAccountUseCase(dependencies);

    await useCase.execute(command, 'key-1');
    await useCase.execute(command, 'key-1');

    expect(publisher.typesPublished()).toEqual([
      'account.debited.v1',
      'account.commission.charged.v1',
      'account.debited.v1',
      'account.commission.charged.v1',
    ]);
    expect(repository.operations).toHaveLength(2);
  });

  it('lets an AHORRO debit empty the account — no floor once it is open (T-27, corrected)', async () => {
    const { repository, publisher, dependencies } = fixture();
    // command's amount is Q25.00 (2_500); the Q3.00 commission on top leaves
    // exactly 0. No minimum balance blocks this — that is an opening
    // condition now, not a floor `debit` re-enforces.
    seed(repository, { balanceMinor: 2_800, accountType: 'AHORRO' });

    await new DebitAccountUseCase(dependencies).execute(command, 'key-1');

    expect(publisher.typesPublished()).toEqual([
      'account.debited.v1',
      'account.commission.charged.v1',
    ]);
    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(0);
  });
});

describe('crediting', () => {
  const command = { transactionId: TRANSACTION, accountId: ACCOUNT, amount: quetzales(2_500) };

  it('adds the money and announces it', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 1_000 });

    await new CreditAccountUseCase(dependencies).execute(command, 'key-1');

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(3_500);
    expect(publisher.typesPublished()).toEqual(['account.credited.v1']);
  });

  it('wakes an inactive account and narrates that separately — invariant A-3', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 0, status: 'INACTIVE' });

    await new CreditAccountUseCase(dependencies).execute(command, 'key-1');

    expect(repository.accounts.get(ACCOUNT)?.status).toBe('ACTIVE');
    expect(publisher.typesPublished()).toEqual(['account.credited.v1', 'account.reactivated.v1']);
    expect(publisher.events[0]?.payload).toMatchObject({ reactivated: true });
  });

  it('rejects an unknown account rather than throwing', async () => {
    const { publisher, dependencies } = fixture();

    await new CreditAccountUseCase(dependencies).execute(command, 'key-1');

    expect(publisher.typesPublished()).toEqual(['account.credit.rejected.v1']);
  });

  it('credits once for two deliveries', async () => {
    const { repository, dependencies } = fixture();
    seed(repository, { balanceMinor: 1_000 });
    const useCase = new CreditAccountUseCase(dependencies);

    await useCase.execute(command, 'key-1');
    await useCase.execute(command, 'key-1');

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(3_500);
  });
});

describe('compensating, which is criterion 5', () => {
  const debitCommand = { transactionId: TRANSACTION, accountId: ACCOUNT, amount: quetzales(2_500) };
  const compensation = { ...debitCommand, triggeredBy: 'PAYMENT_DECLINED' as const };

  it('restores the balance exactly once, however many times it is delivered', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000 });

    await new DebitAccountUseCase(dependencies).execute(debitCommand, 'debit-key');

    const useCase = new CompensateDebitUseCase(dependencies);
    await useCase.execute(compensation, 'compensation-key');
    await useCase.execute(compensation, 'compensation-key');
    await useCase.execute(compensation, 'compensation-key');

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(10_000);
    expect(
      repository.operations.filter((operation) => operation.type === 'COMPENSATION'),
    ).toHaveLength(1);
    expect(publisher.typesPublished().filter((type) => type.endsWith('compensated.v1'))).toEqual([
      'account.debit.compensated.v1',
      'account.debit.compensated.v1',
      'account.debit.compensated.v1',
    ]);
  });

  it('marks the original debit COMPENSATED, so a statement does not read as a deposit', async () => {
    const { repository, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000 });

    await new DebitAccountUseCase(dependencies).execute(debitCommand, 'debit-key');
    await new CompensateDebitUseCase(dependencies).execute(compensation, 'compensation-key');

    expect(repository.operations.find((o) => o.type === 'DEBIT')?.status).toBe('COMPENSATED');
  });

  /**
   * The money has already left. Refusing here would strand it outside every
   * account in the system, which is the one outcome a Saga exists to prevent.
   */
  it('returns money to an account that has since been deactivated', async () => {
    const { repository, dependencies } = fixture();
    seed(repository, { balanceMinor: 0, status: 'INACTIVE' });

    await new CompensateDebitUseCase(dependencies).execute(compensation, 'compensation-key');

    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(2_500);
    expect(repository.accounts.get(ACCOUNT)?.status).toBe('INACTIVE');
  });

  it('throws for a missing account, because that needs a person and not a retry ladder', async () => {
    const { dependencies } = fixture();

    await expect(
      new CompensateDebitUseCase(dependencies).execute(compensation, 'compensation-key'),
    ).rejects.toThrow(/nowhere to return to/);
  });

  /**
   * T-29 correction: a compensated `AHORRO` transfer used to return the
   * transfer amount and keep the Q3.00 commission — the bank cancelled the
   * transfer and still charged for moving money that never moved. Found
   * testing T-29's TIMEOUT scenario end to end against the running
   * application, not by any acceptance criterion of T-27 or T-29 on its own.
   */
  it('refunds the AHORRO commission too, so the fee does not survive a compensated transfer', async () => {
    const { repository, dependencies } = fixture();
    seed(repository, { balanceMinor: 20_000, accountType: 'AHORRO' });

    await new DebitAccountUseCase(dependencies).execute(debitCommand, 'debit-key');

    // Amount 2,500 + the Q3.00 (300) commission left the account.
    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(17_200);

    await new CompensateDebitUseCase(dependencies).execute(compensation, 'compensation-key');

    // Back to the exact balance before the transfer.
    expect(repository.accounts.get(ACCOUNT)?.balanceMinor).toBe(20_000);
    expect(repository.operations.find((operation) => operation.type === 'COMMISSION')?.status).toBe(
      'COMPENSATED',
    );
  });
});

describe('an administrator changing the status by hand', () => {
  it('deactivates and announces it', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { balanceMinor: 100 });

    await new SetAccountStatusUseCase(dependencies).execute(
      { accountId: ACCOUNT, status: 'INACTIVE', reason: 'Solicitud del titular' },
      ADMIN,
      'key-1',
    );

    expect(repository.accounts.get(ACCOUNT)?.status).toBe('INACTIVE');
    expect(publisher.events[0]).toMatchObject({
      messageType: 'account.deactivated.v1',
      payload: { cause: 'ADMINISTRATOR' },
    });
  });

  /**
   * The Gateway's guard already refuses everyone else, and this repeats the
   * check because that guard protects an HTTP route while this message could
   * arrive from anywhere on the broker.
   */
  it('allows a teller to change the status of any account', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository);

    await new SetAccountStatusUseCase(dependencies).execute(
      { accountId: ACCOUNT, status: 'INACTIVE', reason: 'Solicitud en ventanilla' },
      TELLER,
      'key-1',
    );

    expect(repository.accounts.get(ACCOUNT)?.status).toBe('INACTIVE');
    expect(publisher.events[0]).toMatchObject({
      messageType: 'account.deactivated.v1',
      payload: { cause: 'TELLER' },
    });
  });

  it('allows a customer to deactivate their own account', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { customerId: CLIENT.customerId });

    await new SetAccountStatusUseCase(dependencies).execute(
      { accountId: ACCOUNT, status: 'INACTIVE', reason: 'Congelamiento voluntario' },
      CLIENT,
      'key-1',
    );

    expect(repository.accounts.get(ACCOUNT)?.status).toBe('INACTIVE');
    expect(publisher.events[0]).toMatchObject({
      messageType: 'account.deactivated.v1',
      payload: { cause: 'CUSTOMER' },
    });
  });

  it("ignores a customer trying to change someone else's account", async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { customerId: 'different-customer-id' });

    await new SetAccountStatusUseCase(dependencies).execute(
      { accountId: ACCOUNT, status: 'INACTIVE', reason: 'Intento no autorizado' },
      CLIENT,
      'key-1',
    );

    expect(repository.accounts.get(ACCOUNT)?.status).toBe('ACTIVE');
    expect(publisher.events).toHaveLength(0);
  });

  it('publishes nothing when the status was already what was asked for', async () => {
    const { repository, publisher, dependencies } = fixture();
    seed(repository, { status: 'INACTIVE' });

    await new SetAccountStatusUseCase(dependencies).execute(
      { accountId: ACCOUNT, status: 'INACTIVE', reason: 'Ya estaba' },
      ADMIN,
      'key-1',
    );

    expect(publisher.events).toHaveLength(0);
  });

  it('does not reset the inactivity clock, so the job still reaches the account', async () => {
    const { repository, dependencies } = fixture();
    const seeded = seed(repository, { status: 'INACTIVE' });

    await new SetAccountStatusUseCase(dependencies).execute(
      { accountId: ACCOUNT, status: 'ACTIVE', reason: 'Reactivación manual' },
      ADMIN,
      'key-1',
    );

    expect(repository.accounts.get(ACCOUNT)?.lastActivityAt).toEqual(seeded.lastActivityAt);
  });
});

describe('the automatic deactivation, as a use case', () => {
  const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

  it('deactivates exactly the accounts that qualify and announces each one', async () => {
    const { repository, publisher, dependencies, clock } = fixture();

    const eligible = seed(repository, { balanceMinor: 4_999 });
    const richEnough = seed(repository, { accountId: OTHER_ACCOUNT, balanceMinor: 5_000 });
    repository.accounts.set(eligible.accountId, { ...eligible, lastActivityAt: LONG_AGO });
    repository.accounts.set(richEnough.accountId, { ...richEnough, lastActivityAt: LONG_AGO });

    clock.advanceTo(new Date('2026-08-26T02:00:00.000Z'));

    const deactivated = await new DeactivateInactiveAccountsUseCase(dependencies).execute('run-1');

    expect(deactivated).toEqual([ACCOUNT]);
    expect(publisher.events[0]).toMatchObject({
      messageType: 'account.deactivated.v1',
      payload: { cause: 'AUTOMATIC_INACTIVITY', balanceAtDeactivation: quetzales(4_999) },
    });
  });

  it('is idempotent: a second run the same day announces nothing', async () => {
    const { repository, publisher, dependencies, clock } = fixture();

    const eligible = seed(repository, { balanceMinor: 0 });
    repository.accounts.set(eligible.accountId, { ...eligible, lastActivityAt: LONG_AGO });
    clock.advanceTo(new Date('2026-08-26T02:00:00.000Z'));

    const useCase = new DeactivateInactiveAccountsUseCase(dependencies);
    await useCase.execute('run-1');
    await useCase.execute('run-2');

    expect(publisher.events).toHaveLength(1);
  });
});

describe('reporting each movement to the activity monitor (T-42)', () => {
  const debitCommand = { transactionId: TRANSACTION, accountId: ACCOUNT, amount: quetzales(2_500) };

  it('reports an applied debit, with the account and the transfer it belongs to', async () => {
    const { repository, activity, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000, accountType: 'AHORRO' });

    await new DebitAccountUseCase(dependencies).execute(debitCommand, 'key-1');

    expect(activity.movements).toHaveLength(1);
    expect(activity.movements[0]).toMatchObject({
      type: 'DEBIT',
      transactionId: TRANSACTION,
      account: { accountId: ACCOUNT, customerId: CUSTOMER, accountType: 'AHORRO' },
    });
  });

  it('does not report a debit that was refused: nothing moved', async () => {
    const { repository, activity, dependencies } = fixture();
    seed(repository, { balanceMinor: 1_000 });

    await new DebitAccountUseCase(dependencies).execute(debitCommand, 'key-1');
    await new DebitAccountUseCase(dependencies).execute(
      { ...debitCommand, accountId: OTHER_ACCOUNT },
      'key-2',
    );

    expect(activity.movements).toEqual([]);
  });

  it('does not report a redelivered debit twice: the movement happened once', async () => {
    const { repository, activity, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000 });

    const useCase = new DebitAccountUseCase(dependencies);
    await useCase.execute(debitCommand, 'key-1');
    await useCase.execute(debitCommand, 'key-1');
    await useCase.execute(debitCommand, 'key-1');

    expect(activity.movements).toHaveLength(1);
  });

  it('reports an applied credit', async () => {
    const { repository, activity, dependencies } = fixture();
    seed(repository, { balanceMinor: 1_000 });

    await new CreditAccountUseCase(dependencies).execute(debitCommand, 'key-1');

    expect(activity.movements).toMatchObject([{ type: 'CREDIT', transactionId: TRANSACTION }]);
  });

  it('does not report a credit to an account that does not exist', async () => {
    const { activity, dependencies } = fixture();

    await new CreditAccountUseCase(dependencies).execute(debitCommand, 'key-1');

    expect(activity.movements).toEqual([]);
  });

  it('reports a compensation as its own kind of movement, once however often it is delivered', async () => {
    const { repository, activity, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000 });
    await new DebitAccountUseCase(dependencies).execute(debitCommand, 'debit-key');

    const useCase = new CompensateDebitUseCase(dependencies);
    const compensation = { ...debitCommand, triggeredBy: 'PAYMENT_DECLINED' as const };
    await useCase.execute(compensation, 'compensation-key');
    await useCase.execute(compensation, 'compensation-key');

    expect(activity.movements.map((movement) => movement.type)).toEqual(['DEBIT', 'COMPENSATION']);
  });

  it('does not report a status change or the automatic deactivation: no balance moved', async () => {
    const { repository, activity, dependencies } = fixture();
    seed(repository, { balanceMinor: 10_000 });

    await new SetAccountStatusUseCase(dependencies).execute(
      { accountId: ACCOUNT, status: 'INACTIVE', reason: 'a reason' },
      { customerId: CUSTOMER, role: 'ADMINISTRADOR' },
      'key-1',
    );

    expect(activity.movements).toEqual([]);
  });
});
