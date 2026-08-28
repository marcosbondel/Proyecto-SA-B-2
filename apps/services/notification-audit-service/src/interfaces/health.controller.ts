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
 * The two probes, and the only HTTP this service has. Everything else it does
 * travels over the broker (constitution IV).
 *
 * They answer different questions. **Liveness** asks whether the process is
 * alive, so it must not fail for anything a restart would not fix: a database
 * that is down does not become up because this process died. **Readiness** asks
 * whether it can do its job.
 *
 * Reporting degraded here is *less* urgent than for any other service in the
 * bank, and saying so is the point. A Saga participant that cannot reach its
 * database leaves transfers stalled with money already debited; this one leaves
 * messages in durable queues that will still be there when it comes back. That
 * is criterion 4 — "con el servicio caído, la Saga continúa" — and it is a
 * property of the topology, not of this probe. The probe exists so an
 * orchestrator stops routing queries to a replica that cannot answer them, not
 * because anything upstream is waiting.
 */
@Controller()
export class HealthController {
  readonly #dependencies: DependencyHealthPort;

  constructor(@Inject(DEPENDENCY_HEALTH) dependencies: DependencyHealthPort) {
    this.#dependencies = dependencies;
  }

  @Get('health')
  public check(): HealthStatus {
    return { status: 'ok', application: 'notification-audit-service' };
  }

  /**
   * `200` when both dependencies answer and the queues are attached,
   * `503` otherwise.
   *
   * A "degraded" body with a `200` would be worse than useless: the
   * orchestrator reads the status code, so the replica would keep being handed
   * questions it cannot answer.
   */
  @Get('ready')
  @HttpCode(200)
  public async ready(): Promise<ReadinessStatus> {
    const broker = this.#dependencies.isBrokerConnected();
    const database = await this.#dependencies.isDatabaseReachable();
    const consuming = this.#dependencies.isConsuming();

    const status: ReadinessStatus = {
      status: broker && database && consuming ? 'ready' : 'degraded',
      application: 'notification-audit-service',
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
