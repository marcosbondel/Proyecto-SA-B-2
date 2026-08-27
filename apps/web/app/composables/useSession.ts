import type { Role } from '../lib/navigation';

export interface Session {
  readonly token: string;
  readonly customerId: string;
  readonly username: string;
  readonly role: Role;
  /** Epoch seconds. Read to show the session ending, never trusted for auth. */
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
 * The signed-in session, held in memory only.
 *
 * **Not `localStorage`, deliberately.** There is no revocation in this phase
 * (ADR-010), so a token is valid until it expires and nothing can call it back.
 * Writing it to disk would only lengthen the window during which a copy taken
 * from a shared machine still works. The cost is real and worth stating: a full
 * page reload signs you out. Given a one-hour lifetime and no refresh, the
 * session was going to end soon anyway.
 *
 * The claims are decoded **for display only** — to greet someone by name and to
 * pick which modules to show. Nothing here is a security decision: the Gateway
 * verifies the signature on every request and refuses regardless of what this
 * file believes.
 */
export function useSession() {
  const session = useState<Session | null>('bank-session', () => null);

  function start(token: string): Session | null {
    const claims = decode(token);

    if (claims === null) {
      return null;
    }

    session.value = claims;
    return claims;
  }

  function end(): void {
    session.value = null;
  }

  return {
    session,
    role: computed(() => session.value?.role ?? null),
    isSignedIn: computed(() => session.value !== null),
    start,
    end,
  };
}

/**
 * Reads the claims out of a JWT without verifying anything.
 *
 * Verification happens in the Gateway, which is the only holder of the secret.
 * Attempting it here would be theatre: a browser cannot keep a signing key, so
 * any check it performed could be bypassed by editing the same code.
 */
function decode(token: string): Session | null {
  const payload = token.split('.')[1];

  if (payload === undefined) {
    return null;
  }

  try {
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as TokenClaims;

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
