import { Pool } from 'pg';

import { migrate } from '../src/infrastructure/persistence/migrations';
import { seedBillerAccounts } from '../src/infrastructure/persistence/seed-billers';
import { seedDemoAccounts } from '../src/infrastructure/persistence/seed-demo-data';
import { seedSettlementAccount } from '../src/infrastructure/persistence/seed-settlement';

/**
 * Arrancar un pod no mueve dinero (T-60, QA 20), contra PostgreSQL de verdad.
 *
 * El defecto, visto con carga en el clúster: el HPA arrancó un pod de
 * account-service y el saldo de una cuenta de demostración pasó de 1800.00 a
 * 2499.00 **sin una fila en `account_operations`**. La siembra era un UPSERT que
 * reponía `balance` con el valor de la semilla en cada arranque.
 */

const URL = process.env.DATABASE_URL;
const suite = URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

const MONETARIA = 'b0000000-0000-4000-8000-000000000001';
const AHORRO = 'b0000000-0000-4000-8000-000000000002';
const LIQUIDACION = 'c0000000-0000-4000-8000-00000000000a';

suite('la siembra de cuentas', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE account_anomalies, account_operations, accounts, processed_messages, deactivation_runs',
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  const row = async (id: string) =>
    (
      await pool.query<{
        balance: string;
        status: string;
        version: number;
        last_activity_at: Date;
      }>('SELECT balance::text AS balance, status, version, last_activity_at FROM accounts WHERE account_id=$1', [id])
    ).rows[0]!;

  it('crea las cuatro cuentas en una base vacía y después NO repone nada de lo que el sistema cambió', async () => {
    const created = await seedDemoAccounts(pool);

    expect(created).toHaveLength(4);
    expect((await row(MONETARIA)).balance).toBe('5000.00');
    expect((await row(AHORRO)).balance).toBe('1500.00');

    // El sistema mueve dinero de verdad, con su fila en el libro.
    await pool.query(
      `UPDATE accounts SET balance = 1800.00, version = 7, status = 'INACTIVE',
              last_activity_at = '2026-01-01T00:00:00Z' WHERE account_id = $1`,
      [MONETARIA],
    );
    const before = await row(MONETARIA);

    expect(await seedDemoAccounts(pool)).toEqual([]);

    const after = await row(MONETARIA);
    expect(after.balance).toBe('1800.00');
    expect(after.status).toBe('INACTIVE');
    expect(after.version).toBe(7);
    expect(after.last_activity_at).toEqual(before.last_activity_at);

    // Y crea sólo la que falta, dejando intactas las demás.
    await pool.query('UPDATE accounts SET balance = 42.00 WHERE account_id = $1', [AHORRO]);
    await pool.query('DELETE FROM accounts WHERE account_id = $1', [MONETARIA]);

    expect(await seedDemoAccounts(pool)).toEqual([MONETARIA]);
    expect((await row(AHORRO)).balance).toBe('42.00');
    expect((await row(MONETARIA)).balance).toBe('5000.00');
  });

  it('varias réplicas arrancando a la vez dejan un solo juego de filas y ningún error', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, async () => await seedDemoAccounts(pool)));

    expect((await pool.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n).toBe(4);
    // Cada fila la creó exactamente una réplica.
    expect(results.flat().sort()).toEqual(
      [
        'b0000000-0000-4000-8000-000000000001',
        'b0000000-0000-4000-8000-000000000002',
        'b0000000-0000-4000-8000-000000000003',
        'b0000000-0000-4000-8000-000000000004',
      ].sort(),
    );
    expect((await row(MONETARIA)).balance).toBe('5000.00');
  });

  it('una réplica que arranca en medio de una carga no deshace lo que otra movió', async () => {
    await seedDemoAccounts(pool);
    const arranques = Array.from({ length: 5 }, async () => await seedDemoAccounts(pool));
    const movimientos = (async () => {
      for (let i = 0; i < 20; i += 1) {
        await pool.query(
          'UPDATE accounts SET balance = balance - 1.00, version = version + 1 WHERE account_id = $1',
          [MONETARIA],
        );
      }
    })();

    await Promise.all([...arranques, movimientos]);

    // 5000.00 − 20 × 1.00, sin un solo reinicio al valor de la semilla.
    expect((await row(MONETARIA)).balance).toBe('4980.00');
  });

  describe('las cuentas del sistema', () => {
    it('los billers y la liquidación no pierden su saldo al arrancar otra réplica', async () => {
      await seedBillerAccounts(pool);
      await seedSettlementAccount(pool);
      await pool.query("UPDATE accounts SET balance = 150.00 WHERE account_id = $1", [LIQUIDACION]);
      await pool.query("UPDATE accounts SET balance = 99.00 WHERE biller_code = 'EEGSA'");

      await seedBillerAccounts(pool);
      await seedSettlementAccount(pool);

      expect((await row(LIQUIDACION)).balance).toBe('150.00');
      expect(
        (await pool.query<{ balance: string }>("SELECT balance::text AS balance FROM accounts WHERE biller_code='EEGSA'")).rows[0]!.balance,
      ).toBe('99.00');

      // Una cuenta del sistema desactivada se reactiva, sin tocar el saldo.
      await pool.query("UPDATE accounts SET status='INACTIVE', balance = 10.00 WHERE account_id = $1", [LIQUIDACION]);
      await seedSettlementAccount(pool);

      const fila = await row(LIQUIDACION);
      expect(fila.status).toBe('ACTIVE');
      expect(fila.balance).toBe('10.00');
    });

    it('arrancar varias réplicas a la vez deja una sola cuenta de cada', async () => {
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          await seedBillerAccounts(pool);
          await seedSettlementAccount(pool);
        }),
      );

      expect((await pool.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n).toBe(4);
    });
  });
});
