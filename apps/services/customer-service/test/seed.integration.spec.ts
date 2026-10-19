import { Pool } from 'pg';

import type { PasswordHasher } from '../src/application/ports';
import { migrate } from '../src/infrastructure/persistence/migrations';
import { seedDemoUsers } from '../src/infrastructure/persistence/seed-demo-data';

/**
 * Arrancar una réplica no deshace lo que el sistema hizo después (T-60, QA 20),
 * contra PostgreSQL de verdad.
 *
 * La siembra de usuarios era un UPSERT que reponía contraseña, estado, KYC y
 * rol en cada arranque: un usuario de demostración que cambió su contraseña, fue
 * desactivado o vio rechazado su KYC volvía a como estaba al sembrarse la
 * próxima vez que arrancaba un pod.
 */

const URL = process.env.DATABASE_URL;
const suite = URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

const CLIENTE = 'a0000000-0000-4000-8000-000000000003';

suite('la siembra de usuarios de demostración', () => {
  let pool: Pool;
  let hashes = 0;
  const hasher: PasswordHasher = {
    hash: async (plaintext) => {
      hashes += 1;

      return `hash:${plaintext}`;
    },
    verify: async () => true,
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE customers CASCADE');
    hashes = 0;
  });
  afterAll(async () => {
    await pool.end();
  });

  const cliente = async () =>
    (
      await pool.query<{ password_hash: string; status: string; kyc_status: string; role: string }>(
        'SELECT password_hash, status, kyc_status, role FROM customers WHERE customer_id = $1',
        [CLIENTE],
      )
    ).rows[0]!;

  it('en una base vacía crea los cuatro usuarios', async () => {
    const created = await seedDemoUsers(pool, hasher, 'BankUsac#2026');

    expect(created).toHaveLength(4);
    expect((await cliente()).kyc_status).toBe('VERIFIED');
  });

  it('sembrar otra vez no repone contraseña, estado ni KYC, y ni siquiera calcula el hash', async () => {
    await seedDemoUsers(pool, hasher, 'BankUsac#2026');
    await pool.query(
      `UPDATE customers SET password_hash = 'la-que-eligio-el-usuario', kyc_status = 'REJECTED' WHERE customer_id = $1`,
      [CLIENTE],
    );
    hashes = 0;

    const created = await seedDemoUsers(pool, hasher, 'BankUsac#2026');

    expect(created).toEqual([]);
    expect(hashes).toBe(0);
    const fila = await cliente();
    expect(fila.password_hash).toBe('la-que-eligio-el-usuario');
    expect(fila.kyc_status).toBe('REJECTED');
  });

  it('varias réplicas a la vez dejan un solo juego de usuarios y ningún error', async () => {
    await Promise.all(
      Array.from({ length: 6 }, async () => await seedDemoUsers(pool, hasher, 'BankUsac#2026')),
    );

    expect((await pool.query('SELECT count(*)::int AS n FROM customers')).rows[0].n).toBe(4);
  });
});
