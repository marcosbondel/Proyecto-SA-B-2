import { decodeSession, isSessionExpired } from '../lib/session';
import type { Session } from '../lib/session';

export type { Session } from '../lib/session';

/**
 * Where the token is kept in the browser, and why it is `sessionStorage`.
 *
 * Not memory only: that signed you out on every full reload, which for a
 * banking interface reads as a bug, not a feature. Not `localStorage` either:
 * that survives closing the tab and the browser, lengthening the window a copy
 * taken from a shared machine stays usable — the exact risk ADR-010 named when
 * it chose not to persist, since this phase has no token revocation.
 *
 * `sessionStorage` is the middle ground that keeps ADR-010's guarantee: it
 * survives a reload but is cleared the moment the tab or window closes, so the
 * token lives exactly as long as the in-memory session already did — the tab's
 * lifetime — and no longer. A restored token is also refused once past its
 * `exp`, so a reload never revives a session the Gateway would reject anyway.
 */
const STORAGE_KEY = 'bank-session-token';

/**
 * The signed-in session.
 *
 * The claims are decoded **for display and routing only** — to greet someone by
 * name and pick which modules to show. Nothing here is a security decision: the
 * Gateway verifies the signature on every request and refuses regardless of what
 * this file believes.
 */
export function useSession() {
  const session = useState<Session | null>('bank-session', () => null);

  function start(token: string): Session | null {
    const claims = decodeSession(token);

    if (claims === null) {
      return null;
    }

    session.value = claims;
    persist(token);
    return claims;
  }

  function end(): void {
    session.value = null;
    forget();
  }

  /**
   * Rehydrates the session from `sessionStorage` on a fresh page load.
   *
   * Client-only, and it drops a token that is malformed or past its `exp`
   * rather than restore a session the next request would be refused for. Called
   * once, before routing, by `plugins/session.client.ts`.
   */
  function restore(): void {
    if (!import.meta.client || session.value !== null) {
      return;
    }

    const token = sessionStorage.getItem(STORAGE_KEY);

    if (token === null) {
      return;
    }

    const claims = decodeSession(token);

    if (claims === null || isSessionExpired(claims.expiresAt, Date.now())) {
      forget();
      return;
    }

    session.value = claims;
  }

  return {
    session,
    role: computed(() => session.value?.role ?? null),
    isSignedIn: computed(() => session.value !== null),
    start,
    end,
    restore,
  };
}

function persist(token: string): void {
  if (import.meta.client) {
    sessionStorage.setItem(STORAGE_KEY, token);
  }
}

function forget(): void {
  if (import.meta.client) {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}
