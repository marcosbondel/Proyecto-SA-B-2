import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * "I forgot my password" — an address, and nothing else.
 *
 * The address is validated as an address because a malformed one cannot belong
 * to anybody and rejecting it costs nothing. What this must never do is check
 * whether it is *registered*: that answer is exactly what the flow refuses to
 * give, and the route returns the same `202` either way.
 */
export class RequestPasswordResetDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  public email!: string;
}

/**
 * The link, spent, with the new password.
 *
 * The bounds mirror `customer.password-reset.confirm.v1` so the gateway refuses
 * at the edge what the contract would refuse at the broker, and they are the
 * same bounds registration puts on a credential — a password chosen here and
 * one chosen at sign-up must be equally acceptable.
 */
export class ConfirmPasswordResetDto {
  /** A bearer credential. Never logged, never echoed. */
  @IsString({ message: 'El enlace de recuperación debe ser un texto.' })
  @MinLength(16, { message: 'El enlace de recuperación no es válido.' })
  @MaxLength(512, { message: 'El enlace de recuperación no es válido.' })
  public resetToken!: string;

  @IsString({ message: 'La contraseña debe ser un texto.' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(256, { message: 'La contraseña es demasiado larga.' })
  public credential!: string;
}
