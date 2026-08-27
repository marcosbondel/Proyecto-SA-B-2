import 'reflect-metadata';

import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { DEPENDENCY_HEALTH, HealthController } from '../src/interfaces/health.controller';
import type { DependencyHealthPort } from '../src/interfaces/health.controller';

const controllerWith = async (dependencies: DependencyHealthPort): Promise<HealthController> => {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DEPENDENCY_HEALTH, useValue: dependencies }],
  }).compile();

  return moduleRef.get(HealthController);
};

const healthy: DependencyHealthPort = {
  isBrokerConnected: () => true,
  isDatabaseReachable: async () => true,
  isConsuming: () => true,
};

describe('notification-audit-service liveness', () => {
  /**
   * Liveness must not fail for anything a restart would not fix. For this
   * service the cost of a crash loop is unusually low upstream — the Saga keeps
   * running and the durable queues keep the backlog — which is exactly why it
   * must not be the thing that thrashes during an outage it cannot repair.
   */
  it('reports the application as healthy even when its dependencies are not', async () => {
    const controller = await controllerWith({
      isBrokerConnected: () => false,
      isDatabaseReachable: async () => false,
      isConsuming: () => false,
    });

    expect(controller.check()).toEqual({
      status: 'ok',
      application: 'notification-audit-service',
    });
  });
});

describe('notification-audit-service readiness', () => {
  it('is ready when it can reach both its database and the broker', async () => {
    const controller = await controllerWith(healthy);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      application: 'notification-audit-service',
      broker: 'connected',
      database: 'reachable',
      queues: 'consuming',
    });
  });

  /**
   * `503` and not a `200` with a "degraded" body. The orchestrator reads the
   * status code, so a soft answer would keep this replica being handed audit
   * queries it cannot answer.
   */
  it.each([
    ['the broker is gone', { ...healthy, isBrokerConnected: () => false }],
    ['the database is gone', { ...healthy, isDatabaseReachable: async () => false }],
    /**
     * The window `main.ts` opens by listening before it subscribes: every
     * dependency answers and the queues are not attached yet, so the replica can
     * take no work. Reporting "ready" here would be a lie introduced by the very
     * ordering that keeps liveness honest.
     */
    ['the queues are not attached yet', { ...healthy, isConsuming: () => false }],
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
