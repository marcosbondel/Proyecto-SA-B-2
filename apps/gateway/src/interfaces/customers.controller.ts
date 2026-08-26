import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MAX_PHOTO_BYTES } from '@bank/contracts';

import { CommandsUseCase } from '../application/routes/commands.use-case';
import { RegisterCustomerUseCase } from '../application/routes/register-customer.use-case';
import { VerifyEmailUseCase } from '../application/routes/verify-email.use-case';
import type { VerifyEmailResult } from '../application/routes/verify-email.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import { RegisterCustomerDto, UpdateCustomerDto, VerifyEmailDto } from './dto/customer.dto';
import { Public } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';
import { actorOf } from './actor';
import { validated } from './validation';

/** What multer hands back for the uploaded part. */
interface UploadedPhoto {
  readonly buffer: Buffer;
  readonly mimetype: string;
  readonly size: number;
}

@ApiTags('customers')
@Controller('api/customers')
export class CustomersController {
  readonly #register: RegisterCustomerUseCase;
  readonly #commands: CommandsUseCase;
  readonly #verifyEmail: VerifyEmailUseCase;

  constructor(
    @Inject(RegisterCustomerUseCase) register: RegisterCustomerUseCase,
    @Inject(CommandsUseCase) commands: CommandsUseCase,
    @Inject(VerifyEmailUseCase) verifyEmail: VerifyEmailUseCase,
  ) {
    this.#register = register;
    this.#commands = commands;
    this.#verifyEmail = verifyEmail;
  }

  /**
   * The link from the activation email, opened in a browser by a person.
   *
   * It answers with a verdict rather than an acknowledgement because the
   * audience is human: "we are processing it, check back later" is not
   * something you can show someone who just clicked a link in their inbox.
   */
  @ApiOperation({
    summary: 'Activa la cuenta desde el enlace del correo',
    description:
      'Devuelve un veredicto en la misma respuesta, esperando el evento correlacionado ' +
      'hasta cinco segundos. El silencio produce 504, nunca un rechazo.',
  })
  @Public()
  @Get('verify-email')
  public async verifyEmail(
    @Query(validated(VerifyEmailDto)) query: VerifyEmailDto,
    @Req() request: GatewayRequest,
  ): Promise<VerifyEmailResult> {
    return await this.#verifyEmail.execute(query.token, request.correlationId);
  }

  /**
   * Registration, with the identity-document photo in the same request.
   *
   * `limits.fileSize` refuses an oversized upload **while it is still
   * arriving**, rather than after five megabytes have been buffered. That is
   * the difference between rejecting a request and letting an anonymous caller
   * choose how much memory this process uses.
   */
  @ApiOperation({
    summary: 'Registra un cliente, con la foto del documento',
    description:
      'La imagen se deposita en el almacenamiento de objetos y solo su referencia viaja ' +
      'por el broker. Devuelve 202: el registro aún no ocurrió.',
  })
  @ApiConsumes('multipart/form-data')
  @Public()
  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  public async register(
    @Body(validated(RegisterCustomerDto)) body: RegisterCustomerDto,
    @UploadedFile() photo: UploadedPhoto | undefined,
    @Req() request: GatewayRequest,
  ): Promise<{ readonly customerId: string; readonly correlationId: string }> {
    return await this.#register.execute({
      fullName: body.fullName,
      identityDocument: body.identityDocument,
      email: body.email,
      dateOfBirth: body.dateOfBirth,
      address: body.address,
      role: body.role,
      credential: body.credential,
      ...(photo === undefined ? {} : { photo: { bytes: photo.buffer, mimetype: photo.mimetype } }),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }

  /**
   * `:customerId` is the **subject**; the actor comes from the token.
   *
   * Whether this actor may update this subject is Customer Service's decision.
   * The gateway has no customer table and could not answer it without one.
   */
  @ApiOperation({
    summary: 'Actualiza los datos de un cliente',
    description:
      'El parámetro es el SUJETO; el actor sale del token. Si el actor puede operar sobre ' +
      'ese sujeto lo decide Customer Service, no el Gateway.',
  })
  @ApiBearerAuth('session')
  @Patch(':customerId')
  @HttpCode(202)
  public async update(
    @Param('customerId') customerId: string,
    @Body(validated(UpdateCustomerDto)) body: UpdateCustomerDto,
    @Req() request: GatewayRequest,
  ): Promise<{ readonly correlationId: string }> {
    if (!isUuidV4(customerId)) {
      throw GatewayError.validation('customerId debe ser un UUID v4', 'customerId');
    }

    return await this.#commands.updateCustomer({
      customerId,
      ...(body.fullName === undefined ? {} : { fullName: body.fullName }),
      ...(body.address === undefined ? {} : { address: body.address }),
      ...(body.dateOfBirth === undefined ? {} : { dateOfBirth: body.dateOfBirth }),
      actor: actorOf(request),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidV4(value: string): boolean {
  return UUID_V4.test(value);
}
