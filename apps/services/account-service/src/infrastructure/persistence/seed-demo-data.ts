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
 * **Creates what is missing and nothing else** (T-60, QA 20). Fixed account ids
 * and `ON CONFLICT DO NOTHING`: an account that already exists is never
 * touched. It used to be an UPSERT that reset `balance` (and `status`,
 * `last_activity_at`) to the seed values on every start, so any pod the HPA
 * started during a load run moved a customer's money back to the seed with no
 * `account_operations` row — 1800.00 became 2499.00 with no ledger entry. The
 * balance is the one field in this system that may only change through a
 * movement, and a boot-time script is not a movement.
 *
 * Safe under concurrent starts: each row is one atomic `INSERT … ON CONFLICT DO
 * NOTHING`, so several replicas booting together produce one set of rows, and
 * whichever finishes second finds them and writes nothing. One account is
 * funded so a transfer is testable the moment the stack is up.
 */
export const DEMO_CLIENT_ID = 'a0000000-0000-4000-8000-000000000003';
export const DEMO_CLIENT_2_ID = 'a0000000-0000-4000-8000-000000000005';

const MONETARIA_ID = 'b0000000-0000-4000-8000-000000000001';
const AHORRO_ID = 'b0000000-0000-4000-8000-000000000002';
const MARCO_MONETARIA_ID = 'b0000000-0000-4000-8000-000000000003';
const MARCO_AHORRO_ID = 'b0000000-0000-4000-8000-000000000004';

interface SeedAccount {
  readonly id: string;
  readonly customerId: string;
  readonly type: 'MONETARIA' | 'AHORRO';
  readonly balance: string;
}

const ACCOUNTS: readonly SeedAccount[] = [
  // Cuentas de Marco Tulio López Medina (Cliente Principal - Q5,000 / Q1,500)
  { id: MONETARIA_ID, customerId: DEMO_CLIENT_ID, type: 'MONETARIA', balance: '5000.00' },
  { id: AHORRO_ID, customerId: DEMO_CLIENT_ID, type: 'AHORRO', balance: '1500.00' },
  // Cuentas de Clara Cliente (Cliente Tercero - Q2,500 / Q800)
  { id: MARCO_MONETARIA_ID, customerId: DEMO_CLIENT_2_ID, type: 'MONETARIA', balance: '2500.00' },
  { id: MARCO_AHORRO_ID, customerId: DEMO_CLIENT_2_ID, type: 'AHORRO', balance: '800.00' },
];

/**
 * Seeds the demo clients' accounts, returning the ids it actually **created**
 * (an account that was already there is not listed, and was not touched).
 */
export async function seedDemoAccounts(pool: Pool): Promise<readonly string[]> {
  const created: string[] = [];

  for (const account of ACCOUNTS) {
    const result = await pool.query(
      `INSERT INTO accounts
         (account_id, customer_id, account_type, balance, status, last_activity_at, version)
       VALUES ($1, $2, $3, $4, 'ACTIVE', now(), 0)
       ON CONFLICT (account_id) DO NOTHING`,
      [account.id, account.customerId, account.type, account.balance],
    );

    if (result.rowCount === 1) created.push(account.id);
  }

  return created;
}

