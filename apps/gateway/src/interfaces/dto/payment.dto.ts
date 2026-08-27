import { IsIn, IsOptional, IsUUID } from 'class-validator';

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
  @IsUUID('4', { message: 'transactionId debe ser un UUID v4' })
  public transactionId?: string;

  @IsOptional()
  @IsIn(PAYMENT_STATUSES, { message: `status debe ser uno de: ${PAYMENT_STATUSES.join(', ')}` })
  public status?: (typeof PAYMENT_STATUSES)[number];

  @IsOptional()
  @IsIn(PAYMENT_ERROR_TYPES, {
    message: `errorType debe ser uno de: ${PAYMENT_ERROR_TYPES.join(', ')}`,
  })
  public errorType?: (typeof PAYMENT_ERROR_TYPES)[number];
}
