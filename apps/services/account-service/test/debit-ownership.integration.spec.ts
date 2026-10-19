import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import type { Identity } from '@bank/contracts';

import { DebitAccountUseCase } from '../src/application/debit-account.use-case';
import { credit, openAccount } from '../src/domain/account';
import { quetzales } from '../src/domain/money';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresAccountRepository } from '../src/infrastructure/persistence/postgres-account.repository';
import { FixedClock, RecordingActivity, RecordingPublisher } from './support/in-memory';

/**
 * T-60 against a real PostgreSQL: the debit of a transfer is the owner's to
 * order, decided under the same row lock that moves the balance.
 *
 * A double can show that `mayDebit` is consulted. Only a database shows that it
 * is consulted against **the row the lock holds** while other debits are in
 * flight, which is the property that makes the check impossible to race.
 *
 * Requires `DATABASE_URL`; skipped without it, like the other integration
 * suites of this service.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

const NOW = new Date('2026-10-19T12:00:00.000Z');
const OWNER = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';
const INTRUDER = '1e2d3c4b-5a69-4f78-9012-3456789abcde';

const AS_OWNER: Identity = { customerId: OWNER, role: 'CLIENTE' };
const AS_INTRUDER: Identity = { customerId: INTRUDER, role: 'CLIENTE' };
const AS_TELLER: Identity = { customerId: randomUUID(), role: 'CAJERO_RECEPTOR' };

describeIntegration('the debit ownership check under the row lock (T-60)', () => {
  let pool: Pool;
  let repository: PostgresAccountRepository;
  let publisher: RecordingPublisher;
  let useCase: DebitAccountUseCase;

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      console.warn('Skipping debit ownership integration tests: DATABASE_URL is not set.');

      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
    repository = new PostgresAccountRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE account_anomalies, account_operations, accounts, processed_messages, deactivation_runs',
    );
    publisher = new RecordingPublisher();
    useCase = new DebitAccountUseCase({
      repository,
      publisher,
      clock: new FixedClock(NOW),
      activity: new RecordingActivity(),
    });
  });

  async function seedOwnedBy(customerId: string, balanceMinor: number): Promise<string> {
    const { account } = await repository.openAccount({
      account: openAccount({
        accountId: randomUUID(),
        customerId,
        accountType: 'MONETARIA',
        now: NOW,
      }),
      idempotency: {
        idempotencyKey: randomUUID(),
        messageType: 'account.create.v1',
        resultSummary: { outcome: 'OPENED' },
      },
    });

    await repository.applyMovement({
      accountId: account.accountId,
      type: 'CREDIT',
      transactionId: null,
      idempotencyKey: randomUUID(),
      messageType: 'account.credit.requested.v1',
      decide: (found) => credit(found, quetzales(balanceMinor), NOW),
      now: NOW,
    });

    return account.accountId;
  }

  const command = (accountId: string, amountMinor = 2_500) => ({
    transactionId: randomUUID(),
    accountId,
    amount: quetzales(amountMinor),
  });

  async function operationsOf(accountId: string): Promise<string[]> {
    const rows = await pool.query<{ type: string }>(
      "SELECT type FROM account_operations WHERE account_id = $1 AND type <> 'CREDIT'",
      [accountId],
    );

    return rows.rows.map((row) => row.type);
  }

  it('refuses a customer debiting an account that is not theirs: no balance change, no DEBIT row', async () => {
    const accountOfOwner = await seedOwnedBy(OWNER, 10_000);

    await useCase.execute(command(accountOfOwner), AS_INTRUDER, randomUUID());

    expect((await repository.findById(accountOfOwner))?.balanceMinor).toBe(10_000);
    expect(await operationsOf(accountOfOwner)).toEqual([]);
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]).toMatchObject({
      messageType: 'account.debit.rejected.v1',
      payload: { reason: 'ACCOUNT_NOT_FOUND' },
    });
  });

  it('keeps the true cause in this service`s own record, and the same answer on redelivery', async () => {
    const accountOfOwner = await seedOwnedBy(OWNER, 10_000);
    const attempt = command(accountOfOwner);
    const key = randomUUID();

    await useCase.execute(attempt, AS_INTRUDER, key);
    await useCase.execute(attempt, AS_INTRUDER, key);
    // Even the owner replaying the intruder's key gets the recorded answer, not a debit.
    await useCase.execute(attempt, AS_OWNER, key);

    const recorded = await pool.query<{ result_summary: Record<string, unknown> }>(
      'SELECT result_summary FROM processed_messages WHERE idempotency_key = $1',
      [key],
    );

    expect(recorded.rows).toHaveLength(1);
    expect(recorded.rows[0]?.result_summary).toMatchObject({
      outcome: 'REJECTED',
      reason: 'ACCOUNT_NOT_FOUND',
      cause: 'FORBIDDEN_ACCOUNT_ACCESS',
    });
    expect((await repository.findById(accountOfOwner))?.balanceMinor).toBe(10_000);
    expect(publisher.typesPublished()).toEqual([
      'account.debit.rejected.v1',
      'account.debit.rejected.v1',
      'account.debit.rejected.v1',
    ]);
  });

  it('debits the owner`s account and lets a teller order it on their behalf', async () => {
    const accountOfOwner = await seedOwnedBy(OWNER, 10_000);

    await useCase.execute(command(accountOfOwner), AS_OWNER, randomUUID());
    await useCase.execute(command(accountOfOwner), AS_TELLER, randomUUID());

    expect((await repository.findById(accountOfOwner))?.balanceMinor).toBe(5_000);
    expect(await operationsOf(accountOfOwner)).toEqual(['DEBIT', 'DEBIT']);
  });

  it('refuses a debit that carries no identity at all', async () => {
    const accountOfOwner = await seedOwnedBy(OWNER, 10_000);

    await useCase.execute(command(accountOfOwner), null, randomUUID());

    expect((await repository.findById(accountOfOwner))?.balanceMinor).toBe(10_000);
    expect(publisher.events[0]).toMatchObject({ messageType: 'account.debit.rejected.v1' });
  });

  it('moves exactly the owner`s debits when owner and intruder race on the same row', async () => {
    const accountOfOwner = await seedOwnedBy(OWNER, 10_000);

    await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        useCase.execute(
          command(accountOfOwner, 100),
          index % 2 === 0 ? AS_OWNER : AS_INTRUDER,
          randomUUID(),
        ),
      ),
    );

    // Ten owner debits of Q1.00 each; the ten from the other customer moved nothing.
    expect((await repository.findById(accountOfOwner))?.balanceMinor).toBe(9_000);
    expect(await operationsOf(accountOfOwner)).toHaveLength(10);
    expect(
      publisher.events.filter((event) => event.messageType === 'account.debit.rejected.v1'),
    ).toHaveLength(10);
  });
});
