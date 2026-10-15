import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

import { MoneyDto } from './transfer.dto';

/**
 * Lo que un cliente manda para enviar un depósito al banco pareja (T-47).
 *
 * Lo que **no** está aquí y es deliberado: ni `targetAccount` ni
 * `interbankTransferId` ni la clave de idempotencia del depósito. Las tres las
 * pone el Gateway.
 *
 * - `targetAccount` es siempre la cuenta de liquidación interbancaria de este
 *   banco: dejar que el cliente la nombre sería dejarle elegir en qué cuenta
 *   propia entra el dinero.
 * - El `interbankTransferId` es la clave con la que el **otro** banco
 *   deduplica. Uno que viene de fuera es uno que se puede colisionar a
 *   propósito: dos depósitos con el mismo identificador y el otro banco acredita
 *   uno y descarta el otro, que es exactamente el «depósito duplicado» que §8.3
 *   penaliza con un 50 %.
 */
export class InterbankTransferDto {
  @ApiProperty({ format: 'uuid', description: 'La cuenta de este banco de la que sale el dinero.' })
  @IsString()
  @IsNotEmpty()
  public sourceAccount!: string;

  @ApiProperty({
    pattern: '^[A-Z][A-Z0-9_]{1,31}$',
    description: 'El código del banco pareja, acordado en el acuerdo de integración.',
  })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,31}$/, { message: 'destinationBankCode no tiene la forma acordada' })
  public destinationBankCode!: string;

  @ApiProperty({
    maxLength: 64,
    description: 'La cuenta en el banco pareja, tal como ese banco la nombra.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  public destinationAccount!: string;

  @ApiProperty({ type: MoneyDto })
  @ValidateNested()
  @Type(() => MoneyDto)
  public amount!: MoneyDto;
}
