import { IsIn, IsOptional, IsUUID } from 'class-validator';

const ACCOUNT_TYPES = ['MONETARIA', 'AHORRO'] as const;

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
