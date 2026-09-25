import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CommandsUseCase } from '../application/routes/commands.use-case';
import { DepositUseCase } from '../application/routes/deposit.use-case';
import type { DepositResult } from '../application/routes/deposit.use-case';
import { QueriesUseCase } from '../application/routes/queries.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import {
  DepositDto,
  ListAccountsQueryDto,
  OpenAccountDto,
  SetAccountStatusDto,
} from './dto/account.dto';
import { Roles } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';
import { validated } from './validation';

@ApiTags('accounts')
@ApiBearerAuth('session')
@Controller('api/accounts')
export class AccountsController {
  readonly #commands: CommandsUseCase;
  readonly #queries: QueriesUseCase;
  readonly #deposit: DepositUseCase;

  constructor(
    @Inject(CommandsUseCase) commands: CommandsUseCase,
    @Inject(QueriesUseCase) queries: QueriesUseCase,
    @Inject(DepositUseCase) deposit: DepositUseCase,
  ) {
    this.#commands = commands;
    this.#queries = queries;
    this.#deposit = deposit;
  }

  /**
   * `G-01`'s dropdown: which services this bank collects for, and where each
   * one's collection account is.
   *
   * Open to every signed-in role, including `CLIENTE`, because paying a bill is
   * what a client does. It carries no balance — what a biller has collected is
   * none of a paying customer's business.
   *
   * It lives under `/api/accounts` rather than at a `/api/billers` of its own
   * because a biller *is* an account, held by Account Service, and a second
   * top-level path would suggest a second owner.
   */
  @ApiOperation({
    summary: 'Lista los servicios que se pueden pagar',
    description:
      'El catálogo de prestadores y la cuenta recaudadora de cada uno. Un pago de servicio ' +
      'es una transferencia a esa cuenta, así que no hay un tipo de movimiento aparte.',
  })
  @Get('billers')
  public async billers(@Req() request: GatewayRequest): Promise<Record<string, unknown>> {
    return await this.#queries.billers({
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }

  /**
   * `A-05` — the deposit window. `200`, not `202`, and it is the only
   * money-moving route in the system that answers synchronously.
   *
   * A transfer is `202` because the Saga has four more steps to take and nobody
   * can promise the outcome; a deposit is one credit to one account with no
   * counterparty, so the answer exists the moment the movement commits. It has
   * to: a teller is standing in front of somebody holding cash.
   *
   * Restricted to staff **here and in Account Service**, and the duplication is
   * deliberate rather than an oversight. This route mints money into an account
   * from outside the system, so the service that moves the balance must be sure
   * who asked — a `@Roles` here alone would be an authorization rule enforced
   * only by the component that has no ledger.
   */
  @ApiOperation({
    summary: 'Registra un depósito en ventanilla',
    description:
      'Solo CAJERO_RECEPTOR o ADMINISTRADOR. Devuelve 200 con el saldo resultante: es la ' +
      'única ruta de dinero que responde de forma síncrona, porque no hay Saga que esperar. ' +
      'Un depósito en una cuenta inactiva la reactiva (A-3) en lugar de ser rechazado.',
  })
  @Roles('CAJERO_RECEPTOR', 'ADMINISTRADOR')
  @Post(':accountId/deposit')
  @HttpCode(200)
  public async deposit(
    @Param('accountId') accountId: string,
    @Body(validated(DepositDto)) body: DepositDto,
    @Req() request: GatewayRequest,
  ): Promise<DepositResult> {
    if (!UUID_V4.test(accountId)) {
      throw GatewayError.validation('accountId debe ser un UUID v4', 'accountId');
    }

    return await this.#deposit.execute({
      accountId,
      amount: body.amount,
      ...(body.description === undefined ? {} : { description: body.description }),
      actor: actorOf(request),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
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
      ...(body.initialDeposit === undefined ? {} : { initialDeposit: body.initialDeposit }),
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

  /**
   * The accounts this caller may see.
   *
   * The filters are passed through untouched. Narrowing them by role here
   * would be the gateway deciding who owns what, and it has no table with
   * which to decide it — Account Service intersects them with D-06 and
   * answers with what survives.
   */
  @ApiOperation({
    summary: 'Lista cuentas',
    description:
      'Los filtros son una petición, no un permiso: Account Service los cruza con D-06. ' +
      'Una lista vacía significa lo mismo que "no hay nada que puedas ver".',
  })
  @Get()
  public async list(
    @Query(validated(ListAccountsQueryDto)) query: ListAccountsQueryDto,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    return await this.#queries.accounts(
      {
        ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.accountType === undefined ? {} : { accountType: query.accountType }),
      },
      { actor: actorOf(request), correlationId: request.correlationId },
    );
  }

  @ApiOperation({
    summary: 'Consulta los movimientos de una cuenta',
    description: 'Espera la respuesta hasta cinco segundos; el silencio produce 504.',
  })
  @Get(':accountId/operations')
  public async operations(
    @Param('accountId') accountId: string,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    if (!UUID_V4.test(accountId)) {
      throw GatewayError.validation('accountId debe ser un UUID v4', 'accountId');
    }

    return await this.#queries.operationsOf(accountId, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }

  /**
   * `202`, like every other command: the account has not changed yet when this
   * returns, and saying `200 OK` would claim otherwise.
   *
   * The one account route decision D-06 restricts by **role** rather than by
   * scope — "Deactivate or reactivate an account manually: ✘ ✘ ✔".
   */
  @ApiOperation({
    summary: 'Activa o desactiva una cuenta',
    description:
      'ADMINISTRADOR, CAJERO_RECEPTOR y CLIENTE (para sus propias cuentas). Devuelve 202: el cambio todavía no ocurrió. ' +
      'El motivo es obligatorio porque es el único registro de por qué se hizo.',
  })
  @Roles('ADMINISTRADOR', 'CAJERO_RECEPTOR', 'CLIENTE')
  @Post(':accountId/status')
  @HttpCode(202)
  public async setStatus(
    @Param('accountId') accountId: string,
    @Body(validated(SetAccountStatusDto)) body: SetAccountStatusDto,
    @Req() request: GatewayRequest,
  ): Promise<{ readonly correlationId: string }> {
    if (!UUID_V4.test(accountId)) {
      throw GatewayError.validation('accountId debe ser un UUID v4', 'accountId');
    }

    return await this.#commands.setAccountStatus({
      accountId,
      status: body.status,
      reason: body.reason,
      actor: actorOf(request),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
