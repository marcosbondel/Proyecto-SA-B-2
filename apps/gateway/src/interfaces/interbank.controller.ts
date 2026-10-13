import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { InterbankReceiveUseCase } from '../application/routes/interbank-receive.use-case';
import { InterbankTokenGuard } from './guards/interbank-token.guard';
import { Public } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';

@ApiTags('interbank')
@Controller('api/interbank')
export class InterbankController {
  constructor(@Inject(InterbankReceiveUseCase) readonly receiveUseCase: InterbankReceiveUseCase) {}

  @ApiOperation({
    summary: 'Recibe un depósito del banco asociado',
    description:
      'Contrato provisional T-46. Requiere el token compartido del banco asociado; responde al aceptar el comando. El resultado llega por callback.',
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
      ],
      additionalProperties: false,
      properties: {
        interbankTransferId: { type: 'string', minLength: 1, maxLength: 128 },
        idempotencyKey: { type: 'string', minLength: 1, maxLength: 128 },
        originBankCode: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,31}$' },
        destinationBankCode: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{1,31}$' },
        accountId: { type: 'string', format: 'uuid' },
        amount: {
          type: 'object',
          required: ['amountMinor', 'currency'],
          additionalProperties: false,
          properties: {
            amountMinor: { type: 'integer' },
            currency: { type: 'string', pattern: '^[A-Z]{3}$' },
          },
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
}
