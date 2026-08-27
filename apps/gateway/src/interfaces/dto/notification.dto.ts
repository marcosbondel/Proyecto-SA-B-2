import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;

/**
 * The filters the notifications console may carry.
 *
 * Every one optional and every one a genuine narrowing rather than a scope
 * request — there is no `customerId` here for the same reason there is none on
 * the payment listing: the owning service holds a simulated recipient and a
 * `correlationId`, and resolving either to a person means reading another
 * service's tables (§8.2, 2.3). That absence is why the route is restricted by
 * role instead. Offering a filter the owning service cannot evaluate would be
 * worse than offering none, because it would read like a scope and behave like
 * a suggestion.
 */
export class ListNotificationsQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'correlationId debe ser un UUID v4' })
  public correlationId?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES, {
    message: `status debe ser uno de: ${NOTIFICATION_STATUSES.join(', ')}`,
  })
  public status?: (typeof NOTIFICATION_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'type admite a lo sumo 50 caracteres' })
  public type?: string;

  /**
   * Bounded here as well as in the contract, so an over-large `limit` is a
   * `400` next to the field rather than a message the owning service silently
   * refuses. A query string is always text; the transform is what makes
   * `?limit=abc` fail as "no es un entero" instead of arriving as `NaN`.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : (value as unknown)))
  @IsInt({ message: 'limit debe ser un entero' })
  @Min(1, { message: 'limit debe ser al menos 1' })
  @Max(200, { message: 'limit admite a lo sumo 200' })
  public limit?: number;
}
