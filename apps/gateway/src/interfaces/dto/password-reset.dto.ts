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
  @IsEmail({}, { message: 'email debe ser una dirección de correo válida' })
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
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  public resetToken!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  public credential!: string;
}
