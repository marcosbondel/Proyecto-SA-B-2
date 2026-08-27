import 'reflect-metadata';

import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { HealthController } from '../src/interfaces/health.controller';
import type { DependencyHealthPort } from '../src/interfaces/health.controller';

const healthy: DependencyHealthPort = {
  isBrokerConnected: () => true,
  isDatabaseReachable: async () => true,
  isConsuming: () => true,
};

async function controllerWith(dependencies: DependencyHealthPort): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.withDependencies(dependencies)],
  }).compile();

  return moduleRef.get(HealthController);
}

describe('payment-service liveness', () => {
  /**
   * Liveness must not fail for anything a restart would not fix. For this
   * service the cost of getting it wrong is the highest in the bank: a crash
   * loop here means transfers stalled at `PAYMENT_PENDING` with the money
   * already debited and nothing on its way to settle or refund them.
   */
  it('reports the application as healthy even when its dependencies are not', async () => {
    const controller = await controllerWith({
      isBrokerConnected: () => false,
      isDatabaseReachable: async () => false,
      isConsuming: () => false,
    });

    expect(controller.check()).toEqual({ status: 'ok', application: 'payment-service' });
  });
});

describe('payment-service readiness', () => {
  it('is ready when it can reach its database and the broker, and is consuming', async () => {
    const controller = await controllerWith(healthy);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      application: 'payment-service',
      broker: 'connected',
      database: 'reachable',
      queues: 'consuming',
    });
  });

  /**
   * `503` and not a `200` with a "degraded" body. The orchestrator reads the
   * status code, so a soft answer would keep this replica being handed Saga
   * commands it cannot finish.
   */
  it.each([
    ['the broker is gone', { ...healthy, isBrokerConnected: () => false }],
    ['the database is gone', { ...healthy, isDatabaseReachable: async () => false }],
    /**
     * The window `main.ts` opens by listening before it subscribes: every
     * dependency answers and `payment.commands` is not attached yet, so the
     * replica can take no work.
     */
    ['the queue is not attached yet', { ...healthy, isConsuming: () => false }],
  ])('refuses traffic when %s', async (_label, dependencies) => {
    const controller = await controllerWith(dependencies);

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('says which dependency failed, so the reason is in the response', async () => {
    const controller = await controllerWith({ ...healthy, isDatabaseReachable: async () => false });

    await expect(controller.ready()).rejects.toMatchObject({
      response: {
        status: 'degraded',
        broker: 'connected',
        database: 'unreachable',
        queues: 'consuming',
      },
    });
  });
});
