import { Body, Controller, Get, Inject, Param, Put, Query, Req } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { paymentSimulationUpdateV1 } from '@bank/contracts';
import type { PaymentSimulationUpdateV1 } from '@bank/contracts';

import { QueriesUseCase } from '../application/routes/queries.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import { ListPaymentsQueryDto, UpdatePaymentSimulationDto } from './dto/payment.dto';
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
   * How the simulated provider is set up right now (T-44).
   *
   * Declared **before** `:paymentId`: Nest matches in declaration order, and
   * `simulation` is a valid path segment that the parameter route would take for
   * a malformed payment id and answer with a `400`.
   */
  @ApiOperation({
    summary: 'Consulta la simulación del proveedor de pagos',
    description:
      'Solo ADMINISTRADOR. Devuelve la tasa de fallos, la tasa de timeouts y la latencia ' +
      'vigentes, y si vienen del ConfigMap (DEFAULTS) o de un cambio en caliente (RUNTIME).',
  })
  @Roles('ADMINISTRADOR')
  @Get('simulation')
  public async simulation(@Req() request: GatewayRequest): Promise<Record<string, unknown>> {
    return await this.#queries.paymentSimulation({
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }

  /**
   * Changes how the simulated provider misbehaves, without a redeploy (T-44).
   *
   * `PUT` and not `PATCH`: the body is the whole simulation — all three
   * numbers — or `{ "reset": true }`. The Gateway does not merge a partial
   * body with the current values, because the merge would have to happen in
   * Payment Service, and a refusal from there has no shape the Gateway can
   * parse. It is the same all-or-nothing rule the contract states.
   *
   * It publishes one command and waits for the owning service's answer; there
   * is no HTTP between the Gateway and Payment Service.
   */
  @ApiOperation({
    summary: 'Cambia en caliente la simulación del proveedor de pagos',
    description:
      'Solo ADMINISTRADOR. Cuerpo: failureRatePercent, timeoutRatePercent (0–100, su suma no ' +
      'puede superar 100) y latencyMs (0–30 000), o bien { "reset": true } para volver a los ' +
      'valores del ConfigMap. Aplica solo a pagos cuya transferencia no indicó un scenario. ' +
      'Responde con la simulación que quedó vigente.',
  })
  @Roles('ADMINISTRADOR')
  @Put('simulation')
  public async updateSimulation(
    @Body(validated(UpdatePaymentSimulationDto)) body: UpdatePaymentSimulationDto,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    return await this.#queries.updatePaymentSimulation(commandFrom(body), {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
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

/**
 * The body as the command the contract describes, or the first thing wrong with
 * it, said in Spanish.
 *
 * The contract has the last word — the result is parsed against it — but its
 * issues are not written for a person, so the three ways a body can be wrong
 * are named here first.
 */
function commandFrom(body: UpdatePaymentSimulationDto): PaymentSimulationUpdateV1 {
  const { reset, failureRatePercent, timeoutRatePercent, latencyMs } = body;
  const given = [failureRatePercent, timeoutRatePercent, latencyMs].filter(
    (value) => value !== undefined,
  );

  if (reset === true) {
    if (given.length > 0) {
      throw GatewayError.validation(
        'reset no se combina con los demás parámetros: envía solo { "reset": true }.',
        'reset',
      );
    }

    return { reset: true };
  }

  if (reset === false) {
    throw GatewayError.validation(
      'reset solo puede ser verdadero; para cambiar la simulación envía los tres parámetros.',
      'reset',
    );
  }

  if (failureRatePercent === undefined) {
    throw GatewayError.validation(
      'Indica los tres parámetros (failureRatePercent, timeoutRatePercent y latencyMs) o bien reset.',
      'failureRatePercent',
    );
  }

  if (timeoutRatePercent === undefined) {
    throw GatewayError.validation(
      'Indica los tres parámetros (failureRatePercent, timeoutRatePercent y latencyMs) o bien reset.',
      'timeoutRatePercent',
    );
  }

  if (latencyMs === undefined) {
    throw GatewayError.validation(
      'Indica los tres parámetros (failureRatePercent, timeoutRatePercent y latencyMs) o bien reset.',
      'latencyMs',
    );
  }

  if (failureRatePercent + timeoutRatePercent > 100) {
    throw GatewayError.validation(
      'La tasa de fallos y la de timeouts, juntas, no pueden superar el 100 % de los intentos.',
      'timeoutRatePercent',
    );
  }

  const parsed = paymentSimulationUpdateV1.schema.safeParse({
    failureRatePercent,
    timeoutRatePercent,
    latencyMs,
  });

  if (!parsed.success) {
    throw GatewayError.validation('Los parámetros de la simulación no son válidos.');
  }

  return parsed.data;
}
