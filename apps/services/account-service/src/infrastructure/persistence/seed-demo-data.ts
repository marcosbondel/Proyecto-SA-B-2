import type { Pool } from 'pg';

/**
 * Two accounts for the demo client, inserted at boot behind `SEED_DEMO_DATA`.
 *
 * This service holds only a `customerId` reference and never reads Customer
 * Service's table (constitution II, `test/isolation.spec.ts`), so it seeds
 * against the **shared demo constant** rather than looking anyone up. The id is
 * the same one `customer-service` seeds its `CLIENTE` with; keeping it a
 * documented constant in both is how two services agree on a demo without one
 * reaching into the other's database.
 *
 * Idempotent: fixed account ids and an UPSERT, so a restart refreshes the same
 * two accounts instead of opening more each time. One is funded so a transfer
 * is testable the moment the stack is up.
 */
const DEMO_CLIENT_ID = 'a0000000-0000-4000-8000-000000000003';

const MONETARIA_ID = 'b0000000-0000-4000-8000-000000000001';
const AHORRO_ID = 'b0000000-0000-4000-8000-000000000002';

/** In quetzales; the funded account gets Q5000 so a transfer works at once. */
const FUNDED_BALANCE = '5000.00';

interface SeedAccount {
  readonly id: string;
  readonly type: 'MONETARIA' | 'AHORRO';
  readonly balance: string;
}

const ACCOUNTS: readonly SeedAccount[] = [
  { id: MONETARIA_ID, type: 'MONETARIA', balance: FUNDED_BALANCE },
  { id: AHORRO_ID, type: 'AHORRO', balance: '0.00' },
];

/** Seeds the demo client's two accounts, returning their ids for the boot log. */
export async function seedDemoAccounts(pool: Pool): Promise<readonly string[]> {
  for (const account of ACCOUNTS) {
    await pool.query(
      `INSERT INTO accounts
         (account_id, customer_id, account_type, balance, status, last_activity_at, version)
       VALUES ($1, $2, $3, $4, 'ACTIVE', now(), 0)
       ON CONFLICT (account_id) DO UPDATE SET
         balance          = EXCLUDED.balance,
         status           = 'ACTIVE',
         last_activity_at = now()`,
      [account.id, DEMO_CLIENT_ID, account.type, account.balance],
    );
  }

  return ACCOUNTS.map((account) => account.id);
}
