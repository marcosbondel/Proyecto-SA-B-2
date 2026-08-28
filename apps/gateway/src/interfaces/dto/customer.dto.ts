import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const ROLES = ['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR'] as const;

const IDENTITY_VERDICTS = ['VALIDATED', 'REJECTED'] as const;

/** A teller's manual verdict on an identity document. */
export class SetIdentityVerdictDto {
  @IsIn(IDENTITY_VERDICTS, {
    message: `verdict debe ser uno de: ${IDENTITY_VERDICTS.join(', ')}`,
  })
  public verdict!: (typeof IDENTITY_VERDICTS)[number];
}

/**
 * The registration form, as it arrives in a `multipart/form-data` body.
 *
 * Every bound mirrors `customer.register.v1`. Duplicating them here is not
 * redundancy: it is the difference between a `400` that names the field and a
 * message that is refused somewhere the caller cannot see.
 */
export class RegisterCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  public fullName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  public identityDocument!: string;

  @IsEmail({}, { message: 'email debe ser una dirección de correo válida' })
  public email!: string;

  @IsDateString({ strict: true }, { message: 'dateOfBirth debe tener el formato YYYY-MM-DD' })
  public dateOfBirth!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  public address!: string;

  @IsIn(ROLES, { message: `role debe ser uno de: ${ROLES.join(', ')}` })
  public role!: (typeof ROLES)[number];

  /**
   * Eight characters minimum, matching the contract.
   *
   * A floor is safe here in a way it is not on sign-in: refusing a short
   * password when someone is *choosing* one tells an attacker nothing, while
   * refusing one when someone is *proving* it would.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  public credential!: string;
}

/** At least one field must change; the empty update is refused by the contract. */
export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  public fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  public address?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'dateOfBirth debe tener el formato YYYY-MM-DD' })
  public dateOfBirth?: string;
}

/** The activation token from the emailed link. Opaque, and never logged. */
export class VerifyEmailDto {
  @Type(() => String)
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  public token!: string;
}
