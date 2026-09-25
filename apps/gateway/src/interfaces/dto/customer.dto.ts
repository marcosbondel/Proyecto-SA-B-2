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
    message: `El veredicto debe ser uno de: ${IDENTITY_VERDICTS.join(', ')}.`,
  })
  public verdict!: (typeof IDENTITY_VERDICTS)[number];
}

const KYC_VERDICTS = ['VERIFIED', 'REJECTED'] as const;

/**
 * A teller's manual verdict on a customer's KYC status (Fase 2, §4.1 p. 4;
 * T-31). Distinct from `SetIdentityVerdictDto`: that one is Fase 1's
 * document-photo review, this one is the broader compliance verdict the
 * transfer Saga's own KYC gate reads.
 */
export class SetKycStatusDto {
  @IsIn(KYC_VERDICTS, {
    message: `El estado KYC debe ser uno de: ${KYC_VERDICTS.join(', ')}.`,
  })
  public status!: (typeof KYC_VERDICTS)[number];
}

/**
 * The registration form, as it arrives in a `multipart/form-data` body.
 *
 * Every bound mirrors `customer.register.v1`. Duplicating them here is not
 * redundancy: it is the difference between a `400` that names the field and a
 * message that is refused somewhere the caller cannot see.
 */
export class RegisterCustomerDto {
  @IsString({ message: 'El nombre completo debe ser un texto.' })
  @MinLength(1, { message: 'El nombre completo es obligatorio.' })
  @MaxLength(200, { message: 'El nombre completo no puede superar los 200 caracteres.' })
  public fullName!: string;

  @IsString({ message: 'El documento de identidad debe ser un texto.' })
  @MinLength(1, { message: 'El documento de identidad es obligatorio.' })
  @MaxLength(50, { message: 'El documento de identidad no puede superar los 50 caracteres.' })
  public identityDocument!: string;

  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  public email!: string;

  @IsDateString(
    { strict: true },
    { message: 'La fecha de nacimiento debe tener el formato AAAA-MM-DD.' },
  )
  public dateOfBirth!: string;

  @IsString({ message: 'La dirección debe ser un texto.' })
  @MinLength(1, { message: 'La dirección es obligatoria.' })
  @MaxLength(300, { message: 'La dirección no puede superar los 300 caracteres.' })
  public address!: string;

  @IsIn(ROLES, { message: `El rol debe ser uno de: ${ROLES.join(', ')}.` })
  public role!: (typeof ROLES)[number];

  /**
   * Eight characters minimum, matching the contract.
   *
   * A floor is safe here in a way it is not on sign-in: refusing a short
   * password when someone is *choosing* one tells an attacker nothing, while
   * refusing one when someone is *proving* it would.
   */
  @IsString({ message: 'La contraseña debe ser un texto.' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(256, { message: 'La contraseña es demasiado larga.' })
  public credential!: string;
}

/** At least one field must change; the empty update is refused by the contract. */
export class UpdateCustomerDto {
  @IsOptional()
  @IsString({ message: 'El nombre completo debe ser un texto.' })
  @MinLength(1, { message: 'El nombre completo es obligatorio.' })
  @MaxLength(200, { message: 'El nombre completo no puede superar los 200 caracteres.' })
  public fullName?: string;

  @IsOptional()
  @IsString({ message: 'La dirección debe ser un texto.' })
  @MinLength(1, { message: 'La dirección es obligatoria.' })
  @MaxLength(300, { message: 'La dirección no puede superar los 300 caracteres.' })
  public address?: string;

  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'La fecha de nacimiento debe tener el formato AAAA-MM-DD.' },
  )
  public dateOfBirth?: string;
}

/** The activation token from the emailed link. Opaque, and never logged. */
export class VerifyEmailDto {
  @Type(() => String)
  @IsString({ message: 'El token de activación debe ser un texto.' })
  @MinLength(16, { message: 'El token de activación no es válido.' })
  @MaxLength(512, { message: 'El token de activación no es válido.' })
  public token!: string;
}

/**
 * `C-01`'s "cambiar contraseña".
 *
 * The current credential has **no minimum beyond one character**, the way
 * `LoginDto`'s does not: refusing a short one here would tell the caller
 * something about what a valid password looks like, and every wrong current
 * password must be answered identically. The new one carries registration's own
 * bounds, so a password set here and one set at sign-up are equally acceptable.
 */
export class ChangePasswordDto {
  @IsString({ message: 'La contraseña actual debe ser un texto.' })
  @MinLength(1, { message: 'La contraseña actual es obligatoria.' })
  @MaxLength(256, { message: 'La contraseña actual es demasiado larga.' })
  public currentCredential!: string;

  @IsString({ message: 'La contraseña nueva debe ser un texto.' })
  @MinLength(8, { message: 'La contraseña nueva debe tener al menos 8 caracteres.' })
  @MaxLength(256, { message: 'La contraseña nueva es demasiado larga.' })
  public newCredential!: string;
}
