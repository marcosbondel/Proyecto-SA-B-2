import type { Pool } from 'pg';

/**
 * Whether this service's own database answers — nothing else.
 *
 * It exists so `/ready` can tell the truth before there is a repository to ask.
 * When the payment use cases arrive they bring their own repository and this
 * probe either moves onto it or stays as it is; either way the question it
 * answers is the same one, and the connection string it answers it over is this
 * service's own (constitution II).
 *
 * `SELECT 1` is deliberately the cheapest statement there is. A readiness probe
 * runs every few seconds for the life of the pod, so anything that touched a
 * real table would be a query the operator never asked for, repeated forever.
 */
export class DatabaseProbe {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /** `false` rather than a throw: an unreachable database is an answer. */
  public async isReachable(): Promise<boolean> {
    try {
      await this.#pool.query('SELECT 1');

      return true;
    } catch {
      return false;
    }
  }
}
