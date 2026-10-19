import { Controller, Get, Inject, Query, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { producer } from '@bank/contracts';
import type { Producer } from '@bank/contracts';

import { QueriesUseCase } from '../application/routes/queries.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { Roles } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';
import { validated } from './validation';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** §4.1's classification (T-30). Matches `eventSeverity` in `@bank/contracts`. */
const EVENT_SEVERITIES = new Set(['INFO', 'WARNING', 'ERROR']);

/** A W3C trace-id: 32 lowercase hex digits, and not the reserved all-zero one. */
const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;

const SERVICES = new Set<string>(producer.options);

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
    description:
      'Solo ADMINISTRADOR. Permite navegar los eventos del sistema con paginación y acotar ' +
      'por los cuatro filtros de §4.1, combinables: severity (INFO/WARNING/ERROR), ' +
      'correlationId, traceId y service (el servicio que publicó el evento).',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Página, desde 1.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Eventos por página, de 1 a 100 (10 por omisión).' })
  @ApiQuery({ name: 'severity', required: false, enum: ['INFO', 'WARNING', 'ERROR'], description: 'Nivel del evento.' })
  @ApiQuery({ name: 'correlationId', required: false, type: String, description: 'UUID v4 del flujo de negocio.' })
  @ApiQuery({ name: 'traceId', required: false, type: String, description: 'trace-id W3C: 32 hexadecimales en minúscula, no todo ceros.' })
  @ApiQuery({ name: 'service', required: false, enum: producer.options, description: 'Servicio que publicó el evento.' })
  @Roles('ADMINISTRADOR')
  @Get('recent')
  public async recent(
    @Query('page') pageRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('severity') severityRaw: string | undefined,
    @Query('correlationId') correlationRaw: string | undefined,
    @Query('traceId') traceRaw: string | undefined,
    @Query('service') serviceRaw: string | undefined,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    const page = Math.max(1, Number(pageRaw) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitRaw) || 10));

    if (severityRaw !== undefined && !EVENT_SEVERITIES.has(severityRaw)) {
      throw GatewayError.validation('severity debe ser INFO, WARNING o ERROR', 'severity');
    }

    // Each filter is checked at the edge, so a malformed one is a 400 here and
    // never a query that silently matches nothing: an auditor who mistypes a
    // trace id must be told so, not shown an empty trail as if nothing happened.
    if (correlationRaw !== undefined && !UUID_V4.test(correlationRaw)) {
      throw GatewayError.validation('correlationId debe ser un UUID v4', 'correlationId');
    }

    if (traceRaw !== undefined && !TRACE_ID.test(traceRaw)) {
      throw GatewayError.validation(
        'traceId debe ser un identificador W3C de 32 caracteres hexadecimales en minúscula',
        'traceId',
      );
    }

    if (serviceRaw !== undefined && !SERVICES.has(serviceRaw)) {
      throw GatewayError.validation(
        `service debe ser uno de: ${producer.options.join(', ')}`,
        'service',
      );
    }

    return await this.#queries.auditEventsList(
      {
        page,
        limit,
        ...(severityRaw === undefined
          ? {}
          : { severity: severityRaw as 'INFO' | 'WARNING' | 'ERROR' }),
        ...(correlationRaw === undefined ? {} : { correlationId: correlationRaw }),
        ...(traceRaw === undefined ? {} : { traceId: traceRaw }),
        ...(serviceRaw === undefined ? {} : { service: serviceRaw as Producer }),
      },
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
