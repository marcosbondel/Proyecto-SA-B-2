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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { MAX_PHOTO_BYTES } from '@bank/contracts';
import type { Identity } from '@bank/contracts';
import type { Response } from 'express';

import { ChangePasswordUseCase } from '../application/routes/change-password.use-case';
import type { ChangedPassword } from '../application/routes/change-password.use-case';
import { CommandsUseCase } from '../application/routes/commands.use-case';
import { IdentityDocumentUseCase } from '../application/routes/identity-document.use-case';
import { QueriesUseCase } from '../application/routes/queries.use-case';
import { RegisterCustomerUseCase } from '../application/routes/register-customer.use-case';
import { VerifyEmailUseCase } from '../application/routes/verify-email.use-case';
import type { VerifyEmailResult } from '../application/routes/verify-email.use-case';
import { GatewayError } from '../application/errors/gateway-error';
import {
  ChangePasswordDto,
  RegisterCustomerDto,
  SetIdentityVerdictDto,
  SetKycStatusDto,
  UpdateCustomerDto,
  VerifyEmailDto,
} from './dto/customer.dto';
import { Public, Roles } from './guards/route-access.decorator';
import { SESSION_VERIFIER, bearerTokenOf } from './guards/jwt.guard';
import type { SessionVerifierPort } from './guards/jwt.guard';
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
  readonly #queries: QueriesUseCase;
  readonly #identityDocument: IdentityDocumentUseCase;
  readonly #verifyEmail: VerifyEmailUseCase;
  readonly #changePassword: ChangePasswordUseCase;
  readonly #sessions: SessionVerifierPort;

  constructor(
    @Inject(RegisterCustomerUseCase) register: RegisterCustomerUseCase,
    @Inject(CommandsUseCase) commands: CommandsUseCase,
    @Inject(QueriesUseCase) queries: QueriesUseCase,
    @Inject(IdentityDocumentUseCase) identityDocument: IdentityDocumentUseCase,
    @Inject(VerifyEmailUseCase) verifyEmail: VerifyEmailUseCase,
    @Inject(ChangePasswordUseCase) changePassword: ChangePasswordUseCase,
    @Inject(SESSION_VERIFIER) sessions: SessionVerifierPort,
  ) {
    this.#register = register;
    this.#commands = commands;
    this.#queries = queries;
    this.#identityDocument = identityDocument;
    this.#verifyEmail = verifyEmail;
    this.#changePassword = changePassword;
    this.#sessions = sessions;
  }

  /**
   * `C-01`'s "cambiar contraseña" — `200`, because the verdict is known by the
   * time the response is written.
   *
   * Not `@Roles`-guarded, and that is not an omission: the rule is narrower
   * than any role — **only the account's owner**, an administrator included —
   * and it is Customer Service that applies it, because the Gateway has no
   * customer table. A role decorator here would be a second, looser copy of an
   * authorization rule, which is the drift `navigation-parity` exists to catch.
   */
  @ApiOperation({
    summary: 'Cambia la contraseña de la propia cuenta',
    description:
      'Publica customer.change-password.v1 y espera el evento correlacionado. Requiere la ' +
      'contraseña actual: la sesión no basta. NADIE puede cambiar la de otra persona, ' +
      'administradores incluidos — para eso está la recuperación por correo.',
  })
  @ApiBearerAuth('session')
  @Post(':customerId/password')
  @HttpCode(200)
  public async changePassword(
    @Param('customerId') customerId: string,
    @Body(validated(ChangePasswordDto)) body: ChangePasswordDto,
    @Req() request: GatewayRequest,
  ): Promise<ChangedPassword> {
    return await this.#changePassword.execute({
      customerId,
      currentCredential: body.currentCredential,
      newCredential: body.newCredential,
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
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
    /**
     * Self-service registration is anonymous, but only for a `CLIENTE`.
     * Creating a `CAJERO_RECEPTOR` or an `ADMINISTRADOR` is "assign a role",
     * which decision D-06 grants to `ADMINISTRADOR` alone — and this route is
     * `@Public()`, so the global guard never checked the token. Without this,
     * an anonymous caller could mint themselves an administrator.
     *
     * The verdict is enforced here because the Gateway is the only component
     * that holds the session (ADR-010); Customer Service sees an envelope whose
     * identity is `null` for a public registration and cannot tell an anonymous
     * caller from an administrator.
     */
    if (body.role !== 'CLIENTE') {
      this.#requireAdministrator(request);
    }

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
      actor: this.#optionalActor(request),
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

  /**
   * The list of registered customers for staff. Declared before :customerId.
   */
  @ApiOperation({ summary: 'Lista de clientes registrados' })
  @ApiBearerAuth('session')
  @Roles('CAJERO_RECEPTOR', 'ADMINISTRADOR')
  @Get()
  public async list(
    @Query('limit') limitRaw: string | undefined,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw) || 50)) : 50;
    return await this.#queries.customerList(limit, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }

  /**
   * The customers awaiting an identity verdict — the teller's queue. Declared
   * before the parametric `:customerId` GET so this specific path keeps
   * precedence. Staff only, guarded here and re-checked by the owning service.
   */
  @ApiOperation({ summary: 'Clientes pendientes de validación de identidad' })
  @ApiBearerAuth('session')
  @Roles('CAJERO_RECEPTOR', 'ADMINISTRADOR')
  @Get('pending-validation')
  public async pendingValidation(
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    return await this.#queries.pendingValidation({
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }

  /**
   * A teller's manual verdict on an identity document.
   *
   * Staff only, guarded here and re-checked by Customer Service (the assignment's
   * "a cajero validates the document"). `202`: the verdict is applied
   * asynchronously and the identity event follows.
   */
  @ApiOperation({ summary: 'Veredicto de identidad del cajero' })
  @ApiBearerAuth('session')
  @Roles('CAJERO_RECEPTOR', 'ADMINISTRADOR')
  @Post(':customerId/identity-verdict')
  @HttpCode(202)
  public async setIdentityVerdict(
    @Param('customerId') customerId: string,
    @Body(validated(SetIdentityVerdictDto)) body: SetIdentityVerdictDto,
    @Req() request: GatewayRequest,
  ): Promise<{ readonly correlationId: string }> {
    if (!isUuidV4(customerId)) {
      throw GatewayError.validation('customerId debe ser un UUID v4', 'customerId');
    }

    return await this.#commands.setIdentityVerdict({
      customerId,
      verdict: body.verdict,
      actor: actorOf(request),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }

  /**
   * A teller's manual KYC verdict (Fase 2, §4.1 p. 4; T-31).
   *
   * Staff only, guarded here and re-checked by Customer Service. Distinct from
   * `setIdentityVerdict` above: that is Fase 1's document-photo review; this
   * is the broader compliance decision the transfer Saga's own KYC gate reads
   * before ordering a debit. `202`: the verdict is applied asynchronously and
   * the KYC event follows.
   */
  @ApiOperation({
    summary: 'Veredicto KYC del cajero',
    description:
      'Publica customer.set-kyc-status.v1. VERIFIED es terminal: un segundo veredicto sobre ' +
      'un cliente ya verificado no hace nada.',
  })
  @ApiBearerAuth('session')
  @Roles('CAJERO_RECEPTOR', 'ADMINISTRADOR')
  @Post(':customerId/kyc-status')
  @HttpCode(202)
  public async setKycStatus(
    @Param('customerId') customerId: string,
    @Body(validated(SetKycStatusDto)) body: SetKycStatusDto,
    @Req() request: GatewayRequest,
  ): Promise<{ readonly correlationId: string }> {
    if (!isUuidV4(customerId)) {
      throw GatewayError.validation('customerId debe ser un UUID v4', 'customerId');
    }

    return await this.#commands.setKycStatus({
      customerId,
      status: body.status,
      actor: actorOf(request),
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }

  /**
   * The identity-document photo itself — what a teller compares against the
   * declared data to give the verdict above. Staff only, guarded here and
   * re-checked by Customer Service, the same as the two routes above.
   *
   * `@Res()` because this answers with the image's own bytes and its own
   * `Content-Type`, not with the JSON envelope every other route returns —
   * a browser `<img>` needs the former. Thrown failures still reach
   * `GatewayExceptionFilter`: using the response object directly does not
   * remove a route from Nest's exception handling, only from its default
   * JSON serialisation of a return value.
   */
  @ApiOperation({
    summary: 'Foto del documento de identidad de un cliente',
    description:
      'Devuelve la imagen tal como la tiene guardada Customer Service, con su tipo de contenido. ' +
      'El Gateway no decide nada sobre la imagen; solo la sirve.',
  })
  @ApiBearerAuth('session')
  @ApiProduces('image/jpeg', 'image/png')
  @Roles('CAJERO_RECEPTOR', 'ADMINISTRADOR')
  @Get(':customerId/identity-document')
  public async identityDocument(
    @Param('customerId') customerId: string,
    @Req() request: GatewayRequest,
    @Res({ passthrough: false }) response: Response,
  ): Promise<void> {
    if (!isUuidV4(customerId)) {
      throw GatewayError.validation('customerId debe ser un UUID v4', 'customerId');
    }

    const document = await this.#identityDocument.fetch(customerId, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });

    response
      .status(200)
      .set('Content-Type', document.contentType)
      // Personal data: nothing in between — proxy, CDN or browser disk cache
      // — should keep a copy once this response leaves the process.
      .set('Cache-Control', 'private, no-store')
      .send(document.content);
  }

  /**
   * Read one customer's record.
   *
   * The owner check is Customer Service's, made from the envelope identity: a
   * CLIENTE may read only their own record, staff may read anyone, and a record
   * the caller may not see comes back as a business rejection, never a
   * distinguishable "forbidden". The gateway only routes and carries the answer.
   * Declared after `verify-email` and `pending-validation` so those specific GETs
   * keep their precedence over this parametric one.
   */
  @ApiOperation({ summary: 'Consulta un cliente por id' })
  @ApiBearerAuth('session')
  @Get(':customerId')
  public async get(
    @Param('customerId') customerId: string,
    @Req() request: GatewayRequest,
  ): Promise<Record<string, unknown>> {
    if (!isUuidV4(customerId)) {
      throw GatewayError.validation('customerId debe ser un UUID v4', 'customerId');
    }

    return await this.#queries.getCustomer(customerId, {
      actor: actorOf(request),
      correlationId: request.correlationId,
    });
  }

  /**
   * Refuses unless the caller presents a valid administrator session.
   *
   * `UNAUTHENTICATED` when the token is missing, forged or expired — the same
   * silence `JwtGuard` keeps, so a probe cannot tell which half of a guess was
   * right. `FORBIDDEN` when the token is valid but the role is not
   * `ADMINISTRADOR`: the caller is known and simply not allowed.
   */
  #requireAdministrator(request: GatewayRequest): void {
    const token = bearerTokenOf(request);

    if (token === undefined) {
      throw GatewayError.unauthenticated(
        'Crear personal (CAJERO_RECEPTOR o ADMINISTRADOR) requiere una sesión de administrador.',
      );
    }

    let role: string;
    try {
      role = this.#sessions.verify(token).role;
    } catch {
      throw GatewayError.unauthenticated();
    }

    if (role !== 'ADMINISTRADOR') {
      throw GatewayError.forbidden(
        'Solo un administrador puede asignar un rol distinto de CLIENTE.',
      );
    }
  }

  #optionalActor(request: GatewayRequest): Identity | null {
    const token = bearerTokenOf(request);
    if (token === undefined) {
      return null;
    }
    try {
      const verified = this.#sessions.verify(token);
      return { customerId: verified.customerId, role: verified.role };
    } catch {
      return null;
    }
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidV4(value: string): boolean {
  return UUID_V4.test(value);
}
