import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { INTERBANK_SETTLEMENT_ACCOUNT_ID } from '@bank/contracts';
import { randomUUID } from 'node:crypto';

import { CommandsUseCase } from '../application/routes/commands.use-case';
import { InterbankCallbackUseCase } from '../application/routes/interbank-callback.use-case';
import { InterbankReceiveUseCase } from '../application/routes/interbank-receive.use-case';
import { actorOf } from './actor';
import { InterbankTransferDto } from './dto/interbank.dto';
import { InterbankTokenGuard } from './guards/interbank-token.guard';
import { Public } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';
import { validated } from './validation';

@ApiTags('interbank')
@Controller('api/interbank')
export class InterbankController {
  constructor(
    @Inject(InterbankReceiveUseCase) readonly receiveUseCase: InterbankReceiveUseCase,
    @Inject(InterbankCallbackUseCase) readonly callbackUseCase: InterbankCallbackUseCase,
    @Inject(CommandsUseCase) readonly commands: CommandsUseCase,
  ) {}

  @ApiOperation({
    summary: 'Recibe un depósito del banco asociado',
    description:
      'Contrato provisional (T-46, reconciliado con §4.1 en T-56). Requiere el token compartido ' +
      'del banco asociado; responde al aceptar el comando y el resultado llega por callback. ' +
      'El monto se acepta en centavos (`amountMinor`) o en decimal (`value`), y la cuenta ' +
      'destino es una cadena: una que este banco no reconozca se rechaza con ' +
      '`ACCOUNT_NOT_FOUND` **por callback**, no con un 400.',
  })
  @ApiBearerAuth('interbankPartner')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'interbankTransferId',
        'idempotencyKey',
        'originBankCode',
        'destinationBankCode',
        'accountId',
        'amount',
        'timestamp',
      ],
      additionalProperties: false,
      properties: {
        interbankTransferId: { type: 'string', minLength: 1, maxLength: 128 },
        idempotencyKey: { type: 'string', minLength: 1, maxLength: 128 },
        originBankCode: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,31}$' },
        destinationBankCode: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,31}$' },
        accountId: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          description:
            'La cuenta destino. Este banco identifica las suyas por UUID v4, que es lo que ' +
            'fija el acuerdo de integración; cualquier otra forma se acepta y se rechaza con ' +
            'ACCOUNT_NOT_FOUND por callback.',
        },
        amount: {
          oneOf: [
            {
              type: 'object',
              required: ['amountMinor', 'currency'],
              additionalProperties: false,
              properties: {
                amountMinor: { type: 'integer', description: 'Centavos. El formato de este banco.' },
                currency: { type: 'string', pattern: '^[A-Z]{3}$' },
              },
            },
            {
              type: 'object',
              required: ['value', 'currency'],
              additionalProperties: false,
              properties: {
                value: {
                  oneOf: [{ type: 'string' }, { type: 'number' }],
                  description:
                    'Decimal de dos cifras como máximo, p. ej. "125.00". Se convierte a ' +
                    'centavos con aritmética entera: ningún float toca el dinero.',
                },
                currency: { type: 'string', pattern: '^[A-Z]{3}$' },
              },
            },
          ],
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          description:
            'Cuándo lo originó el banco de origen (§4.1, datos mínimos). Se conserva aparte ' +
            'del momento en que lo recibimos.',
        },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Comando publicado para validación y crédito.',
    schema: {
      type: 'object',
      required: ['depositId', 'correlationId'],
      properties: {
        depositId: { type: 'string', format: 'uuid' },
        correlationId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Solicitud malformada.' })
  @ApiResponse({ status: 401, description: 'Token ausente, incorrecto o sin configurar.' })
  @Public()
  @UseGuards(InterbankTokenGuard)
  @Post('deposits')
  @HttpCode(202)
  async receive(
    @Body() body: unknown,
    @Req() request: GatewayRequest,
  ): Promise<{ depositId: string; correlationId: string }> {
    return await this.receiveUseCase.receive(body, request.correlationId);
  }

  /**
   * El cliente manda un depósito al banco pareja (T-47).
   *
   * Es una transferencia, y por eso publica `transfer.requested.v1`: el dinero
   * sale de la cuenta del cliente y entra en la **cuenta de liquidación
   * interbancaria** de este banco, que es lo que este banco le debe al otro.
   * Con eso la Saga de siempre hace todo el trabajo —KYC, débito bajo bloqueo
   * de fila, pago y compensación si no sale— y lo único distinto es que el paso
   * de pago se le pide al banco pareja y su respuesta llega por callback.
   *
   * El Gateway mina los dos identificadores que no pueden venir de fuera: el
   * `interbankTransferId`, que es la clave con la que el otro banco deduplica,
   * y la clave de idempotencia del depósito. Uno adivinable desde fuera es uno
   * que se puede colisionar a propósito — y un depósito duplicado es el 50 % de
   * §8.3.
   *
   * No valida que la cuenta de destino exista en el otro banco. No puede y no
   * le toca: eso lo dirá el banco pareja en su callback, y hasta entonces el
   * dinero está reservado, no entregado.
   */
  @ApiOperation({
    summary: 'Envía un depósito al banco pareja',
    description:
      'Inicia la Saga de siempre: debita la cuenta origen, pide el pago al banco pareja y ' +
      'compensa si lo rechaza o no contesta. El 202 significa que la transferencia se aceptó, ' +
      'no que el otro banco la acreditó — eso llega por callback y se consulta en el estado ' +
      'de la transferencia. El identificador interbancario y la clave de idempotencia los ' +
      'genera el Gateway.',
  })
  @ApiBearerAuth('session')
  @ApiResponse({
    status: 202,
    description: 'Transferencia aceptada; el resultado del banco pareja llega después.',
    schema: {
      type: 'object',
      required: ['transactionId', 'interbankTransferId', 'correlationId'],
      properties: {
        transactionId: { type: 'string', format: 'uuid' },
        interbankTransferId: { type: 'string' },
        correlationId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Solicitud malformada.' })
  @Post('transfers')
  @HttpCode(202)
  async send(
    @Body(validated(InterbankTransferDto)) body: InterbankTransferDto,
    @Req() request: GatewayRequest,
  ): Promise<{ transactionId: string; interbankTransferId: string; correlationId: string }> {
    const interbankTransferId = randomUUID();
    const accepted = await this.commands.requestTransfer({
      sourceAccount: body.sourceAccount,
      // Siempre la cuenta de liquidación: el cliente no elige dónde entra.
      targetAccount: INTERBANK_SETTLEMENT_ACCOUNT_ID,
      amount: { amountMinor: body.amount.amountMinor, currency: body.amount.currency },
      interbank: {
        bankCode: body.destinationBankCode,
        account: body.destinationAccount,
        interbankTransferId,
        idempotencyKey: interbankTransferId,
      },
      actor: actorOf(request),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });

    return { ...accepted, interbankTransferId };
  }

  /**
   * El banco pareja contesta sobre un depósito que este banco le envió (T-47).
   *
   * Mismo trato que la entrada de depósitos: token compartido, `202` en cuanto
   * el comando está en el broker, y ninguna decisión aquí. Si el depósito
   * existe, si la decisión llega a tiempo y si cambia algo son tres preguntas
   * de Payment Service, que es quien tiene la fila y la máquina de estados.
   */
  @ApiOperation({
    summary: 'Recibe la decisión del banco pareja sobre un depósito enviado',
    description:
      'Autenticado con el token compartido. Un ACCEPTED confirma el débito; un REJECTED, o el ' +
      'vencimiento del plazo, compensan y devuelven el dinero. Un callback repetido no cuenta ' +
      'la decisión dos veces.',
  })
  @ApiBearerAuth('interbankPartner')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['interbankTransferId', 'status', 'receivedAt'],
      additionalProperties: false,
      properties: {
        interbankTransferId: { type: 'string', minLength: 1, maxLength: 128 },
        status: { type: 'string', enum: ['ACCEPTED', 'REJECTED'] },
        reason: {
          type: 'string',
          enum: [
            'ACCOUNT_NOT_FOUND',
            'ACCOUNT_INACTIVE',
            'AMOUNT_EXCEEDS_LIMIT',
            'UNSUPPORTED_CURRENCY',
            'WRONG_DESTINATION_BANK',
            'BANK_NOT_AUTHORIZED',
            'INVALID_REQUEST',
            'IDEMPOTENCY_CONFLICT',
          ],
          description: 'Obligatorio en un REJECTED y prohibido en un ACCEPTED.',
        },
        receivedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 202, description: 'Decisión publicada para su registro.' })
  @ApiResponse({ status: 400, description: 'Callback malformado.' })
  @ApiResponse({ status: 401, description: 'Token ausente, incorrecto o sin configurar.' })
  @Public()
  @UseGuards(InterbankTokenGuard)
  @Post('callbacks')
  @HttpCode(202)
  async callback(
    @Body() body: unknown,
    @Req() request: GatewayRequest,
  ): Promise<{ correlationId: string }> {
    return await this.callbackUseCase.receive(body, request.correlationId);
  }
}
