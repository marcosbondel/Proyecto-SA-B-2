import { paymentSimulationRepliedV1 } from '@bank/contracts';
import type { Identity, PaymentSimulationUpdateV1 } from '@bank/contracts';

import { isValidSettings } from '../domain/simulation';
import type { SimulationSettings } from '../domain/simulation';
import type {
  Clock,
  EventPublisher,
  PaymentRepository,
  ProviderTelemetry,
  SimulationInForce,
  SimulationSource,
} from './ports';

/**
 * The provider's simulation, readable and changeable while the system runs
 * (Fase 3, §4.1 — Payment Service, T-44).
 *
 * Two roles in one class, because they share one fact. The attempt path asks
 * `current()` before every attempt; the administrator's commands go through
 * `query()` and `update()`. Both read the same place — the override row in this
 * service's database, or the ConfigMap's defaults when there is none — so what
 * an administrator is told is what the next attempt will do.
 *
 * **Only an administrator may change it, and the Gateway is not the only
 * lock.** The Gateway already refuses a caller without the role, but this
 * service is reachable by the broker and trusts no one: a command whose
 * identity is not `ADMINISTRADOR` changes nothing and is answered with the
 * unchanged simulation. There is no refusal message because the contract has no
 * shape for one, and inventing a reply the Gateway cannot parse would turn a
 * denied caller into a 500.
 */
export class SimulationUseCase implements SimulationSource {
  readonly #repository: PaymentRepository;
  readonly #defaults: SimulationSettings;
  readonly #clock: Clock;
  readonly #telemetry: ProviderTelemetry;

  constructor(dependencies: {
    readonly repository: PaymentRepository;
    /** What the ConfigMap supplied; applies while nobody has overridden it. */
    readonly defaults: SimulationSettings;
    readonly clock: Clock;
    readonly telemetry: ProviderTelemetry;
  }) {
    if (!isValidSettings(dependencies.defaults)) {
      throw new Error('The default simulation settings are not valid.');
    }

    this.#repository = dependencies.repository;
    this.#defaults = dependencies.defaults;
    this.#clock = dependencies.clock;
    this.#telemetry = dependencies.telemetry;
  }

  /** What the next attempt will do: the override if there is one, else the defaults. */
  public async current(): Promise<SimulationInForce> {
    const stored = await this.#repository.loadSimulation();

    return stored === null
      ? { settings: this.#defaults, source: 'DEFAULTS', updatedAt: null }
      : { settings: stored.settings, source: 'RUNTIME', updatedAt: stored.updatedAt };
  }

  /** `payment.simulation.query.v1`. */
  public async query(publisher: EventPublisher): Promise<void> {
    await this.#reply(publisher, await this.current());
  }

  /** `payment.simulation.update.v1`. */
  public async update(input: {
    readonly command: PaymentSimulationUpdateV1;
    readonly identity: Identity | null;
    readonly correlationId: string | null;
    readonly publisher: EventPublisher;
  }): Promise<void> {
    const { command, identity, correlationId, publisher } = input;

    if (identity === null || identity.role !== 'ADMINISTRADOR') {
      const unchanged = await this.current();

      this.#telemetry.simulationChanged({
        action: 'DENIED',
        settings: unchanged.settings,
        correlationId,
      });
      await this.#reply(publisher, unchanged);

      return;
    }

    if ('reset' in command) {
      await this.#repository.clearSimulation();
      this.#telemetry.simulationChanged({
        action: 'RESET',
        settings: this.#defaults,
        correlationId,
      });
    } else {
      const settings: SimulationSettings = {
        failureRatePercent: command.failureRatePercent,
        timeoutRatePercent: command.timeoutRatePercent,
        latencyMs: command.latencyMs,
      };

      // The contract refused these at the Gateway; a command that reaches here
      // with numbers it would refuse came from somewhere else. Throwing sends
      // it down the retry ladder to the dead-letter queue, where it belongs.
      if (!isValidSettings(settings)) {
        throw new Error('payment.simulation.update.v1 carried settings the provider cannot honour.');
      }

      await this.#repository.saveSimulation(settings, this.#clock.now());
      this.#telemetry.simulationChanged({ action: 'UPDATE', settings, correlationId });
    }

    await this.#reply(publisher, await this.current());
  }

  async #reply(publisher: EventPublisher, inForce: SimulationInForce): Promise<void> {
    await publisher.reply({
      messageType: paymentSimulationRepliedV1.name,
      payload: {
        ...inForce.settings,
        source: inForce.source,
        updatedAt: inForce.updatedAt === null ? null : inForce.updatedAt.toISOString(),
      },
    });
  }
}
