import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CommandsUseCase } from '../application/routes/commands.use-case';
import { QueriesUseCase } from '../application/routes/queries.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import { OpenAccountDto } from './dto/account.dto';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';
import { validated } from './validation';

@ApiTags('accounts')
@ApiBearerAuth('session')
@Controller('api/accounts')
export class AccountsController {
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
   * `202`, not `201`: the account does not exist yet when this returns.
   *
   * Saying `201 Created` would be a lie with a URL attached. The caller gets an
   * identifier and a correlation, and finds out how it ended by asking.
   */
  @ApiOperation({
    summary: 'Abre una cuenta',
    description: 'Devuelve 202 y un accountId. La cuenta todavía no existe.',
  })
  @Post()
  @HttpCode(202)
  public async open(
    @Body(validated(OpenAccountDto)) body: OpenAccountDto,
    @Req() request: GatewayRequest,
  ): Promise<{ readonly accountId: string; readonly correlationId: string }> {
    return await this.#commands.openAccount({
      accountType: body.accountType,
      ...(body.customerId === undefined ? {} : { customerId: body.customerId }),
      actor: actorOf(request),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }

  /**
   * Waits for the owning service to answer, at most five seconds.
   *
   * Whether this actor may see this account is Account Service's decision: the
   * gateway has no account table and cannot know who owns what.
   */
  @ApiOperation({
    summary: 'Consulta el saldo de una cuenta',
    description: 'Espera la respuesta hasta cinco segundos; el silencio produce 504.',
  })
  @Get(':accountId/balance')
  public async balance(
    @Param('accountId') accountId: string,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    if (!UUID_V4.test(accountId)) {
      throw GatewayError.validation('accountId debe ser un UUID v4', 'accountId');
    }

    return await this.#queries.balanceOf(accountId, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
