import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { InterbankSendUseCase } from '../application/routes/interbank-send.use-case';
import { QueriesUseCase } from '../application/routes/queries.use-case';
import { InterbankCallbackUseCase } from '../application/routes/interbank-callback.use-case';
import { InterbankReceiveUseCase } from '../application/routes/interbank-receive.use-case';
import { actorOf } from './actor';
import { InterbankTransferDto, ListInterbankSendsQueryDto } from './dto/interbank.dto';
import { InterbankTokenGuard } from './guards/interbank-token.guard';
import { Public, Roles } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';
import { validated } from './validation';

@ApiTags('interbank')
@Controller('api/interbank')
export class InterbankController {
  constructor(
    @Inject(InterbankReceiveUseCase) readonly receiveUseCase: InterbankReceiveUseCase,
    @Inject(InterbankCallbackUseCase) readonly callbackUseCase: InterbankCallbackUseCase,
    @Inject(InterbankSendUseCase) readonly sendUseCase: InterbankSendUseCase,
    @Inject(QueriesUseCase) readonly queries: QueriesUseCase,
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
   * **Sólo `CLIENTE`** (D7a). Un envío interbancario es un producto del cliente
   * sobre sus propias cuentas; a diferencia de la transferencia interna, D-06 no
   * le da ninguna fila a la ventanilla ni al administrador. Sin este decorador
   * un `CAJERO_RECEPTOR` o un `ADMINISTRADOR` —que la visibilidad de Account sí
   * deja leer cualquier cuenta— podían originar un envío, con el débito
   * incluido, desde la cuenta de cualquier cliente. La otra mitad, que el
   * `CLIENTE` sea el dueño de la cuenta origen, la decide Account al contestar
   * la pregunta del número de cuenta: la ajena responde `NOT_FOUND`.
   *
   * La orquestación vive en `InterbankSendUseCase` (T-60): valida el borde
   * —moneda, banco, límite—, pregunta a Account por el número de la cuenta
   * origen que el contrato exige, y mina los identificadores.
   */
  @ApiOperation({
    summary: 'Envía un depósito al banco pareja',
    description:
      'Inicia la Saga de siempre: debita la cuenta origen, pide el pago al banco pareja y ' +
      'compensa si lo rechaza o no contesta. El 202 significa que la transferencia se aceptó, ' +
      'no que el otro banco la acreditó — eso llega por callback y se consulta en ' +
      '`GET /api/interbank/transfers/{interbankTransferId}`. El identificador interbancario y la ' +
      'clave de idempotencia los genera el Gateway, derivados de la `Idempotency-Key` de la ' +
      'petición: reintentar con la misma clave devuelve los mismos identificadores. Sólo un ' +
      'CLIENTE puede enviar, y sólo desde una cuenta propia. Se rechaza con 400, sin debitar, una moneda ' +
      'distinta de GTQ, un banco que no es el pareja configurado y un monto por encima del ' +
      'límite por operación.',
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
        interbankTransferId: { type: 'string', format: 'uuid' },
        correlationId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Solicitud malformada o fuera de los límites.' })
  @ApiResponse({
    status: 403,
    description: 'Sólo un CLIENTE puede enviar un depósito interbancario, desde sus cuentas.',
  })
  @Roles('CLIENTE')
  @Post('transfers')
  @HttpCode(202)
  async send(
    @Body(validated(InterbankTransferDto)) body: InterbankTransferDto,
    @Req() request: GatewayRequest,
  ): Promise<{ transactionId: string; interbankTransferId: string; correlationId: string }> {
    return await this.sendUseCase.send({
      sourceAccount: body.sourceAccount,
      destinationBankCode: body.destinationBankCode,
      destinationAccount: body.destinationAccount,
      amount: { amountMinor: body.amount.amountMinor, currency: body.amount.currency },
      actor: actorOf(request),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }

  /**
   * Los depósitos que este banco envió (T-60, B10).
   *
   * Sin `@Roles`: la restricción es por **alcance**, no por rol. Payment Service
   * guarda quién pidió cada depósito y acota la respuesta con la identidad del
   * sobre —un `CLIENTE` ve los suyos; `CAJERO_RECEPTOR` y `ADMINISTRADOR`, todos—,
   * de modo que un decorador aquí sería una segunda copia, más gruesa, de una
   * regla que el servicio dueño ya aplica fila por fila.
   */
  @ApiOperation({
    summary: 'Lista los depósitos enviados al banco pareja',
    description:
      'Del más reciente al más antiguo. Un CLIENTE ve los suyos; CAJERO_RECEPTOR y ' +
      'ADMINISTRADOR ven todos. Cada depósito trae sus seis estados posibles (PENDING, SENT, ' +
      'ACCEPTED, REJECTED, TIMEOUT, REVERSED), el motivo, el banco y la cuenta destino ' +
      '(enmascarada), el monto, las fechas, el correlationId y el traceId.',
  })
  @ApiBearerAuth('session')
  @Get('transfers')
  async list(
    @Query(validated(ListInterbankSendsQueryDto)) query: ListInterbankSendsQueryDto,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    return await this.queries.interbankSends(
      {
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      },
      { actor: actorOf(request), correlationId: request.correlationId },
    );
  }

  /** Un depósito enviado, con su historial de estados (T-60, B10). */
  @ApiOperation({
    summary: 'Consulta un depósito enviado al banco pareja',
    description:
      'Devuelve el depósito y su historial de estados, del más antiguo al más reciente. Un ' +
      'depósito de otro cliente responde 404, igual que uno inexistente.',
  })
  @ApiBearerAuth('session')
  @ApiResponse({ status: 404, description: 'No existe, o no es del solicitante.' })
  @Get('transfers/:interbankTransferId')
  async one(
    @Param('interbankTransferId', new ParseUUIDPipe({ version: '4' })) interbankTransferId: string,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    return await this.queries.interbankSend(interbankTransferId, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
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
