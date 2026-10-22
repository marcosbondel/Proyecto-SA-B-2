import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Identity } from '@bank/contracts';

import type { GatewayRequest } from '../http-request';

import { GatewayError } from '../../application/errors/gateway-error';
import { PUBLIC_ROUTE } from './route-access.decorator';

/**
 * Verifies a session token. Kept as an interface so this layer never sees an
 * adapter — `pnpm lint` enforces that, and it is also why the guard is
 * testable without a signing secret.
 */
export interface SessionVerifierPort {
  verify(token: string): Identity & { readonly username: string };
}

export const SESSION_VERIFIER = Symbol('SessionVerifierPort');

/**
 * The authentication boundary. Registered globally, so a route is protected
 * unless it says otherwise.
 *
 * **Nothing is published when this rejects.** The guard runs before any handler
 * body, which is what makes that structural rather than a promise: there is no
 * code path from here to the broker.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  readonly #reflector: Reflector;
  readonly #verifier: SessionVerifierPort;

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(SESSION_VERIFIER) verifier: SessionVerifierPort,
  ) {
    this.#reflector = reflector;
    this.#verifier = verifier;
  }

  public canActivate(context: ExecutionContext): boolean {
    const isPublic = this.#reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<GatewayRequest>();
    const token = bearerTokenOf(request);

    if (token === undefined) {
      throw GatewayError.unauthenticated('Falta el token de sesión.');
    }

    // Throws `UNAUTHENTICATED` for a missing, forged or expired token, without
    // saying which. Telling an attacker which half of their guess was right is
    // free help.
    request.actor = this.#verifier.verify(token);

    return true;
  }
}

/**
 * The bearer token out of `Authorization`, or `undefined` when the header is
 * absent or not shaped as one.
 *
 * Exported because `#requireAdministrator` in `CustomersController` needs the
 * same parse: registration is `@Public()`, so this guard never runs for it,
 * and that route still has to know whether the caller is an administrator
 * before it lets them mint one. Two copies of this parsing at the point that
 * decides who may create staff was the risk; one function called from both
 * places is not.
 */
export function bearerTokenOf(request: GatewayRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }

  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value !== undefined && value.length > 0
    ? value
    : undefined;
}
