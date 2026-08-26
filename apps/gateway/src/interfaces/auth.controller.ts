import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';

import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { LoginUseCase } from '../application/routes/login.use-case';
import type { LoginResult } from '../application/routes/login.use-case';
import { LoginDto } from './dto/login.dto';
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

  constructor(@Inject(LoginUseCase) login: LoginUseCase) {
    this.#login = login;
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
}
