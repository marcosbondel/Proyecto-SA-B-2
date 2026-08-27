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
};

describe('transaction-service liveness', () => {
  /**
   * Liveness must not fail for anything a restart would not fix. A database
   * that is down does not become up because this process died — and for a Saga
   * participant, a crash loop means transfers that stop advancing after the
   * money has already been debited.
   */
  it('reports the application as healthy even when its dependencies are not', async () => {
    const controller = await controllerWith({
      isBrokerConnected: () => false,
      isDatabaseReachable: async () => false,
    });

    expect(controller.check()).toEqual({ status: 'ok', application: 'transaction-service' });
  });
});

describe('transaction-service readiness', () => {
  it('is ready when it can reach both its database and the broker', async () => {
    const controller = await controllerWith(healthy);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      application: 'transaction-service',
      broker: 'connected',
      database: 'reachable',
    });
  });

  /**
   * `503` and not a `200` with a "degraded" body. The orchestrator reads the
   * status code, so a soft answer would keep this replica consuming Saga events
   * it cannot record.
   */
  it.each([
    ['the broker is gone', { ...healthy, isBrokerConnected: () => false }],
    ['the database is gone', { ...healthy, isDatabaseReachable: async () => false }],
  ])('refuses traffic when %s', async (_label, dependencies) => {
    const controller = await controllerWith(dependencies);

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('says which dependency failed, so the reason is in the response', async () => {
    const controller = await controllerWith({ ...healthy, isDatabaseReachable: async () => false });

    await expect(controller.ready()).rejects.toMatchObject({
      response: { status: 'degraded', broker: 'connected', database: 'unreachable' },
    });
  });
});
