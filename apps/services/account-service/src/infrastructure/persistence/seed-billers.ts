import type { Pool, PoolClient } from 'pg';

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

/**
 * Key of the transaction-level advisory lock that serialises this seed across
 * replicas. Any fixed bigint works; this one only has to be unique to the
 * seed.
 */
const BILLER_SEED_LOCK = 7_206_001;

/**
 * Creates or refreshes the three collection accounts. Returns their codes.
 *
 * Serialised with an advisory lock because `ON CONFLICT (account_id)` only
 * arbitrates the primary key. Two replicas booting at the same instant (an HPA
 * scale-up) both attempt the INSERT; the second one then collides with the
 * OTHER unique index, `accounts_biller_code_once`, and Postgres raises instead
 * of taking the `DO UPDATE` branch — the pod's boot fails. CI caught it with
 * six concurrent seeds (T-60).
 */
export async function seedBillerAccounts(pool: Pool): Promise<readonly string[]> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BILLER_SEED_LOCK]);
    await upsertBillers(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return BILLERS.map((biller) => biller.code);
}

async function upsertBillers(client: PoolClient): Promise<void> {
  for (const biller of BILLERS) {
    await client.query(
      `INSERT INTO accounts
         (account_id, customer_id, account_type, balance, status, biller_code, biller_name)
       VALUES ($1, $2, 'MONETARIA', 0.00, 'ACTIVE', $3, $4)
       ON CONFLICT (account_id) DO UPDATE
         SET biller_code = EXCLUDED.biller_code,
             biller_name = EXCLUDED.biller_name,
             status = 'ACTIVE'
       -- Sólo si algo del catálogo cambió: arrancar una réplica no escribe filas
       -- que no necesitan cambio, y nunca toca el saldo (T-60, QA 20).
       WHERE (accounts.biller_code, accounts.biller_name, accounts.status)
             IS DISTINCT FROM (EXCLUDED.biller_code, EXCLUDED.biller_name, 'ACTIVE')`,
      [biller.id, BILLER_CUSTOMER_ID, biller.code, biller.name],
    );
  }
}
