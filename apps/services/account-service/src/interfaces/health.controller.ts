import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';

export interface HealthStatus {
  readonly status: 'ok';
  readonly application: string;
}

export interface ReadinessStatus {
  readonly status: 'ready' | 'degraded';
  readonly application: string;
  readonly broker: 'connected' | 'disconnected';
  readonly database: 'reachable' | 'unreachable';
  readonly queues: 'consuming' | 'starting';
}

/**
 * What readiness needs to know, as ports rather than adapters.
 *
 * `pnpm lint` will not let this layer import infrastructure, and the rule is
 * right: a controller that held a `Pool` would be a controller that could run a
 * query.
 */
export interface DependencyHealthPort {
  isBrokerConnected(): boolean;
  isDatabaseReachable(): Promise<boolean>;

  /**
   * Whether this replica has attached to the queues it owns.
   *
   * Separate from the broker connection on purpose. The connection comes up
   * first, and in the window between the two a replica can reach everything it
   * needs and still be consuming nothing. `main.ts` opens the port before it
   * attaches — so that liveness answers while a dependency is down — which
   * makes the window real rather than theoretical.
   */
  isConsuming(): boolean;
}

export const DEPENDENCY_HEALTH = Symbol('DependencyHealthPort');

/**
 * The two endpoints an orchestrator asks about — and the only HTTP this service
 * has. Everything else it does travels over the broker (constitution IV).
 *
 * They answer different questions. **Liveness** asks whether the process is
 * alive, so it must not fail for anything a restart would not fix: a database
 * that is down does not become up because this process died. **Readiness** asks
 * whether it can do its job, and this service cannot do its job without both
 * its database and the broker — a replica that consumes commands it cannot
 * persist would acknowledge work it did not do.
 */
@Controller()
export class HealthController {
  readonly #dependencies: DependencyHealthPort;

  constructor(@Inject(DEPENDENCY_HEALTH) dependencies: DependencyHealthPort) {
    this.#dependencies = dependencies;
  }

  @Get('health')
  public check(): HealthStatus {
    return { status: 'ok', application: 'account-service' };
  }

  /**
   * `200` when both dependencies answer and the queues are attached,
   * `503` otherwise.
   *
   * A "degraded" body with a `200` would be worse than useless: the
   * orchestrator reads the status code, so the replica would keep being handed
   * work it cannot complete.
   */
  @Get('ready')
  @HttpCode(200)
  public async ready(): Promise<ReadinessStatus> {
    const broker = this.#dependencies.isBrokerConnected();
    const database = await this.#dependencies.isDatabaseReachable();
    const consuming = this.#dependencies.isConsuming();

    const status: ReadinessStatus = {
      status: broker && database && consuming ? 'ready' : 'degraded',
      application: 'account-service',
      broker: broker ? 'connected' : 'disconnected',
      database: database ? 'reachable' : 'unreachable',
      queues: consuming ? 'consuming' : 'starting',
    };

    if (status.status === 'degraded') {
      throw new ServiceUnavailableException(status);
    }

    return status;
  }
}
