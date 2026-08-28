import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type { Account } from '../../domain/account';
import { minorUnitsFromNumeric, numericFromMinorUnits, quetzales } from '../../domain/money';
import { inactivityThreshold } from '../../domain/deactivation-policy';
import type { DeactivationCriteria } from '../../domain/deactivation-policy';
import type {
  AccountFilter,
  AccountOperation,
  AccountRepository,
  AppliedMovement,
  ProcessedMessage,
} from '../../application/ports';

/**
 * This service's own database, and the place where "the balance is safe" stops
 * being a claim and becomes a mechanism.
 *
 * Three of them, and they are not interchangeable:
 *
 * - **`SELECT ... FOR UPDATE` inside the transaction.** The domain decides
 *   against the row the write is about to overwrite, not against a copy read a
 *   moment earlier. This is what makes "do not debit more than the balance"
 *   true when two debits arrive at once rather than true when they do not.
 * - **`version` in the `WHERE` of the `UPDATE`.** Redundant while the row lock
 *   holds, and deliberately kept: it turns a future refactor that loses the
 *   lock into zero updated rows instead of into lost money.
 * - **`CHECK (balance >= 0)` on the column.** The last line, for when the first
 *   two are wrong.
 *
 * **Lock ordering.** Every statement that can hold more than one account lock
 * takes them `ORDER BY account_id`. No message in the catalogue touches two
 * accounts today — a transfer arrives as a separate debit and credit — so this
 * is a policy written before it is needed rather than after a deadlock.
 */
