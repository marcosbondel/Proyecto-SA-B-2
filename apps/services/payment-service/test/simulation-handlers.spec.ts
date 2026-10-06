import type { MessageEnvelope } from '@bank/contracts';

import { SimulationUseCase } from '../src/application/manage-simulation.use-case';
import { InboundMessageRouter } from '../src/interfaces/inbound-message.handler';
import {
  SimulationQueryHandler,
  SimulationUpdateHandler,
} from '../src/interfaces/message-handlers';
import { FakeRepository, RecordingPublisher, clockFrom } from './support/in-memory';

/**
 * T-44, the doors: the two commands as they arrive from the broker, parsed
 * against their contracts before a use case sees them.
 */

const NOW = new Date('2026-10-05T12:00:00.000Z');
const CORRELATION = '33333333-3333-4333-8333-333333333333';
const ADMIN = { customerId: '77777777-7777-4777-8777-777777777701', role: 'ADMINISTRADOR' } as const;
const CLIENT = { customerId: '77777777-7777-4777-8777-777777777703', role: 'CLIENTE' } as const;

const envelope = (
  messageType: string,
  payload: unknown,
  identity: MessageEnvelope<unknown>['identity'] = ADMIN,
): MessageEnvelope<unknown> => ({
  messageId: '00000000-0000-4000-8000-000000000010',
  messageType,
  messageVersion: 1,
  producer: 'gateway',
  correlationId: CORRELATION,
  causationId: null,
  idempotencyKey: 'key-1',
  occurredAt: NOW.toISOString(),
  identity,
  payload,
});

function build() {
  const repository = new FakeRepository();
  const publisher = new RecordingPublisher();
  const useCase = new SimulationUseCase({
    repository,
    defaults: { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 0 },
    clock: clockFrom(NOW),
    telemetry: { providerCall: () => undefined, simulationChanged: () => undefined },
  });
  const router = new InboundMessageRouter([
    new SimulationUpdateHandler(useCase, publisher),
    new SimulationQueryHandler(useCase, publisher),
  ]);

  return { repository, publisher, router };
}

describe('payment.simulation.update.v1', () => {
  it('is claimed by this service and applies the change', async () => {
    const { router, repository, publisher } = build();

    const taken = await router.route(
      envelope('payment.simulation.update.v1', {
        failureRatePercent: 20,
        timeoutRatePercent: 5,
        latencyMs: 400,
      }),
    );

    expect(taken).toBe(true);
    expect(repository.simulation?.settings).toEqual({
      failureRatePercent: 20,
      timeoutRatePercent: 5,
      latencyMs: 400,
    });
    expect(publisher.replied[0]!.messageType).toBe('payment.simulation.replied.v1');
  });

  it('takes the identity from the envelope, so a customer changes nothing', async () => {
    const { router, repository } = build();

    await router.route(
      envelope(
        'payment.simulation.update.v1',
        { failureRatePercent: 100, timeoutRatePercent: 0, latencyMs: 0 },
        CLIENT,
      ),
    );

    expect(repository.simulation).toBeNull();
  });

  it('applies a reset', async () => {
    const { router, repository } = build();

    await router.route(
      envelope('payment.simulation.update.v1', { failureRatePercent: 50, timeoutRatePercent: 0, latencyMs: 0 }),
    );
    await router.route(envelope('payment.simulation.update.v1', { reset: true }));

    expect(repository.simulation).toBeNull();
  });

  it.each([
    ['rates over every attempt', { failureRatePercent: 70, timeoutRatePercent: 40, latencyMs: 0 }],
    ['a rate over 100', { failureRatePercent: 120, timeoutRatePercent: 0, latencyMs: 0 }],
    ['a partial set', { failureRatePercent: 10 }],
    ['a latency past the ceiling', { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 99_999 }],
  ])('throws on %s, which sends it down the retry ladder to the dead-letter queue', async (_label, payload) => {
    const { router, repository } = build();

    await expect(router.route(envelope('payment.simulation.update.v1', payload))).rejects.toThrow();
    expect(repository.simulation).toBeNull();
  });
});

describe('payment.simulation.query.v1', () => {
  it('is claimed by this service and answers with what is in force', async () => {
    const { router, publisher } = build();

    const taken = await router.route(envelope('payment.simulation.query.v1', {}));

    expect(taken).toBe(true);
    expect(publisher.replied[0]).toMatchObject({
      messageType: 'payment.simulation.replied.v1',
      payload: { failureRatePercent: 0, timeoutRatePercent: 0, latencyMs: 0, source: 'DEFAULTS', updatedAt: null },
    });
  });
});

it('leaves every other message for another handler', async () => {
  const { router } = build();

  expect(await router.route(envelope('payment.stats.query.v1', {}))).toBe(false);
});
