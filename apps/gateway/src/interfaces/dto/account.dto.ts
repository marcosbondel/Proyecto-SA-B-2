import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const ACCOUNT_TYPES = ['MONETARIA', 'AHORRO'] as const;
const ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export class OpenAccountDto {
  @IsIn(ACCOUNT_TYPES, { message: `accountType debe ser uno de: ${ACCOUNT_TYPES.join(', ')}` })
  public accountType!: (typeof ACCOUNT_TYPES)[number];

  /**
   * The **subject**: whose account this is. Absent means "mine".
   *
   * A `CAJERO_RECEPTOR` opens accounts for walk-in clients, so this cannot come
   * from the token. Whether a given actor may act for a given subject is
   * Account Service's decision — the gateway has no data with which to judge
   * it, and inventing an answer here would be exactly the business logic
   * constitution V keeps out.
   */
  @IsOptional()
  @IsUUID('4', { message: 'customerId debe ser un UUID v4' })
  public customerId?: string;
}

/**
 * The filters a listing may carry. Every one of them is optional, and every one
 * of them is a **request** rather than a permission.
 *
 * The gateway holds no account table, so it cannot know which accounts the
 * asker is entitled to see. Account Service intersects these with decision
 * D-06 and answers with what survives — which is why naming somebody else's
 * `customerId` here produces an empty list rather than a `403`.
 */
export class ListAccountsQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'customerId debe ser un UUID v4' })
  public customerId?: string;

  @IsOptional()
  @IsIn(ACCOUNT_STATUSES, { message: `status debe ser uno de: ${ACCOUNT_STATUSES.join(', ')}` })
  public status?: (typeof ACCOUNT_STATUSES)[number];

  @IsOptional()
  @IsIn(ACCOUNT_TYPES, { message: `accountType debe ser uno de: ${ACCOUNT_TYPES.join(', ')}` })
  public accountType?: (typeof ACCOUNT_TYPES)[number];
}

/**
 * Deactivating or reactivating an account by hand.
 *
 * The reason is required and it is not decoration: this is the one account
 * operation with no automatic trigger behind it, so the audit trail's only
 * record of *why* is what the administrator typed. `account.set-status.v1`
 * makes it mandatory; this mirrors that so the refusal arrives as a `400` with
 * a field name rather than as a contract failure inside the broker.
 */
export class SetAccountStatusDto {
  @IsIn(ACCOUNT_STATUSES, { message: `status debe ser uno de: ${ACCOUNT_STATUSES.join(', ')}` })
  public status!: (typeof ACCOUNT_STATUSES)[number];

  @IsString()
  @Length(1, 300, { message: 'reason debe tener entre 1 y 300 caracteres' })
  public reason!: string;
}
