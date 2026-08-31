import { Controller, Get, Inject, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DashboardUseCase } from '../application/routes/dashboard.use-case';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';

/**
 * `D-01` and `D-02` — one route, five services, no arithmetic.
 *
 * There is no `@Roles` here, and that is the design rather than an omission.
 * Each owning service decides what its own counts are worth showing this actor
 * and answers a client with zeroes; a role decorator would be a sixth opinion
 * about a question five services already answer, and the one most likely to
 * drift from them.
 */
@ApiTags('dashboard')
@ApiBearerAuth('session')
@Controller('api/dashboard')
export class DashboardController {
  readonly #dashboard: DashboardUseCase;

  constructor(@Inject(DashboardUseCase) dashboard: DashboardUseCase) {
    this.#dashboard = dashboard;
  }

  @ApiOperation({
    summary: 'Compone los contadores de los tableros por rol',
    description:
      'Pregunta a los cinco servicios y devuelve lo que cada uno respondió. No calcula nada: ' +
      'cada número lo contó el servicio dueño de la tabla, que es el único que puede. Una ' +
      'sección que no llegó viene en null y deja el tile vacío en lugar de romper la pantalla.',
  })
  @Get()
  public async read(@Req() request: GatewayRequest): Promise<Record<string, unknown>> {
    return await this.#dashboard.execute({
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }
}
