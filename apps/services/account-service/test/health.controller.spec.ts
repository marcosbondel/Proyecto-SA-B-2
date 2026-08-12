import 'reflect-metadata';

import { Test } from '@nestjs/testing';

import { HealthController } from '../src/interfaces/health.controller';

describe('account-service HealthController', () => {
  it('reports the application as healthy', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    const controller = moduleRef.get(HealthController);

    expect(controller.check()).toEqual({ status: 'ok', application: 'account-service' });
  });
});
