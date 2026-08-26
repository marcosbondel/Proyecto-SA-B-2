import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * What a sign-in request must look like.
 *
 * The bounds mirror `customer.authenticate.v1` so the gateway refuses at the
 * edge what the contract would refuse at the broker — which is the difference
 * between a `400` naming the field and a message that dies somewhere the caller
 * cannot see.
 */
export class LoginDto {
  /** Email is the login identifier (decision D-05), not the username. */
  @IsEmail({}, { message: 'email debe ser una dirección de correo válida' })
  public email!: string;

  /**
   * Never logged, never echoed, never republished.
   *
   * No minimum beyond one character on purpose: rejecting a short password here
   * would tell the caller something about what a valid password looks like, and
   * the answer to every bad credential must be identical.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  public credential!: string;
}