export class PostgresAccountRepository implements AccountRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async openAccount(input: {
    readonly account: Account;
    readonly idempotency: ProcessedMessage;
  }): Promise<{ readonly account: Account; readonly created: boolean }> {
    return await this.#inTransaction(async (client) => {
      const inserted = await client.query<AccountRow>(
        `INSERT INTO accounts
           (account_id, customer_id, account_type, balance, status, last_activity_at, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4::NUMERIC, 'ACTIVE', $5, 0, $5, $5)
         ON CONFLICT (account_id) DO NOTHING
         RETURNING ${ACCOUNT_COLUMNS}`,
        [
          input.account.accountId,
          input.account.customerId,
          input.account.accountType,
          numericFromMinorUnits(input.account.balanceMinor),
          input.account.openedAt,
        ],
      );

      await recordProcessedWith(client, input.idempotency);

      if (inserted.rowCount === 1) {
        return { account: accountFrom(inserted.rows[0]!), created: true };
      }

      /**
       * The id was already there. That is a redelivery, not a collision: the
       * Gateway mints the identifier before publishing, so the second delivery
       * of one intention carries the same one.
       */
      const existing = await client.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE account_id = $1`,
        [input.account.accountId],
      );

      return { account: accountFrom(existing.rows[0]!), created: false };
    });
  }

  public async findById(accountId: string): Promise<Account | null> {
    const result = await this.#pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE account_id = $1`,
      [accountId],
    );

    return result.rows[0] === undefined ? null : accountFrom(result.rows[0]);
  }

  public async list(filter: AccountFilter): Promise<readonly Account[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    for (const [column, value] of [
      ['customer_id', filter.customerId],
      ['status', filter.status],
      ['account_type', filter.accountType],
    ] as const) {
      if (value !== undefined) {
        values.push(value);
        conditions.push(`${column} = $${String(values.length)}`);
      }
    }

    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;

    const result = await this.#pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts ${where} ORDER BY created_at DESC, account_id`,
      values,
    );

    return result.rows.map(accountFrom);
  }

  public async operationsOf(accountId: string): Promise<readonly AccountOperation[]> {
    const result = await this.#pool.query<OperationRow>(
      `SELECT ${OPERATION_COLUMNS}
         FROM account_operations
        WHERE account_id = $1
        ORDER BY created_at DESC, operation_id`,
      [accountId],
    );

    return result.rows.map(operationFrom);
  }

  public async applyMovement(input: {
    readonly accountId: string;
    readonly type: AccountOperation['type'];
    readonly transactionId: string | null;
    readonly idempotencyKey: string;
    readonly messageType: string;
    readonly decide: (account: Account) => {
      readonly account: Account;
      readonly amount: ReturnType<typeof quetzales>;
      readonly balanceAfter: ReturnType<typeof quetzales>;
      readonly reactivated: boolean;
    };
    readonly compensates?: { readonly transactionId: string };
    readonly now: Date;
  }): Promise<AppliedMovement | null> {
    return await this.#inTransaction(async (client) => {
      const locked = await client.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE account_id = $1 FOR UPDATE`,
        [input.accountId],
      );

      if (locked.rows[0] === undefined) {
        return null;
      }

      const before = accountFrom(locked.rows[0]);

      /**
       * Compensation must not credit unless the debit it reverses exists. The
       * mark-COMPENSATED runs **before** the credit is applied, and a zero
       * `rowCount` means there is no APPLIED debit for this transfer: crediting
       * would create money that never left. We abort the whole transaction
       * instead — nothing is credited — and the message goes to the error path,
       * where the anomaly is recorded (rather than silently making funds).
       * `AND status = 'APPLIED'` also means a debit already compensated will not
       * match, so a duplicate compensation cannot credit twice.
       */
      if (input.compensates !== undefined) {
        const reversed = await client.query(
          `UPDATE account_operations
              SET status = 'COMPENSATED'
            WHERE account_id = $1 AND transaction_id = $2 AND type = 'DEBIT'
              AND status = 'APPLIED'`,
          [input.accountId, input.compensates.transactionId],
        );

        if (reversed.rowCount === 0) {
          throw new Error(
            `Cannot compensate transaction ${input.compensates.transactionId} on account ` +
              `${input.accountId}: no applied debit to reverse. Crediting would create money ` +
              'that never left; this needs a person.',
          );
        }
      }

      // Runs inside the lock. That placement is the whole guarantee.
      const decided = input.decide(before);

      const updated = await client.query(
        `UPDATE accounts
            SET balance = $1::NUMERIC,
                status = $2,
                last_activity_at = $3,
                version = version + 1,
                updated_at = $3
          WHERE account_id = $4 AND version = $5`,
        [
          numericFromMinorUnits(decided.account.balanceMinor),
          decided.account.status,
          input.now,
          input.accountId,
          before.version,
        ],
      );

      if (updated.rowCount !== 1) {
        // Unreachable while the row lock holds. Kept so that a refactor which
        // loses the lock fails loudly instead of overwriting somebody's balance.
        throw new Error(
          `Optimistic lock lost on account ${input.accountId}; the row changed under a held lock.`,
        );
      }

      const operationId = randomUUID();

      await client.query(
        `INSERT INTO account_operations
           (operation_id, account_id, type, amount, balance_after, transaction_id, status, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4::NUMERIC, $5::NUMERIC, $6, 'APPLIED', $7, $8)`,
        [
          operationId,
          input.accountId,
          input.type,
          numericFromMinorUnits(decided.amount.amountMinor),
          numericFromMinorUnits(decided.balanceAfter.amountMinor),
          input.transactionId,
          input.idempotencyKey,
          input.now,
        ],
      );

      await recordProcessedWith(client, {
        idempotencyKey: input.idempotencyKey,
        messageType: input.messageType,
        resultSummary: {
          outcome: 'APPLIED',
          operationId,
          amount: decided.amount,
          balanceAfter: decided.balanceAfter,
          reactivated: decided.reactivated,
          occurredAt: input.now.toISOString(),
        },
      });

      return {
        account: decided.account,
        reactivated: decided.reactivated,
        operation: {
          operationId,
          accountId: input.accountId,
          type: input.type,
          amount: decided.amount,
          balanceAfter: decided.balanceAfter,
          transactionId: input.transactionId,
          status: 'APPLIED',
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.now,
        },
      };
    });
  }

  public async setStatus(input: {
    readonly accountId: string;
    readonly status: 'ACTIVE' | 'INACTIVE';
    readonly idempotency: ProcessedMessage;
  }): Promise<Account | null> {
    return await this.#inTransaction(async (client) => {
      /**
       * `last_activity_at` is deliberately untouched. A status change is not
       * activity (A-4): if it were, an administrator reactivating an account
       * would reset its inactivity clock and the automatic process would never
       * again reach the accounts an administrator had touched.
       */
      const result = await client.query<AccountRow>(
        `UPDATE accounts
            SET status = $1, version = version + 1, updated_at = now()
          WHERE account_id = $2
        RETURNING ${ACCOUNT_COLUMNS}`,
        [input.status, input.accountId],
      );

      await recordProcessedWith(client, input.idempotency);

      return result.rows[0] === undefined ? null : accountFrom(result.rows[0]);
    });
  }

  public async deactivateInactive(input: {
    readonly now: Date;
    readonly criteria: DeactivationCriteria;
    readonly runId: string;
  }): Promise<readonly Account[]> {
    const threshold = inactivityThreshold(input.now, input.criteria.inactivityMonths);

    /**
     * Selection and mutation in one statement, so nothing can move between
     * deciding and acting. `status = 'ACTIVE'` in the predicate is what makes a
     * second run of the same day a no-op: it matches nothing.
     *
     * The comparisons are the four edge cases the ticket names, and they are
     * strict or inclusive exactly as `shouldDeactivate` is — `<` on the balance
     * so Q50.00 survives, `<=` on the date so six months exactly is reached.
     */
    const deactivated = await this.#pool.query<AccountRow>(
      `UPDATE accounts
          SET status = 'INACTIVE', version = version + 1, updated_at = $1
        WHERE account_id IN (
          SELECT account_id FROM accounts
           WHERE status = 'ACTIVE'
             AND balance < ($2::NUMERIC)
             AND last_activity_at <= $3
           ORDER BY account_id
             FOR UPDATE
        )
      RETURNING ${ACCOUNT_COLUMNS}`,
      [input.now, numericFromMinorUnits(input.criteria.minBalanceMinor), threshold],
    );

    await this.#pool.query(
      `INSERT INTO deactivation_runs
         (run_id, executed_at, threshold_at, min_balance_minor, deactivated_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (run_id) DO NOTHING`,
      [
        input.runId,
        input.now,
        threshold,
        input.criteria.minBalanceMinor,
        deactivated.rowCount ?? 0,
      ],
    );

    return deactivated.rows.map(accountFrom);
  }

  public async findProcessed(
    idempotencyKey: string,
    messageType: string,
  ): Promise<ProcessedMessage | null> {
    const result = await this.#pool.query<{
      idempotency_key: string;
      message_type: string;
      result_summary: Record<string, unknown>;
    }>(
      `SELECT idempotency_key, message_type, result_summary
         FROM processed_messages
        WHERE idempotency_key = $1 AND message_type = $2`,
      [idempotencyKey, messageType],
    );

    const row = result.rows[0];

    return row === undefined
      ? null
      : {
          idempotencyKey: row.idempotency_key,
          messageType: row.message_type,
          resultSummary: row.result_summary,
        };
  }

  public async recordProcessed(record: ProcessedMessage): Promise<void> {
    await recordProcessedWith(this.#pool, record);
  }

  public async isReachable(): Promise<boolean> {
    try {
      await this.#pool.query('SELECT 1');

      return true;
    } catch {
      return false;
    }
  }

  async #inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();

    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK');

      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * `ON CONFLICT DO NOTHING`, always.
 *
 * Two deliveries of one command race to insert this row; one wins and the other
 * must not blow up the transaction that is otherwise correct. The winner is
 * decided by the unique key, which is the only arbiter that works.
 */
async function recordProcessedWith(
  client: Pool | PoolClient,
  record: ProcessedMessage,
): Promise<void> {
  await client.query(
    `INSERT INTO processed_messages (message_id, idempotency_key, message_type, result_summary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (idempotency_key, message_type) DO NOTHING`,
    [randomUUID(), record.idempotencyKey, record.messageType, JSON.stringify(record.resultSummary)],
  );
}

/**
 * The money comes out as `TEXT`, never as a number.
 *
 * `pg` already returns `NUMERIC` as a string so the driver does not lose
 * precision, and the cast makes that explicit rather than depending on a driver
 * default. `minorUnitsFromNumeric` then splits it on the decimal point instead
 * of multiplying by a hundred — `Number('0.07') * 100` is 7.000000000000001,
 * and that is how a centavo goes missing between the column and the wire.
 */
const ACCOUNT_COLUMNS = `
  account_id,
  customer_id,
  account_type,
  balance::TEXT AS balance,
  status,
  last_activity_at,
  created_at,
  version
`;

const OPERATION_COLUMNS = `
  operation_id,
  account_id,
  type,
  amount::TEXT AS amount,
  balance_after::TEXT AS balance_after,
  transaction_id,
  status,
  idempotency_key,
  created_at
`;

interface AccountRow extends QueryResultRow {
  account_id: string;
  customer_id: string;
  account_type: 'MONETARIA' | 'AHORRO';
  balance: string;
  status: 'ACTIVE' | 'INACTIVE';
  last_activity_at: Date | null;
  created_at: Date;
  version: number;
}

interface OperationRow extends QueryResultRow {
  operation_id: string;
  account_id: string;
  type: 'DEBIT' | 'CREDIT' | 'COMPENSATION';
  amount: string;
  balance_after: string;
  transaction_id: string | null;
  status: 'APPLIED' | 'COMPENSATED';
  idempotency_key: string;
  created_at: Date;
}

function accountFrom(row: AccountRow): Account {
  return {
    accountId: row.account_id,
    customerId: row.customer_id,
    accountType: row.account_type,
    balanceMinor: minorUnitsFromNumeric(row.balance),
    status: row.status,
    lastActivityAt: row.last_activity_at,
    openedAt: row.created_at,
    version: row.version,
  };
}

function operationFrom(row: OperationRow): AccountOperation {
  return {
    operationId: row.operation_id,
    accountId: row.account_id,
    type: row.type,
    amount: quetzales(minorUnitsFromNumeric(row.amount)),
    balanceAfter: quetzales(minorUnitsFromNumeric(row.balance_after)),
    transactionId: row.transaction_id,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    occurredAt: row.created_at,
  };
}
