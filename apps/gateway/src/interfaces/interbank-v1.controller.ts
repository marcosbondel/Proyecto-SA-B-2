import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { InterbankV1UseCase } from '../application/routes/interbank-v1.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import { INTERBANK_BANK_CODE } from './interbank-v1.tokens';
import { InterbankApiKeyGuard } from './guards/interbank-api-key.guard';
import type { InterbankCaller } from './guards/interbank-api-key.guard';
import { Public } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';

/**
 * El contrato interbancario oficial, en su propio prefijo (T-56).
 *
 * **`/interbank/v1` y no `/api/interbank`**, porque el contrato fija el prefijo
 * —`https://{bankHost}/interbank/v1`— y un banco pareja que implemente el mismo
 * archivo va a llamar exactamente ahí. Las rutas de `/api/` siguen existiendo y
 * son **nuestras**: las usa el frontend, hablan de UUID y de centavos, y no
 * tienen por qué parecerse a esto.
 *
 * Está **fuera del OpenAPI del Gateway** (`@ApiExcludeController`) a propósito.
 * La especificación de estas siete operaciones es el archivo del curso, no la
 * nuestra: publicarlas también en `gateway.v1.yaml` crearía dos documentos que
 * pueden discrepar, y el que manda ya está decidido.
 *
 * Qué decide este controlador: **nada**. Lee la identidad del banco que llama
 * del guardián, delega, y traduce el resultado al código HTTP del contrato.
 */
@ApiExcludeController()
@Controller('interbank/v1')
export class InterbankV1Controller {
  constructor(
    @Inject(InterbankV1UseCase) readonly operaciones: InterbankV1UseCase,
    @Inject(INTERBANK_BANK_CODE) readonly bankCode: string,
  ) {}

  /**
   * `GET /health` — **sin autenticación**, porque el contrato lo dice:
   * `security: []`.
   *
   * Es deliberado y es útil: el banco pareja necesita poder saber si estamos en
   * pie **antes** de tener una clave válida, y el día de la integración esa es
   * la primera llamada que alguien hace. No revela nada: el código de banco ya
   * está en el acuerdo.
   */
  @Public()
  @Get('health')
  health(): { readonly status: 'UP'; readonly bankCode: string } {
    return { status: 'UP', bankCode: this.bankCode };
  }

  /** `POST /transfers` — recibir un depósito. */
  @Public()
  @UseGuards(InterbankApiKeyGuard)
  @Post('transfers')
  async receiveTransfer(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: GatewayRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const resultado = await this.operaciones.receiveTransfer(
      body,
      { idempotencyKey: idempotencyKey ?? null },
      callerOf(request),
      request.correlationId,
      new Date(),
    );

    /*
     * `202` para uno nuevo y `200` para una repetición idéntica. Son dos
     * códigos y no uno porque el contrato los distingue, y la distinción le
     * sirve al emisor: un `200` le dice «ya lo tenía, aquí está en qué quedó»,
     * que es información que un `202` le negaría.
     */
    response.status(resultado.kind === 'ACCEPTED' ? 202 : 200);

    return resultado.body;
  }

  /** `GET /transfers/{interbankTransferId}` — consultar el estado. */
  @Public()
  @UseGuards(InterbankApiKeyGuard)
  @Get('transfers/:interbankTransferId')
  async transferStatus(
    @Param('interbankTransferId') interbankTransferId: string,
    @Req() request: GatewayRequest,
  ): Promise<unknown> {
    return await this.operaciones.transferStatus(
      uuidOrFail(interbankTransferId),
      callerOf(request),
      request.correlationId,
    );
  }

  /** `POST /transfers/{interbankTransferId}/cancel`. */
  @Public()
  @UseGuards(InterbankApiKeyGuard)
  @Post('transfers/:interbankTransferId/cancel')
  @HttpCode(200)
  async cancelTransfer(
    @Param('interbankTransferId') interbankTransferId: string,
    @Body() body: unknown,
    @Req() request: GatewayRequest,
  ): Promise<unknown> {
    return await this.operaciones.cancelTransfer(
      uuidOrFail(interbankTransferId),
      body,
      callerOf(request),
      request.correlationId,
      new Date(),
    );
  }

