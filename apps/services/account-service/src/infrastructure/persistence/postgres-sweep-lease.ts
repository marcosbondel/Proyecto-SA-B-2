import type { Pool, PoolClient } from 'pg';

import type { SweepLease } from '../scheduler/deactivation.scheduler';

/**
 * El arriendo del barrido, resuelto por la base que este servicio ya tiene.
 *
 * `pg_try_advisory_lock` es un cerrojo de sesion: lo toma **una** conexion y no
 * lo suelta hasta que la conexion lo devuelve o se cierra. Eso da exactamente
 * la propiedad que hace falta para escalar `account-service` — que solo una
 * replica ejecute el barrido de cuentas inactivas — sin introducir etcd, un
 * `Lease` de Kubernetes ni una tabla nueva, y sin que un pod que muere a media
 * ejecucion deje el cerrojo tomado para siempre: PostgreSQL lo libera cuando la
 * conexion cae.
 *
 * `try` y no `pg_advisory_lock` a secas: la variante que espera dejaria a las
 * otras replicas bloqueadas hasta que la primera terminase, y entonces
 * barrerian uno detras de otro. Aqui quien no lo consigue se salta su turno.
 */

/**
 * La clave del cerrojo. Solo tiene que ser el mismo numero en las N replicas y
 * no chocar con otro cerrojo consultivo de esta base — hoy es el unico.
 */
export const SWEEP_LOCK_KEY = 20_260_925;

export class PostgresSweepLease implements SweepLease {
  readonly #pool: Pool;
  readonly #key: number;

  /**
   * La conexion que sostiene el cerrojo mientras dura el barrido. Es el estado
   * que obliga a que `release()` use la MISMA conexion que `acquire()`: un
   * `pg_advisory_unlock` desde otra no suelta nada y devuelve `false`.
   */
  #client: PoolClient | null = null;

  constructor(pool: Pool, key: number = SWEEP_LOCK_KEY) {
    this.#pool = pool;
    this.#key = key;
  }

  public async acquire(): Promise<boolean> {
    if (this.#client !== null) {
      // Ya lo tenemos: el planificador no debe pedirlo dos veces, y si lo hace
      // es mejor decir que no que quedarse con dos conexiones tomadas.
      return false;
    }

    const client = await this.#pool.connect();

    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [this.#key],
      );

      if (result.rows[0]?.locked !== true) {
        client.release();

        return false;
      }

      this.#client = client;

      return true;
    } catch (error) {
      client.release();

      throw error;
    }
  }

  public async release(): Promise<void> {
    const client = this.#client;

    if (client === null) {
      return;
    }

    this.#client = null;

    try {
      await client.query('SELECT pg_advisory_unlock($1)', [this.#key]);
    } finally {
      // Devolver la conexion al pool es lo que no puede saltarse: sin esto, un
      // fallo al soltar el cerrojo filtraria una conexion por barrido.
      client.release();
    }
  }
}
