import type { Role } from '@bank/contracts';

/** What Customer Service decided about who this is. Never invented here. */
export interface SessionClaims {
  readonly customerId: string;
  readonly username: string;
  readonly role: Role;
}

/**
 * Mints a session token over claims another service reached.
 *
 * A port, so the application layer never learns what HS256 is. It also keeps
 * the honest statement visible in the type: the gateway signs *claims*, it does
 * not decide them. Deciding whether a credential was valid is Customer
 * Service's job, and packaging that verdict is what makes this authentication
 * rather than a domain decision (ADR-010, constitution V).
 */
export interface SessionSignerPort {
  sign(claims: SessionClaims): string;
  readonly expiresInSeconds: number;
}

export const SESSION_SIGNER = Symbol('SessionSignerPort');
