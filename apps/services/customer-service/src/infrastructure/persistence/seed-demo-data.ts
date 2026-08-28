import type { Pool } from 'pg';

import type { PasswordHasher } from '../../application/ports';

/**
 * Three ready-to-use accounts, one per role, inserted at boot for a demo.
 *
 * The project creates everything through the real flow on purpose, so there is
 * no seed in the domain. This is a **deliberately gated** exception: it runs
 * only when `SEED_DEMO_DATA` is on (development and the demo images, never a
 * default), and it is the standard way to bootstrap a first administrator —
 * which anonymous registration can no longer create, by design.
 *
 * Idempotent: fixed ids and an UPSERT, so a restart leaves the same three users
 * with the same known password rather than a second copy or a failed unique
 * constraint. The password is hashed with the service's own hasher, so a seeded
 * account is indistinguishable from a registered one at sign-in.
 *
 * The ids are shared, documented constants: `account-service` seeds the
 * client's accounts against `DEMO_CLIENT_ID` without ever reading this table.
 */
export const DEMO_ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';
export const DEMO_TELLER_ID = 'a0000000-0000-4000-8000-000000000002';
export const DEMO_CLIENT_ID = 'a0000000-0000-4000-8000-000000000003';

interface SeedUser {
  readonly id: string;
  readonly fullName: string;
  readonly document: string;
  readonly email: string;
  readonly username: string;
  readonly role: 'CLIENTE' | 'CAJERO_RECEPTOR' | 'ADMINISTRADOR';
}

const USERS: readonly SeedUser[] = [
  {
    id: DEMO_ADMIN_ID,
    fullName: 'Ana Administradora',
    document: 'SEED-ADMIN-0001',
    email: 'admin@bankusac.gt',
    username: 'admin',
    role: 'ADMINISTRADOR',
  },
  {
    id: DEMO_TELLER_ID,
    fullName: 'Carlos Cajero',
    document: 'SEED-CAJERO-0001',
    email: 'cajero@bankusac.gt',
    username: 'cajero',
    role: 'CAJERO_RECEPTOR',
  },
  {
    id: DEMO_CLIENT_ID,
    fullName: 'Clara Cliente',
    document: 'SEED-CLIENTE-001',
    email: 'cliente@bankusac.gt',
    username: 'cliente',
    role: 'CLIENTE',
  },
];

/**
 * Seeds the three demo users, returning their emails for the boot log.
 *
 * `identity_status = VALIDATED` and `status = ACTIVE` with a verified timestamp
 * (constraint C-4: ACTIVE iff verified), so each can sign in immediately.
 */
export async function seedDemoUsers(
  pool: Pool,
  hasher: PasswordHasher,
  password: string,
): Promise<readonly string[]> {
  for (const user of USERS) {
    const passwordHash = await hasher.hash(password);

    await pool.query(
      `INSERT INTO customers
         (customer_id, full_name, document_number, email, birth_date, address,
          username, identity_status, role, status, password_hash, email_verified_at)
       VALUES ($1, $2, $3, $4, '1990-01-01', 'Zona 1, Guatemala',
               $5, 'VALIDATED', $6, 'ACTIVE', $7, now())
       ON CONFLICT (customer_id) DO UPDATE SET
         password_hash     = EXCLUDED.password_hash,
         status            = 'ACTIVE',
         identity_status   = 'VALIDATED',
         email_verified_at = now(),
         role              = EXCLUDED.role,
         updated_at        = now()`,
      [user.id, user.fullName, user.document, user.email, user.username, user.role, passwordHash],
    );
  }

  return USERS.map((user) => user.email);
}
