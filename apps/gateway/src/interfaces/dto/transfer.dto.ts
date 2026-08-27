import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  IsUUID,
  ValidateNested,
} from 'class-validator';

const SCENARIOS = ['APPROVE', 'REJECT', 'TRANSIENT_FAILURE'] as const;

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
