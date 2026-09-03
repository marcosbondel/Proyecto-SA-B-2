import { Controller, Get, Inject, Query, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { QueriesUseCase } from '../application/routes/queries.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { Roles } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';
import { validated } from './validation';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The audit trail and the notifications console, both restricted to
 * `ADMINISTRADOR`.
 *
 * D-06 restricts these by role rather than by scope — "Read the audit record
 * **and notifications**: ✘ ✘ ✔" — which is why the two live on one controller
 * and why this is the pair of routes that proves `403` and `401` are different
 * answers.
 *
 * The second route is nested under `api/audit` rather than given a top-level
 * `api/notifications`, because it is not a resource of its own: it is the same
 * record read across correlations instead of within one. Nesting it keeps the
 * role decoration, the module and the frontend route (`/auditoria`) saying the
 * same thing, and stops a future reader from wondering which of two top-level
 * paths D-06 was talking about.
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

  @ApiOperation({
    summary: 'Consulta los eventos de auditoría más recientes paginados',
    description: 'Solo ADMINISTRADOR. Permite navegar los eventos del sistema con paginación.',
  })
  @Roles('ADMINISTRADOR')
  @Get('recent')
  public async recent(
    @Query('page') pageRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    const page = Math.max(1, Number(pageRaw) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitRaw) || 10));

    return await this.#queries.auditEventsList(
      { page, limit },
      {
        actor: actorOf(request),
        correlationId: request.correlationId,
      },
    );
  }

  /**
   * What the bank has told people, newest first.
   *
   * Added by T-20 for the notifications console the Claude Design prototype
   * draws as `N-01`. The prototype's screen is a *customer's* inbox with a
   * read/unread state, and this is not that: no service holds a per-customer
   * notification list and nothing anywhere records that somebody read
   * something. What exists is the operational record of what was sent, so that
   * is what the route exposes, to the role D-06 already grants it to. The
   * difference is recorded as TD-041.
   *
   * The rows carry a **simulated** recipient (§4.1) — derived from the customer
   * the flow was acting for, never a real address copied off a payload — which
   * is the other reason the route is staff-only.
   */
  @ApiOperation({
    summary: 'Lista las notificaciones que el sistema generó',
    description:
      'Solo ADMINISTRADOR, por D-06. Devuelve el registro operativo de lo que se envió, ' +
      'con destinatario simulado y estado real (PENDING/SENT/FAILED), acotado y con la ' +
      'cuenta de lo omitido. No es la bandeja del cliente: no existe (TD-041).',
  })
  @Roles('ADMINISTRADOR')
  @Get('notifications')
  public async notifications(
    @Query(validated(ListNotificationsQueryDto)) query: ListNotificationsQueryDto,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    return await this.#queries.notifications(
      {
        ...(query.correlationId === undefined ? {} : { correlationId: query.correlationId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      },
      { actor: actorOf(request), correlationId: request.correlationId },
    );
  }
}
