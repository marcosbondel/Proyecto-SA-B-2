import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@bank/contracts';

import type { GatewayRequest } from '../http-request';

import { GatewayError } from '../../application/errors/gateway-error';
import { ALLOWED_ROLES, PUBLIC_ROUTE } from './route-access.decorator';

/**
 * The authorization boundary: does this role get to call this route at all?
 *
 * That question, and only that question. **Whether this actor may act on this
 * subject** — someone else's account, someone else's customer record — is not
 * asked here and cannot be: the gateway has no database and does not know who
 * owns what. Decision D-06 restricts most use cases by *scope* ("own accounts",
 * "own only"), and scope belongs to the service that owns the data, which
 * refuses with a named failure code.
 *
 * Splitting it that way is not a gap. It is the only division available when
 * the entry point holds no data, and pretending otherwise would mean giving the
 * gateway a database — which is how it stops being a gateway.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  readonly #reflector: Reflector;

  constructor(@Inject(Reflector) reflector: Reflector) {
    this.#reflector = reflector;
  }

  public canActivate(context: ExecutionContext): boolean {
    const isPublic = this.#reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const allowed = this.#reflector.getAllAndOverride<readonly Role[]>(ALLOWED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);

    // A protected route that names no roles admits any authenticated actor.
    // That is deliberate and matches D-06, where only the audit record is
    // restricted by role; everything else is restricted by scope, downstream.
    if (allowed === undefined || allowed.length === 0) {
      return true;
    }

    const actor = context.switchToHttp().getRequest<GatewayRequest>().actor;

    if (actor === undefined) {
      // Only reachable if this guard ran without the authentication guard.
      throw GatewayError.unauthenticated('Falta el token de sesión.');
    }

    if (!allowed.includes(actor.role)) {
      // A different outcome from `401`, on purpose: "we do not know who you
      // are" and "we know, and no" are different facts and the caller must be
      // able to tell them apart.
      throw GatewayError.forbidden();
    }

    return true;
  }
}
