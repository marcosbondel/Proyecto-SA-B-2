import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { MarkNotificationsReadUseCase } from '../application/routes/mark-read.use-case';
import type { ReadResult } from '../application/routes/mark-read.use-case';
import { QueriesUseCase } from '../application/routes/queries.use-case';
import { MarkNotificationsReadDto } from './dto/notification.dto';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';
import { validated } from './validation';

/**
 * `N-01` — the signed-in customer's own notifications.
 *
 * A top-level path, unlike the console at `/api/audit/notifications`, and the
 * split is the point rather than an inconsistency. That one is the audit record
 * read across correlations: it carries the simulated recipient of every
 * delivery in the system and D-06 restricts it to `ADMINISTRADOR`. This one is
 * a person's inbox — no recipient, no delivery status, scoped by the owning
 * service to whoever is asking. Two audiences, two shapes, two paths.
 *
 * **No `@Roles`.** The restriction is by scope and it is applied where the rows
 * are: Notification & Audit Service reads the envelope's identity and answers
 * with that person's notifications, so an administrator asking here gets their
 * own inbox rather than everybody's.
 */
@ApiTags('notifications')
@ApiBearerAuth('session')
@Controller('api/notifications')
export class NotificationsController {
  readonly #queries: QueriesUseCase;
  readonly #markRead: MarkNotificationsReadUseCase;

  constructor(
    @Inject(QueriesUseCase) queries: QueriesUseCase,
    @Inject(MarkNotificationsReadUseCase) markRead: MarkNotificationsReadUseCase,
  ) {
    this.#queries = queries;
    this.#markRead = markRead;
  }

  @ApiOperation({
    summary: 'Lista las notificaciones del propio cliente',
    description:
      'El alcance sale del token y la consulta no lleva customerId: no hay forma de apuntarla ' +
      'al buzón de otra persona. Es una pregunta distinta de /api/audit/notifications, que es ' +
      'la consola de staff y sí lleva el destinatario simulado de cada envío.',
  })
  @Get()
  public async inbox(
    @Query('limit') limit: string | undefined,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    /**
     * Parsed leniently rather than validated: `limit` is a convenience, the
     * contract caps it anyway, and a `400` for a mistyped page size would be a
     * worse answer than the default one.
     */
    const parsed = limit === undefined ? undefined : Number.parseInt(limit, 10);
    const bounded =
      parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;

    return await this.#queries.inbox(bounded, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }

  /**
   * `200`, not `202`: the answer carries the new unread count, which is the one
   * thing the screen needs next. A `202` would mean asking again for a number
   * the write already knew.
   */
  @ApiOperation({
    summary: 'Marca notificaciones como leídas',
    description:
      'Sin notificationIds marca todas. El alcance sale del token: un id de otra persona no ' +
      'coincide con ninguna fila y no cambia nada, en lugar de producir un rechazo que ' +
      'confirmaría que ese id existe.',
  })
  @Post('read')
  @HttpCode(200)
  public async markRead(
    @Body(validated(MarkNotificationsReadDto)) body: MarkNotificationsReadDto,
    @Req() request: GatewayRequest,
  ): Promise<ReadResult> {
    return await this.#markRead.execute({
      ...(body.notificationIds === undefined ? {} : { notificationIds: body.notificationIds }),
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }
}
