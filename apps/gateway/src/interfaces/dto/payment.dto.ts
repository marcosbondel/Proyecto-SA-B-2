import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
const PAYMENT_ERROR_TYPES = ['TRANSIENT', 'PERMANENT'] as const;

/**
 * The filters the payment listing may carry.
 *
 * Every one optional, and — unlike the account listing — every one a genuine
 * *narrowing* rather than a scope request. Payment Service holds no reference
 * to a customer, so there is no filter here that could mean "mine": a payment
 * row knows a `transactionId` and nothing more about who is behind it.
 *
 * That absence is why the route above is restricted by role instead. Offering a
 * `customerId` filter the owning service cannot evaluate would be worse than
 * offering none — it would read like a scope and behave like a suggestion.
 */
export class ListPaymentsQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'El identificador de la transacción no tiene un formato válido.' })
  public transactionId?: string;

  @IsOptional()
  @IsIn(PAYMENT_STATUSES, { message: `El estado debe ser uno de: ${PAYMENT_STATUSES.join(', ')}.` })
  public status?: (typeof PAYMENT_STATUSES)[number];

  @IsOptional()
  @IsIn(PAYMENT_ERROR_TYPES, {
    message: `El tipo de error debe ser uno de: ${PAYMENT_ERROR_TYPES.join(', ')}.`,
  })
  public errorType?: (typeof PAYMENT_ERROR_TYPES)[number];
}

/**
 * What an administrator sends to change how the simulated provider behaves
 * (T-44).
 *
 * Every field is optional **here** and the combination is checked by the
 * route, against `paymentSimulationUpdateV1` — the contract is the one place
 * that says "all three, or `reset`, and never over 100 % together", so the
 * Gateway does not keep a second copy of that rule to drift from it. What this
 * class does is the part a contract cannot say in Spanish: refuse a value of
 * the wrong type, or out of range, with a message a person can act on.
 */
export class UpdatePaymentSimulationDto {
  @IsOptional()
  @IsNumber({}, { message: 'La tasa de fallos debe ser un número.' })
  @Min(0, { message: 'La tasa de fallos no puede ser negativa.' })
  @Max(100, { message: 'La tasa de fallos no puede superar el 100 %.' })
  public failureRatePercent?: number;

  @IsOptional()
  @IsNumber({}, { message: 'La tasa de timeouts debe ser un número.' })
  @Min(0, { message: 'La tasa de timeouts no puede ser negativa.' })
  @Max(100, { message: 'La tasa de timeouts no puede superar el 100 %.' })
  public timeoutRatePercent?: number;

  @IsOptional()
  @IsInt({ message: 'La latencia debe ser un número entero de milisegundos.' })
  @Min(0, { message: 'La latencia no puede ser negativa.' })
  @Max(30_000, { message: 'La latencia no puede superar los 30 000 ms.' })
  public latencyMs?: number;

  /** `true` devuelve la simulación a los valores del ConfigMap. */
  @IsOptional()
  @IsBoolean({ message: 'reset debe ser verdadero o falso.' })
  public reset?: boolean;
}
