import { createHash, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { GatewayError } from '../../application/errors/gateway-error';
import type { GatewayRequest } from '../http-request';

export const INTERBANK_PARTNER_TOKEN = Symbol('InterbankPartnerToken');

@Injectable()
export class InterbankTokenGuard implements CanActivate {
  readonly expected: Buffer | null;

  constructor(@Inject(INTERBANK_PARTNER_TOKEN) token: string | null) {
    this.expected =
      token === null || token.length === 0 ? null : createHash('sha256').update(token).digest();
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GatewayRequest>();
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
    const actual =
      match === null
        ? null
        : createHash('sha256')
            .update(match[1] ?? '')
            .digest();
    if (this.expected === null || actual === null || !timingSafeEqual(this.expected, actual)) {
      throw GatewayError.unauthenticated('Credenciales interbancarias no válidas.');
    }
    return true;
  }
}
