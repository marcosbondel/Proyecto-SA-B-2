import 'reflect-metadata';

import { Test } from '@nestjs/testing';

import { DEPENDENCY_HEALTH, HealthController } from '../src/interfaces/health.controller';

/** Readiness reports on two dependencies; liveness reports on neither. */
async function controllerWith(broker: boolean, database: boolean): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      {
        provide: DEPENDENCY_HEALTH,
        useValue: {
          isBrokerConnected: () => broker,
          isDatabaseReachable: () => Promise.resolve(database),
        },
      },
    ],
  }).compile();

  return moduleRef.get(HealthController);
}

describe('account-service HealthController', () => {
  it('reports the application as healthy', async () => {
    const controller = await controllerWith(false, false);

    // Liveness deliberately ignores both dependencies: a database that is down
    // does not become up because this process was restarted.
    expect(controller.check()).toEqual({ status: 'ok', application: 'account-service' });
  });

  it('is ready when it can reach both the broker and its database', async () => {
    const controller = await controllerWith(true, true);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      application: 'account-service',
      broker: 'connected',
      database: 'reachable',
    });
  });

  it('refuses traffic with a 503 when the database is unreachable', async () => {
    const controller = await controllerWith(true, false);

    // A 200 with a "degraded" body would keep this replica in rotation:
    // orchestrators read the status code, not the payload.
    await expect(controller.ready()).rejects.toMatchObject({
      response: { status: 'degraded', database: 'unreachable' },
    });
  });

  it('refuses traffic when the broker is gone, because commands arrive by broker', async () => {
    const controller = await controllerWith(false, true);

    await expect(controller.ready()).rejects.toMatchObject({
      response: { status: 'degraded', broker: 'disconnected' },
    });
  });
});
