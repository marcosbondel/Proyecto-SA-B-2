import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';

import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { LoginUseCase } from '../application/routes/login.use-case';
import type { LoginResult } from '../application/routes/login.use-case';
import { PasswordResetUseCase } from '../application/routes/password-reset.use-case';
import type { AcceptedReset, CompletedReset } from '../application/routes/password-reset.use-case';
import { LoginDto } from './dto/login.dto';
import { ConfirmPasswordResetDto, RequestPasswordResetDto } from './dto/password-reset.dto';
import { validated } from './validation';
import { Public } from './guards/route-access.decorator';
import type { GatewayRequest } from './http-request';

/**
 * The only route that hands out a session.
 *
 * It is public because it has to be, and it is the most attacked surface in the
 * system for the same reason. Two rules follow, and both are enforced by tests
 * rather than by care: the credential never reaches a log, and every failure
 * looks identical.
 */
@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  readonly #login: LoginUseCase;
  readonly #passwordReset: PasswordResetUseCase;

  constructor(
    @Inject(LoginUseCase) login: LoginUseCase,
    @Inject(PasswordResetUseCase) passwordReset: PasswordResetUseCase,
  ) {
    this.#login = login;
    this.#passwordReset = passwordReset;
  }

  /**
   * `200`, not `202`: this is one of the few operations whose answer is known
   * by the time the response is written. There is nothing to poll for.
   */
  @ApiOperation({
    summary: 'Inicia sesión y devuelve un JWT',
    description:
      'Publica customer.authenticate.v1 y espera su respuesta. Credenciales inválidas, ' +
      'correo no registrado y cuenta sin activar producen el MISMO rechazo 401.',
  })
  @Public()
  @Post('login')
  @HttpCode(200)
  public async login(
    @Body(validated(LoginDto)) body: LoginDto,
    @Req() request: GatewayRequest,
  ): Promise<LoginResult> {
    return await this.#login.execute({
      email: body.email,
      credential: body.credential,
      correlationId: request.correlationId,
    });
  }
  /**
   * `202` for every address, known or not.
   *
   * This is the one route whose *uselessness* as an oracle is the feature. A
   * `404` for an unknown address — or even a measurably faster answer — would
   * let anyone with a word list find out who banks here. Customer Service
   * publishes nothing for an address it does not know, so there is no event to
   * correlate and nothing this route could accidentally reveal.
   */
  @ApiOperation({
    summary: 'Solicita un enlace para restablecer la contraseña',
    description:
      'Publica customer.password-reset.requested.v1 y devuelve 202 SIEMPRE, exista o no ' +
      'la dirección. Responder distinto revelaría qué correos están registrados.',
  })
  @Public()
  @Post('password-reset')
  @HttpCode(202)
  public async requestPasswordReset(
    @Body(validated(RequestPasswordResetDto)) body: RequestPasswordResetDto,
    @Req() request: GatewayRequest,
  ): Promise<AcceptedReset> {
    return await this.#passwordReset.request({
      email: body.email,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }

  /**
   * `200`: the verdict is known by the time the response is written, the same
   * way the activation link's is. The three ways a link can fail — invented,
   * already spent, expired — produce one identical rejection.
   */
  @ApiOperation({
    summary: 'Restablece la contraseña con el enlace del correo',
    description:
      'Publica customer.password-reset.confirm.v1 y espera el evento correlacionado hasta ' +
      'cinco segundos. Enlace inválido, ya usado y vencido producen el MISMO rechazo.',
  })
  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  public async confirmPasswordReset(
    @Body(validated(ConfirmPasswordResetDto)) body: ConfirmPasswordResetDto,
    @Req() request: GatewayRequest,
  ): Promise<CompletedReset> {
    return await this.#passwordReset.confirm({
      resetToken: body.resetToken,
      credential: body.credential,
      correlationId: request.correlationId,
    });
  }
}
