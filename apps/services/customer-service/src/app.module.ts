import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { DEPENDENCY_HEALTH, HealthController } from './interfaces/health.controller';
import type { DependencyHealthPort } from './interfaces/health.controller';

/**
 * The HTTP surface of a service that has almost none: two probes.
 *
 * It is a dynamic module because the things readiness reports on — the broker
 * connection and the database pool — are created in `main.ts`, which is the one
 * place allowed to see adapters. Letting Nest construct them would put the
 * choice of PostgreSQL inside a module that has no business knowing it.
 */
@Module({ controllers: [HealthController] })
export class AppModule {
  public static withDependencies(health: DependencyHealthPort): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: DEPENDENCY_HEALTH, useValue: health }],
    };
  }
}
