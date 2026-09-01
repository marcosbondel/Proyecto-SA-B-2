import { SetMetadata } from '@nestjs/common';
import type { Role } from '@bank/contracts';

export const PUBLIC_ROUTE = 'bank:public-route';
export const ALLOWED_ROLES = 'bank:allowed-roles';

/**
 * Marks a route reachable without a token.
 *
 * Public is declared, never inferred. The default has to be "protected",
 * because the failure modes are not symmetric: forgetting to mark a public
 * route breaks it loudly the first time anyone tries, while forgetting to
 * protect a private one breaks nothing visible and everything that matters.
 *
 * There are exactly seven: sign in, register, verify an email, the two
 * password-recovery endpoints, and the two probes (FR-014).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

/**
 * Names the roles a route admits, straight from decision D-06.
 *
 * The list is metadata rather than a condition inside the handler so that one
 * declaration serves both the guard and the OpenAPI document. Two copies of an
 * authorization rule is one copy too many: they drift, and the document ends up
 * describing a system that no longer exists.
 */
export const Roles = (...roles: readonly Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOWED_ROLES, roles);
