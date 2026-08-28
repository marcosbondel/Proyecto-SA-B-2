import type { Role } from './navigation';

/**
 * The session, and the two decisions about it that must be verifiable.
 *
 * Reading the claims out of a token and deciding whether it is still usable are
 * the frontend's only auth-adjacent logic, so they live here as pure functions
 * — testable in `test/session.test.mjs` rather than hidden in a composable that
 * TD-010 leaves unverifiable. Neither is a security decision: the Gateway holds
 * the signing key and refuses on its own, whatever this file believes. These
 * exist to greet someone by name, pick their modules, and avoid restoring a
 * session the Gateway would only reject.
 */
export interface Session {
  readonly token: string;
  readonly customerId: string;
  readonly username: string;
  readonly role: Role;
  /** Epoch seconds. Read to show the session ending and to refuse a stale one. */
  readonly expiresAt: number;
}

interface TokenClaims {
  readonly sub?: unknown;
  readonly username?: unknown;
  readonly role?: unknown;
  readonly exp?: unknown;
}

const ROLES = new Set<Role>(['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR']);

/**
 * Reads the claims out of a JWT without verifying anything.
 *
 * Verification happens in the Gateway, the only holder of the secret. Attempting
 * it here would be theatre: a browser cannot keep a signing key, so any check it
 * performed could be bypassed by editing the same code. Returns `null` for a
 * token whose shape or role it cannot trust, so a malformed value never becomes
 * a session.
 */
export function decodeSession(token: string): Session | null {
  const payload = token.split('.')[1];

  if (payload === undefined) {
    return null;
  }

  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as TokenClaims;

    if (
      typeof json.sub !== 'string' ||
      typeof json.username !== 'string' ||
      typeof json.role !== 'string' ||
      !ROLES.has(json.role as Role)
    ) {
      return null;
    }

    return {
      token,
      customerId: json.sub,
      username: json.username,
      role: json.role as Role,
      expiresAt: typeof json.exp === 'number' ? json.exp : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Whether a restored session is past its expiry and must not be used.
 *
 * `expiresAtSeconds` is the JWT `exp`, in seconds; `nowMs` is the caller's clock
 * in milliseconds, injected so this stays pure and testable. A token with no
 * `exp` (`0`) is treated as expired: a session we cannot date is one we will not
 * silently restore, and a fresh sign-in is one click away.
 */
export function isSessionExpired(expiresAtSeconds: number, nowMs: number): boolean {
  if (expiresAtSeconds <= 0) {
    return true;
  }

  return expiresAtSeconds * 1000 <= nowMs;
}
