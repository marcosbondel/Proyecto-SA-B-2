import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';

import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from './guards/route-access.decorator';

export interface HealthStatus {
  readonly status: 'ok';
  readonly application: string;
}

export interface ReadinessStatus {
  readonly status: 'ready' | 'degraded';
  readonly application: string;
  readonly broker: 'connected' | 'disconnected';
}

/**
 * Whether the process can reach the broker at all.
 *
 * A port rather than the broker itself: readiness is an interface concern and
 * `pnpm lint` will not let this layer see an adapter.
 */
export interface BrokerHealthPort {
  isConnected(): boolean;
}

export const BROKER_HEALTH = Symbol('BrokerHealthPort');

/**
 * The two endpoints Docker and Kubernetes ask about, and the only ones a
 * caller may reach without a token.
 *
 * They answer different questions on purpose. **Liveness** asks whether the
 * process is alive — a restart is the only cure, so it must not fail for
 * anything a restart would not fix. **Readiness** asks whether it can do its
 * job, and the gateway cannot do its job without a broker: taking a request it
 * can only answer with `503` is worse than being taken out of rotation.
 */
@ApiTags('health')
@Controller()
export class HealthController {
  readonly #broker: BrokerHealthPort;

  constructor(@Inject(BROKER_HEALTH) broker: BrokerHealthPort) {
    this.#broker = broker;
  }

  @ApiOperation({ summary: 'Liveness: responde mientras el proceso viva' })
  @Public()
  @Get('health')
  public check(): HealthStatus {
    return { status: 'ok', application: 'gateway' };
  }

  /**
   * Answers `200` when the broker is reachable and `503` when it is not.
   *
   * Reporting `200` with a "degraded" body would be worse than useless: an
   * orchestrator reads the status code, so the instance would keep receiving
   * traffic it cannot serve.
   */
  @ApiOperation({ summary: 'Readiness: 503 mientras el broker sea inalcanzable' })
  @Public()
  @Get('ready')
  @HttpCode(200)
  public ready(): ReadinessStatus {
    const connected = this.#broker.isConnected();

    if (!connected) {
      const degraded: ReadinessStatus = {
        status: 'degraded',
        application: 'gateway',
        broker: 'disconnected',
      };

      throw new ServiceUnavailableException(degraded);
    }

    return { status: 'ready', application: 'gateway', broker: 'connected' };
  }
}
