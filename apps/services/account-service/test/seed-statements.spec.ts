import type { Pool } from 'pg';

import { seedBillerAccounts } from '../src/infrastructure/persistence/seed-billers';
import { seedDemoAccounts } from '../src/infrastructure/persistence/seed-demo-data';
import { seedSettlementAccount } from '../src/infrastructure/persistence/seed-settlement';

/**
 * Lo que las siembras escriben, sin base de datos (T-60, QA 20).
 *
 * Una guarda barata y deliberada: ninguna siembra puede volver a poner el saldo
 * de una cuenta que ya existe. La prueba que lo demuestra de verdad, contra
 * PostgreSQL, es `seed.integration.spec.ts`; ésta falla en el segundo en que
 * alguien reescribe la sentencia, aunque no haya base a mano.
 */

interface Recorded {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function fakePool(rowCount = 1): { pool: Pool; statements: Recorded[] } {
  const statements: Recorded[] = [];
  const pool = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      statements.push({ sql, params });

      return { rowCount, rows: [] };
    },
  } as unknown as Pool;

  return { pool, statements };
}

/** El `SET` de la cláusula `ON CONFLICT`, que es lo único que toca una cuenta existente. */
const onConflict = (sql: string): string => sql.slice(sql.indexOf('ON CONFLICT'));

describe('las siembras de cuentas no tocan el saldo de lo que ya existe', () => {
  it('la demo sólo crea: ON CONFLICT DO NOTHING', async () => {
    const { pool, statements } = fakePool();

    await seedDemoAccounts(pool);

    expect(statements).toHaveLength(4);
    for (const { sql } of statements) {
      expect(onConflict(sql).replace(/\s+/g, ' ')).toBe('ON CONFLICT (account_id) DO NOTHING');
    }
  });

  it('la demo informa sólo de las cuentas que creó', async () => {
    expect(await seedDemoAccounts(fakePool(1).pool)).toHaveLength(4);
    expect(await seedDemoAccounts(fakePool(0).pool)).toEqual([]);
  });

  it('los billers no mencionan el saldo en su ON CONFLICT y no escriben si nada cambió', async () => {
    const { pool, statements } = fakePool();

    await seedBillerAccounts(pool);

    for (const { sql } of statements) {
      expect(onConflict(sql)).not.toMatch(/balance/i);
      expect(onConflict(sql)).toMatch(/IS DISTINCT FROM/);
    }
  });

  it('la liquidación no menciona el saldo en su ON CONFLICT y sólo actúa si está inactiva', async () => {
    const { pool, statements } = fakePool();

    await seedSettlementAccount(pool);

    const conflicto = onConflict(statements[0]!.sql);
    expect(conflicto).not.toMatch(/balance/i);
    expect(conflicto).toMatch(/WHERE accounts\.status <> 'ACTIVE'/);
  });

  it('ninguna siembra repone saldo, versión ni actividad', async () => {
    const { pool, statements } = fakePool();

    await seedDemoAccounts(pool);
    await seedBillerAccounts(pool);
    await seedSettlementAccount(pool);

    for (const { sql } of statements) {
      expect(onConflict(sql)).not.toMatch(/balance\s*=|version\s*=|last_activity_at\s*=/i);
    }
  });

  it('las cuatro de la demo llevan sus saldos de demostración sólo en el INSERT', async () => {
    const { pool, statements } = fakePool();

    await seedDemoAccounts(pool);

    expect(statements.map((s) => s.params[3])).toEqual(['5000.00', '1500.00', '2500.00', '800.00']);
  });
});
