import type { Identity } from '@bank/contracts';
import type { Request } from 'express';

/**
 * An HTTP request after the gateway has annotated it.
 *
 * An explicit type rather than a global augmentation of Express's `Request`.
 * Under pnpm's strict layout the augmentation has to find the same copy of
 * `express-serve-static-core` that Express itself resolved, and when it does
 * not the failure is a type error in an unrelated file — a bad trade for the
 * convenience of not naming a type.
 *
 * Naming it also makes the provenance of each field readable at the call site:
 * these three come from the gateway, everything else came from the caller.
 */
export interface GatewayRequest extends Request {
  /** Set by CorrelationMiddleware on every route, including the probes. */
  correlationId: string;

  /** Set by CorrelationMiddleware. Carried to the envelope, never read here. */
  idempotencyKey: string;

  /**
   * Set by JwtGuard from the verified token, and by nothing else.
   *
   * Absent on a public route. Never taken from the request body — a body is
   * the caller's claim about themselves, not a fact about them.
   */
  actor?: Identity & { readonly username: string };
}
