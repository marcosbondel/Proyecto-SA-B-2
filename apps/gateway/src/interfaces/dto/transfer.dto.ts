import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { MAX_TRANSACTION_ROWS } from '@bank/contracts';

const SCENARIOS = ['APPROVE', 'REJECT', 'TRANSIENT_FAILURE'] as const;

/** The six states of the machine, as the listing may filter by them. */
const TRANSACTION_STATUSES = [
  'PENDING',
  'DEBITING',
  'PAYMENT_PENDING',
  'COMPLETED',
  'FAILED',
  'COMPENSATED',
] as const;

/** Money on the wire: an integer of minor units, never a float. */
export class MoneyDto {
  @IsInt({ message: 'El monto debe ser un número entero.' })
  @Min(1, { message: 'El monto debe ser mayor que cero.' })
  public amountMinor!: number;

  @IsString({ message: 'La moneda debe ser un texto.' })
  @Matches(/^[A-Z]{3}$/, {
    message: 'La moneda debe ser un código de tres letras en mayúsculas, por ejemplo GTQ.',
  })
  public currency!: string;
}

export class TransferDto {
  @IsUUID('4', { message: 'La cuenta de origen no tiene un formato válido.' })
  public sourceAccount!: string;

  @IsUUID('4', { message: 'La cuenta de destino no tiene un formato válido.' })
  public targetAccount!: string;

  /**
   * `IsDefined` and `IsObject` are not redundant with `ValidateNested`.
   *
   * `ValidateNested` walks a value it is given; handed `undefined` it finds
   * nothing to complain about and passes. The route then reads
   * `amount.amountMinor` and dies with a `500` — a validation failure reported
   * as an internal error, which is both wrong and unhelpful.
   */
  @IsDefined({ message: 'El monto es obligatorio.' })
  @IsObject({ message: 'El monto debe incluir la cantidad y la moneda.' })
  @ValidateNested()
  @Type(() => MoneyDto)
  public amount!: MoneyDto;

  /**
   * What the payment is for, when the target is a biller's collection account.
   *
   * Optional and never interpreted: the contract number belongs to the biller,
   * and a bank that validated its shape would refuse a valid one the day a
   * biller changed theirs. The Gateway carries it and passes it on.
   */
  @IsOptional()
  @IsString({ message: 'La referencia debe ser un texto.' })
  @MaxLength(60, { message: 'La referencia no puede superar los 60 caracteres.' })
  public reference?: string;

  /**
   * Demonstration only, and optional.
   *
   * The gateway checks it is one of the three names and passes it on. It never
   * changes its own behaviour based on the value: obeying it belongs to
   * Transaction Service, and doing it here would be a Saga decision taken at
   * the entry point.
   */
  @IsOptional()
  @IsIn(SCENARIOS, { message: `El escenario de pago debe ser uno de: ${SCENARIOS.join(', ')}.` })
  public paymentScenario?: (typeof SCENARIOS)[number];
}

/**
 * The filters a transfer listing may carry — every one optional, and every one
 * a **request** rather than a permission.
 *
 * The Gateway holds no transactions, so it cannot know which of them the asker
 * is entitled to see. Transaction Service intersects these with the scope it
 * derives from the envelope identity, which is why naming somebody else's
 * `customerId` here produces an empty list rather than a `403`.
 */
export class ListTransfersQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'El identificador del cliente no tiene un formato válido.' })
  public customerId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'El identificador de la cuenta no tiene un formato válido.' })
  public accountId?: string;

  @IsOptional()
  @IsIn(TRANSACTION_STATUSES, {
    message: `El estado debe ser uno de: ${TRANSACTION_STATUSES.join(', ')}.`,
  })
  public status?: (typeof TRANSACTION_STATUSES)[number];

  /**
   * Coerced from the query string, where everything is text. Without the
   * transform this arrives as `"25"` and the contract refuses it as not an
   * integer — a `400` for a request that was perfectly well formed.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero.' })
  @Min(1, { message: 'El límite debe ser mayor que cero.' })
  @Max(MAX_TRANSACTION_ROWS, {
    message: `El límite no puede superar ${String(MAX_TRANSACTION_ROWS)}.`,
  })
  public limit?: number;
}
