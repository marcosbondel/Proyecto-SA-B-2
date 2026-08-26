import type { Identity } from '@bank/contracts';

import { GatewayError } from '../application/errors/gateway-error';
import type { GatewayRequest } from './http-request';

/**
 * The verified actor, or a refusal.
 *
 * On a protected route `JwtGuard` has already run and this always succeeds. The
 * throw is here so that a route accidentally left unguarded fails loudly
 * instead of publishing a message with `identity: null` — which every service
 * downstream would read as "nobody originated this", and act on.
 */
export function actorOf(request: GatewayRequest): Identity {
  const actor = request.actor;

  if (actor === undefined) {
    throw GatewayError.unauthenticated('Falta el token de sesión.');
  }

  return { customerId: actor.customerId, role: actor.role };
}
