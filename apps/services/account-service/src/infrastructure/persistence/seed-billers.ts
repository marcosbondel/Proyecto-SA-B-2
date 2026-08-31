import type { Pool } from 'pg';

/**
 * The billers' collection accounts, created at boot and **not** behind
 * `SEED_DEMO_DATA`.
 *
 * These are product data, not demo data. A bank that offers "pago de
 * servicios" has an account per biller whether or not anybody is demonstrating
 * anything, and gating them on a development flag would mean `G-01` has an
 * empty dropdown in the one environment where it matters.
 *
 * Idempotent by fixed ids and an UPSERT that touches **only the catalogue
 * columns**: a restart refreshes the name and the code and never the balance,
 * because these accounts hold real money once anybody has paid a bill.
 *
 * The `customerId` is synthetic and shared by all three. It is a reference with
 * no foreign key (§8.2, 2.3) and it exists so the column can stay `NOT NULL`;
 * nobody signs in as it, and the account listing hides these rows.
 */
const BILLER_CUSTOMER_ID = 'c0000000-0000-4000-8000-0000000000ff';

interface Biller {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * The three the Claude Design prototype's `G-01` draws, and no more.
 *
 * A catalogue that a screen can add to needs an owner, a maintenance route and
 * a decision about who may create one; none of those is in scope, so the list
 * is fixed here and the interface reads it rather than inventing entries.
 */
export const BILLERS: readonly Biller[] = [
  { id: 'c0000000-0000-4000-8000-000000000001', code: 'EEGSA', name: 'EEGSA · Energía eléctrica' },
  { id: 'c0000000-0000-4000-8000-000000000002', code: 'EMPAGUA', name: 'Empagua · Agua potable' },
  { id: 'c0000000-0000-4000-8000-000000000003', code: 'CLARO', name: 'Claro · Telefonía' },
];

/** Creates or refreshes the three collection accounts. Returns their codes. */
export async function seedBillerAccounts(pool: Pool): Promise<readonly string[]> {
  for (const biller of BILLERS) {
    await pool.query(
      `INSERT INTO accounts
         (account_id, customer_id, account_type, balance, status, biller_code, biller_name)
       VALUES ($1, $2, 'MONETARIA', 0.00, 'ACTIVE', $3, $4)
       ON CONFLICT (account_id) DO UPDATE
         SET biller_code = EXCLUDED.biller_code,
             biller_name = EXCLUDED.biller_name,
             status = 'ACTIVE'`,
      [biller.id, BILLER_CUSTOMER_ID, biller.code, biller.name],
    );
  }

  return BILLERS.map((biller) => biller.code);
}
