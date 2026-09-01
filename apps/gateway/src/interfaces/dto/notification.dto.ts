import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_INBOX_ROWS } from '@bank/contracts';

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
  @IsUUID('4', { message: 'El código de seguimiento no tiene un formato válido.' })
  public correlationId?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES, {
    message: `El estado debe ser uno de: ${NOTIFICATION_STATUSES.join(', ')}.`,
  })
  public status?: (typeof NOTIFICATION_STATUSES)[number];

  @IsOptional()
  @IsString({ message: 'El tipo debe ser un texto.' })
  @MaxLength(50, { message: 'El tipo no puede superar los 50 caracteres.' })
  public type?: string;

  /**
   * Bounded here as well as in the contract, so an over-large `limit` is a
   * `400` next to the field rather than a message the owning service silently
   * refuses. A query string is always text; the transform is what makes
   * `?limit=abc` fail as "no es un entero" instead of arriving as `NaN`.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : (value as unknown)))
  @IsInt({ message: 'El límite debe ser un número entero.' })
  @Min(1, { message: 'El límite debe ser al menos 1.' })
  @Max(200, { message: 'El límite no puede superar 200.' })
  public limit?: number;
}

/**
 * `N-01`'s write: which notifications the reader has read.
 *
 * Absent `notificationIds` means all of them — the prototype's "marcar todas
 * como leídas", and by far the common case. There is deliberately no
 * `customerId`: whose notifications these are is decided by the owning service
 * from the token, and a field here would be a way to ask about somebody else's.
 */
export class MarkNotificationsReadDto {
  @IsOptional()
  @IsArray({ message: 'Debes enviar una lista de notificaciones.' })
  @ArrayMaxSize(MAX_INBOX_ROWS, {
    message: `No puedes marcar más de ${String(MAX_INBOX_ROWS)} notificaciones a la vez.`,
  })
  @IsUUID('4', { each: true, message: 'Cada notificación debe tener un identificador válido.' })
  public notificationIds?: string[];
}
