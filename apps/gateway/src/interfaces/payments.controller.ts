import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { QueriesUseCase } from '../application/routes/queries.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import { ListPaymentsQueryDto } from './dto/payment.dto';
import { Roles } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';
import { validated } from './validation';

/**
 * The two ways to ask Payment Service anything.
 *
 * Added by T-19, and both of them read-only on purpose. **There is no
 * `POST /api/payments`**, and its absence is a design decision rather than an
 * omission: in this system a payment is not something a person starts, it is
 * step 4 of the transfer Saga. `POST /api/transfers` is what creates one, and a
 * route that let a caller mint a payment directly would put a Saga participant
 * outside the Saga that is supposed to compensate it.
 *
 * The Claude Design prototype does draw a customer-facing "Nuevo pago" screen —
 * pay your electricity bill, pick a biller, type a contract number — and that
 * screen has no domain behind it here: no service holds a biller, a reference
 * or an external provider. `docs/DESIGN.md` says to keep the repository rule and
 * record the discrepancy rather than invent a third variant, so it is recorded
 * as TD-038 and not built.
 */
@ApiTags('payments')
@ApiBearerAuth('session')
@Controller('api/payments')
export class PaymentsController {
  readonly #queries: QueriesUseCase;

  constructor(@Inject(QueriesUseCase) queries: QueriesUseCase) {
    this.#queries = queries;
  }

  /**
   * The payment monitoring surface, restricted to staff.
   *
   * This is the third route decision D-06 restricts by **role** rather than by
   * scope, and the reason is a property of the owning service rather than a
   * policy choice. Every other listing narrows itself: Account Service knows
   * which accounts belong to whom and hands back what survives. Payment Service
   * knows a `transactionId` and nothing else — resolving it to a person means
   * reading another service's tables, which §8.2 criterion 2.3 forbids.
   *
   * So an unrestricted listing here would hand every authenticated `CLIENTE`
   * every payment in the bank. Given the choice between a scope this service
   * cannot compute and a role restriction it does not need to, the restriction
   * wins, and the customer-facing view of a payment stays where it already is
   * and is already scoped: inside the transfer that created it.
   *
   * D-06 has no row for this use case. It is read as the nearest one it does
   * have — operational monitoring of transactions, which is staff work — and
   * the gap is recorded as TD-037.
   */
  @ApiOperation({
    summary: 'Lista pagos para monitoreo',
    description:
      'Solo CAJERO_RECEPTOR y ADMINISTRADOR. Payment Service no guarda referencia al ' +
      'cliente, así que no puede acotar la lista por dueño: la restricción por rol es lo ' +
      'que hace segura la ruta (TD-037). Un CLIENTE ve su pago dentro de la transferencia.',
  })
  @Roles('CAJERO_RECEPTOR', 'ADMINISTRADOR')
  @Get()
  public async list(
    @Query(validated(ListPaymentsQueryDto)) query: ListPaymentsQueryDto,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    return await this.#queries.payments(
      {
        ...(query.transactionId === undefined ? {} : { transactionId: query.transactionId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.errorType === undefined ? {} : { errorType: query.errorType }),
      },
      { actor: actorOf(request), correlationId: request.correlationId },
    );
  }

  /**
   * One payment and the rungs of its retry ladder.
   *
   * Unrestricted by role, like the transfer status query it mirrors, and it
   * inherits that route's ownership gap exactly: any authenticated session that
   * knows a `paymentId` can read it. The identifier is an unguessable UUID v4,
   * which is mitigation and not authorization — TD-035, same cause, and it will
   * be fixed by the same decision.
   *
   * A `504` here means the gateway stopped waiting, not that the payment
   * failed. The Saga carries on either way.
   */
  @ApiOperation({
    summary: 'Consulta el estado de un pago y sus intentos',
    description:
      'Un 504 aquí no significa que el pago falló. Los intentos vienen de la tabla de ' +
      'evidencia del propio servicio, nunca del broker.',
  })
  @Get(':paymentId')
  public async status(
    @Param('paymentId') paymentId: string,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    if (!UUID_V4.test(paymentId)) {
      throw GatewayError.validation('paymentId debe ser un UUID v4', 'paymentId');
    }

    return await this.#queries.paymentStatus(paymentId, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
