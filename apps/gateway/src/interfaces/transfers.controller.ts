import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CommandsUseCase } from '../application/routes/commands.use-case';
import { QueriesUseCase } from '../application/routes/queries.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import { ListTransfersQueryDto, TransferDto } from './dto/transfer.dto';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';
import { validated } from './validation';

@ApiTags('transfers')
@ApiBearerAuth('session')
@Controller('api/transfers')
export class TransfersController {
  readonly #commands: CommandsUseCase;
  readonly #queries: QueriesUseCase;

  constructor(
    @Inject(CommandsUseCase) commands: CommandsUseCase,
    @Inject(QueriesUseCase) queries: QueriesUseCase,
  ) {
    this.#commands = commands;
    this.#queries = queries;
  }

  /**
   * `T-04` — "which transfers are mine", the question no route could answer
   * until now (TD-033).
   *
   * `GET /api/transfers/{id}` has existed since T-18 and answers "how did this
   * one end". Without a listing, `/transferencias` offered a lookup by
   * identifier and explained why there was no history — honest, and not what
   * anybody wants after their third transfer.
   *
   * No `@Roles`. The restriction is by **scope**, not by role: Transaction
   * Service narrows the answer to the asker's own transfers unless they are
   * staff, using the `customer_id` it records at request time. A role decorator
   * here would be a second, coarser copy of a rule the owning service already
   * applies per row.
   */
  @ApiOperation({
    summary: 'Lista transferencias',
    description:
      'Los filtros son una PETICIÓN, no un permiso: Transaction Service los cruza con el ' +
      'alcance que deriva de la identidad del sobre. Un CLIENTE que nombre el customerId de ' +
      'otro recibe una lista vacía, nunca un 403.',
  })
  @Get()
  public async list(
    @Query(validated(ListTransfersQueryDto)) query: ListTransfersQueryDto,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    return await this.#queries.transfers(
      {
        ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
        ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      },
      { actor: actorOf(request), correlationId: request.correlationId },
    );
  }

  /**
   * Starts the Saga and steps back.
   *
   * The transaction identifier is minted here so the caller has something to
   * ask about immediately — the alternative is polling the audit record by
   * correlation, which works but is a worse first experience.
   */
  @ApiOperation({
    summary: 'Solicita una transferencia e inicia la Saga',
    description:
      'paymentScenario es opcional y solo de demostración: el Gateway lo valida y lo ' +
      'traslada, y nunca actúa sobre él.',
  })
  @Post()
  @HttpCode(202)
  public async request(
    @Body(validated(TransferDto)) body: TransferDto,
    @Req() request: GatewayRequest,
  ): Promise<{ readonly transactionId: string; readonly correlationId: string }> {
    return await this.#commands.requestTransfer({
      sourceAccount: body.sourceAccount,
      targetAccount: body.targetAccount,
      amount: { amountMinor: body.amount.amountMinor, currency: body.amount.currency },
      ...(body.paymentScenario === undefined ? {} : { paymentScenario: body.paymentScenario }),
      actor: actorOf(request),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }

  /**
   * How a caller finds out what became of a transfer they were told `202` for.
   *
   * A timeout here does **not** mean the transfer failed; it means the gateway
   * stopped waiting. The Saga carries on either way.
   */
  @ApiOperation({
    summary: 'Consulta el estado de una transacción',
    description: 'Un 504 aquí no significa que la transferencia falló.',
  })
  @Get(':transactionId')
  public async status(
    @Param('transactionId') transactionId: string,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    if (!UUID_V4.test(transactionId)) {
      throw GatewayError.validation('transactionId debe ser un UUID v4', 'transactionId');
    }

    return await this.#queries.transactionStatus(transactionId, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
