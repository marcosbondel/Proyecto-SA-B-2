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
  @IsInt({ message: 'amount.amountMinor debe ser un entero en centavos' })
  @Min(1, { message: 'amount.amountMinor debe ser mayor que cero' })
  public amountMinor!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'amount.currency debe ser un código ISO-4217 en mayúsculas' })
  public currency!: string;
}

export class TransferDto {
  @IsUUID('4', { message: 'sourceAccount debe ser un UUID v4' })
  public sourceAccount!: string;

  @IsUUID('4', { message: 'targetAccount debe ser un UUID v4' })
  public targetAccount!: string;

  /**
   * `IsDefined` and `IsObject` are not redundant with `ValidateNested`.
   *
   * `ValidateNested` walks a value it is given; handed `undefined` it finds
   * nothing to complain about and passes. The route then reads
   * `amount.amountMinor` and dies with a `500` — a validation failure reported
   * as an internal error, which is both wrong and unhelpful.
   */
  @IsDefined({ message: 'amount es obligatorio' })
  @IsObject({ message: 'amount debe ser un objeto con amountMinor y currency' })
  @ValidateNested()
  @Type(() => MoneyDto)
  public amount!: MoneyDto;

  /**
   * Demonstration only, and optional.
   *
   * The gateway checks it is one of the three names and passes it on. It never
   * changes its own behaviour based on the value: obeying it belongs to
   * Transaction Service, and doing it here would be a Saga decision taken at
   * the entry point.
   */
  @IsOptional()
  @IsIn(SCENARIOS, { message: `paymentScenario debe ser uno de: ${SCENARIOS.join(', ')}` })
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
  @IsUUID('4', { message: 'customerId debe ser un UUID v4' })
  public customerId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'accountId debe ser un UUID v4' })
  public accountId?: string;

  @IsOptional()
  @IsIn(TRANSACTION_STATUSES, {
    message: `status debe ser uno de: ${TRANSACTION_STATUSES.join(', ')}`,
  })
  public status?: (typeof TRANSACTION_STATUSES)[number];

  /**
   * Coerced from the query string, where everything is text. Without the
   * transform this arrives as `"25"` and the contract refuses it as not an
   * integer — a `400` for a request that was perfectly well formed.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser mayor que cero' })
  @Max(MAX_TRANSACTION_ROWS, { message: `limit no puede exceder ${String(MAX_TRANSACTION_ROWS)}` })
  public limit?: number;
}
