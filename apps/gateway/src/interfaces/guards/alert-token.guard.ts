import { createHash, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { GatewayError } from '../../application/errors/gateway-error';
import type { GatewayRequest } from '../http-request';

/** The shared secret Grafana presents, or `null` when none is configured. */
export const ALERT_WEBHOOK_TOKEN = Symbol('AlertWebhookToken');

/**
 * The authentication of the SLO webhook (T-45).
 *
 * Grafana is not a user: it has no session, no JWT and no role, so the route is
 * `@Public()` to the session guards and *this* guard is the only thing standing
 * in front of it. It checks a bearer token that both sides know — the Gateway
 * reads it from `ALERT_WEBHOOK_TOKEN`, which is a Kubernetes Secret in the
 * cluster, and Grafana sends it as the contact point's `Authorization`
 * credentials.
 *
 * **It fails closed.** With no token configured, every call is refused: a
 * webhook that is open until somebody remembers to set a secret is an open
 * webhook, and the entry that lets anybody write to the audit trail and page the
 * operators is not one to ship unlocked. The refusal does not say which half was
 * wrong, like the session guard.
 *
 * **The comparison is constant-time.** Both sides are hashed first so that
 * `timingSafeEqual` always compares equal-length buffers, and a caller cannot
 * learn how many leading characters of the secret were right from how long the
 * answer took.
 */
@Injectable()
export class AlertTokenGuard implements CanActivate {
  readonly #expected: Buffer | null;

  constructor(@Inject(ALERT_WEBHOOK_TOKEN) token: string | null) {
    this.#expected = token === null || token.length === 0 ? null : digest(token);
  }

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GatewayRequest>();
    const presented = bearerOf(request.headers.authorization);

    if (
      this.#expected === null ||
      presented === undefined ||
      !timingSafeEqual(this.#expected, digest(presented))
    ) {
      throw GatewayError.unauthenticated('Credenciales del webhook no válidas.');
    }

    return true;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function bearerOf(header: string | undefined): string | undefined {
  const match = header === undefined ? null : /^Bearer\s+(\S+)$/i.exec(header);

  return match?.[1];
}
