import { Controller, Get, Inject, Query, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { QueriesUseCase } from '../application/routes/queries.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import { Roles } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The audit trail, restricted to `ADMINISTRADOR`.
 *
 * The only route in the system that decision D-06 restricts by role rather than
 * by scope — "Read the audit record and notifications: ✘ ✘ ✔". It is therefore
 * also the route that proves `403` and `401` are different answers.
 */
@ApiTags('audit')
@ApiBearerAuth('session')
@Controller('api/audit')
export class AuditController {
  readonly #queries: QueriesUseCase;

  constructor(@Inject(QueriesUseCase) queries: QueriesUseCase) {
    this.#queries = queries;
  }

  @ApiOperation({
    summary: 'Consulta el rastro de auditoría de una correlación',
    description:
      'La única ruta que D-06 restringe por rol: solo ADMINISTRADOR. Es la vía por la que ' +
      'el frontend averigua cómo terminó cualquier comando asíncrono.',
  })
  @Roles('ADMINISTRADOR')
  @Get()
  public async query(
    @Query('correlationId') correlationId: string | undefined,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    if (correlationId === undefined || !UUID_V4.test(correlationId)) {
      throw GatewayError.validation('correlationId debe ser un UUID v4', 'correlationId');
    }

    return await this.#queries.audit(correlationId, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }
}