  /** `POST /transfers/{interbankTransferId}/result` — el callback, como emisor. */
  @Public()
  @UseGuards(InterbankApiKeyGuard)
  @Post('transfers/:interbankTransferId/result')
  @HttpCode(200)
  async receiveResult(
    @Param('interbankTransferId') interbankTransferId: string,
    @Body() body: unknown,
    @Req() request: GatewayRequest,
  ): Promise<unknown> {
    return await this.operaciones.receiveResult(
      uuidOrFail(interbankTransferId),
      body,
      callerOf(request),
      request.correlationId,
      new Date(),
    );
  }

  /** `POST /reversals` — pedir la devolución de un depósito acreditado. */
  @Public()
  @UseGuards(InterbankApiKeyGuard)
  @Post('reversals')
  @HttpCode(202)
  async requestReversal(@Body() body: unknown, @Req() request: GatewayRequest): Promise<unknown> {
    return await this.operaciones.requestReversal(
      body,
      callerOf(request),
      request.correlationId,
      new Date(),
    );
  }

  /** `GET /reversals/{reversalId}`. */
  @Public()
  @UseGuards(InterbankApiKeyGuard)
  @Get('reversals/:reversalId')
  async reversalStatus(
    @Param('reversalId') reversalId: string,
    @Req() request: GatewayRequest,
  ): Promise<unknown> {
    return await this.operaciones.reversalStatus(
      uuidOrFail(reversalId),
      callerOf(request),
      request.correlationId,
    );
  }

  /** `GET /reconciliation?date=&page=&pageSize=` — la conciliación diaria. */
  @Public()
  @UseGuards(InterbankApiKeyGuard)
  @Get('reconciliation')
  async reconciliation(
    @Query('date') date: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() request: GatewayRequest,
  ): Promise<unknown> {
    if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw GatewayError.validation('La fecha es obligatoria, en formato YYYY-MM-DD.', 'date');
    }

    return await this.operaciones.reconciliation(
      {
        date,
        /* Los valores por defecto son los del contrato, no inventados aquí. */
        page: enteroEnRango(page, 1, 1, Number.MAX_SAFE_INTEGER, 'page'),
        pageSize: enteroEnRango(pageSize, 100, 1, 500, 'pageSize'),
      },
      callerOf(request),
      request.correlationId,
    );
  }
}

/**
 * Quién llamó, según su API key.
 *
 * El guardián ya lo resolvió; si falta es que la ruta se montó sin el guardián,
 * y eso no es un `401` que explicarle a nadie: es un error de programación que
 * debe verse como tal.
 */
function callerOf(request: GatewayRequest): InterbankCaller {
  const caller = (request as GatewayRequest & { interbankCaller?: InterbankCaller })
    .interbankCaller;

  if (caller === undefined) {
    throw new Error('Ruta interbancaria sin InterbankApiKeyGuard.');
  }

  return caller;
}

/**
 * El contrato declara los identificadores de ruta como `format: uuid`, así que
 * algo que no lo es nunca va a existir — y es mejor decirlo con un `400` que
 * preguntarle a Payment por un identificador imposible.
 */
function uuidOrFail(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw GatewayError.validation('El identificador debe ser un UUID.', 'interbankTransferId');
  }

  return value;
}

function enteroEnRango(
  raw: string | undefined,
  porDefecto: number,
  minimo: number,
  maximo: number,
  campo: string,
): number {
  if (raw === undefined || raw.length === 0) return porDefecto;

  const valor = Number(raw);

  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw GatewayError.validation(
      `${campo} debe ser un entero entre ${minimo} y ${maximo}.`,
      campo,
    );
  }

  return valor;
}

/** El prefijo que fija el contrato, por si alguien lo necesita componer. */
export const INTERBANK_V1_PREFIX = 'interbank/v1';
