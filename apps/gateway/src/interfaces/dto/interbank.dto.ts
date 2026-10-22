import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { MoneyDto } from './transfer.dto';

/**
 * Lo que un cliente manda para enviar un depósito al banco pareja (T-47,
 * ajustado al contrato oficial en T-60).
 *
 * Lo que **no** está aquí y es deliberado: ni `targetAccount` ni
 * `interbankTransferId` ni la clave de idempotencia del depósito ni la cuenta
 * origen *como número*. Las pone el Gateway.
 *
 * - `targetAccount` es siempre la cuenta de liquidación interbancaria de este
 *   banco: dejar que el cliente la nombre sería dejarle elegir en qué cuenta
 *   propia entra el dinero.
 * - El `interbankTransferId` es la clave con la que el **otro** banco
 *   deduplica. Uno que viene de fuera es uno que se puede colisionar a
 *   propósito: dos depósitos con el mismo identificador y el otro banco acredita
 *   uno y descarta el otro, que es exactamente el «depósito duplicado» que §8.3
 *   penaliza con un 50 %.
 * - El número de la cuenta origen (`originAccount`) lo pregunta el Gateway a
 *   Account: el cliente manda el UUID que ya conoce, y no puede mentir sobre su
 *   número.
 *
 * Los dos formatos que el contrato fija se validan aquí: el `BankCode` es
 * `^BANK[0-9]{2}$` y el número de cuenta `^[A-Za-z0-9-]{1,34}$`. Antes se
 * aceptaban formas más laxas (`^[A-Z][A-Z0-9_]{1,31}$`, hasta 64 caracteres) que
 * ningún banco pareja habría aceptado.
 */
export class InterbankTransferDto {
  @ApiProperty({ format: 'uuid', description: 'La cuenta de este banco de la que sale el dinero.' })
  @IsUUID('4', { message: 'La cuenta de origen no tiene un formato válido.' })
  public sourceAccount!: string;

  @ApiProperty({
    pattern: '^BANK[0-9]{2}$',
    description: 'El código del banco pareja, acordado en el acuerdo de integración.',
  })
  @IsString()
  @Matches(/^BANK[0-9]{2}$/, { message: 'destinationBankCode debe cumplir ^BANK[0-9]{2}$.' })
  public destinationBankCode!: string;

  @ApiProperty({
    pattern: '^[A-Za-z0-9-]{1,34}$',
    description: 'El número de la cuenta en el banco pareja, tal como ese banco lo publica.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{1,34}$/, {
    message: 'destinationAccount debe cumplir ^[A-Za-z0-9-]{1,34}$.',
  })
  public destinationAccount!: string;

  @ApiProperty({ type: MoneyDto })
  @ValidateNested()
  @Type(() => MoneyDto)
  public amount!: MoneyDto;
}

const SEND_STATES = ['PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'TIMEOUT', 'REVERSED'] as const;

/**
 * Los filtros del listado de depósitos enviados (T-60, B10). Son una petición y
 * no un permiso: Payment los cruza con el alcance que deriva de la identidad.
 */
export class ListInterbankSendsQueryDto {
  @ApiPropertyOptional({ enum: SEND_STATES })
  @IsOptional()
  @IsIn(SEND_STATES, { message: `El estado debe ser uno de: ${SEND_STATES.join(', ')}.` })
  public state?: (typeof SEND_STATES)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero.' })
  @Min(1, { message: 'El límite debe ser mayor que cero.' })
  @Max(200, { message: 'El límite no puede superar 200.' })
  public limit?: number;
}
