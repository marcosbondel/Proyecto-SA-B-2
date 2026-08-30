/** The three actors the assignment defines (§4.1 NOTE, p. 7). */
export type Role = 'CLIENTE' | 'CAJERO_RECEPTOR' | 'ADMINISTRADOR';

export interface ModuleEntry {
  readonly label: string;
  readonly to: string;
  /** Which roles may see it. Derived from decision D-06. */
  readonly roles: readonly Role[];
}

const EVERY_ROLE: readonly Role[] = ['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR'];

/**
 * The five modules, and who sees each one.
 *
 * Plain data in a plain module, not a computed property inside a `.vue` file.
 * The frontend has no component-test framework (TD-010), so anything that lives
 * in a template is unverifiable; anything that lives here is a function anyone
 * can assert on. The permission matrix is too important to be the second kind.
 *
 * Two are restricted, and the two are restricted for different reasons.
 *
 * **Auditoría** is the one D-06 restricts by role outright. Everything else in
 * that decision is restricted by **scope** — "own accounts", "own only" —
 * which neither this file nor the Gateway can evaluate, because neither knows
 * who owns what. The owning service refuses those with a named failure code.
 *
 * **Pagos** is restricted because its owning service cannot do that. Every
 * other listing narrows itself to what the asker owns; Payment Service holds a
 * `transactionId` and no customer reference, and resolving one to the other
 * means reading another service's tables (§8.2, 2.3). So the unscoped list is
 * staff work and the Gateway says so with `@Roles`, while a `CLIENTE` sees
 * their payment where it is already scoped — inside the transfer that created
 * it. Added by T-19 and recorded as TD-037.
 */
export const MODULES: readonly ModuleEntry[] = [
  /**
   * The landing page, first in the rail the way the prototype's three role
   * navigations all open with "Inicio". It is safe as a `to` of `/` only
   * because `canOpen` matches a module by exact path or by a `to` followed by a
   * slash: `/cuentas` is not `/` and does not start with `//`, so this entry
   * claims the root and nothing else.
   */
  { label: 'Inicio', to: '/', roles: EVERY_ROLE },
  { label: 'Clientes', to: '/clientes', roles: EVERY_ROLE },
  { label: 'Cuentas', to: '/cuentas', roles: EVERY_ROLE },
  { label: 'Transferencias', to: '/transferencias', roles: EVERY_ROLE },
  { label: 'Pagos', to: '/pagos', roles: ['CAJERO_RECEPTOR', 'ADMINISTRADOR'] },
  { label: 'Auditoría', to: '/auditoria', roles: ['ADMINISTRADOR'] },
];

/**
 * Routes reachable with no session at all.
 *
 * `/recuperar` and `/restablecer` join the three T-15 fixed, and neither is
 * guest-only. `/restablecer` for the reason `/activar` is not: it arrives by
 * email and may well be opened in a browser where somebody else is signed in,
 * and the token in the link decides, not the session. `/recuperar` because
 * being unable to sign in and having a stale session open in a tab are not
 * mutually exclusive — bouncing that person to the landing page would leave
 * them with no way to ask for a new password at all.
 */
export const PUBLIC_ROUTES: readonly string[] = [
  '/login',
  '/registro',
  '/activar',
  '/recuperar',
  '/restablecer',
];

/**
 * The public routes that stop making sense once a session exists.
 *
 * Signing in and registering are for the anonymous; showing either form to a
 * signed-in visitor invites a second session on top of the first. `/activar` is
 * deliberately **not** here: an activation link arrives by email and may well
 * be opened in a browser where somebody else — a teller, say — is signed in,
 * and the activation belongs to the token in the link, not to the session.
 */
export const GUEST_ONLY_ROUTES: readonly string[] = ['/login', '/registro'];

/** Whether this path is one of the guest-only ones. */
export function isGuestOnly(path: string): boolean {
  return GUEST_ONLY_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
}

/**
 * Where to go after signing in, given the untrusted `next` query value.
 *
 * The value rides in the address bar, so anyone can put anything there. Only a
 * same-application path is honoured: no absolute URLs, no protocol-relative
 * `//host` (which browsers read as "same scheme, that host"), no backslash
 * variants of the same trick. A guest-only destination is discarded too —
 * arriving signed in at `/login` would just bounce off the middleware.
 * Everything suspicious collapses to the landing page rather than to an error:
 * the sign-in itself succeeded.
 */
export function resolveNextPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/';
  }

  const path = raw.split(/[?#]/, 1)[0] ?? raw;

  return isGuestOnly(path) ? '/' : raw;
}

/** What this role should see in the navigation. */
export function modulesFor(role: Role | null): readonly ModuleEntry[] {
  if (role === null) {
    return [];
  }

  return MODULES.filter((module) => module.roles.includes(role));
}

/**
 * Whether this role may open this path.
 *
 * **This is convenience, not defence.** It exists so the interface does not
 * offer a button that will fail. The prohibition is the Gateway's, and the
 * Gateway applies it whether or not this function was ever called — which is
 * why the test that proves it calls the API directly, without a browser.
 */
export function canOpen(role: Role | null, path: string): boolean {
  if (PUBLIC_ROUTES.some((route) => path === route || path.startsWith(`${route}/`))) {
    return true;
  }

  if (role === null) {
    return false;
  }

  const module = MODULES.find((entry) => path === entry.to || path.startsWith(`${entry.to}/`));

  // A path that matches no module — the root, say — is left to the router.
  return module === undefined ? true : module.roles.includes(role);
}

/**
 * The one or two letters the header's avatar carries.
 *
 * The session holds a `username`, generated by Customer Service from the
 * person's name (§4.1), so it is the only name this interface has. A username
 * with no separators yields one letter rather than an arbitrary slice: "JC" cut
 * out of "jcmendez" would be a guess at where the given name ends.
 */
export function initialsOf(username: string | null | undefined): string {
  const parts = (username ?? '')
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return '·';
  }

  const letters = parts.length === 1 ? [parts[0]] : [parts[0], parts[1]];

  return letters
    .map((part) => (part ?? '').charAt(0).toUpperCase())
    .join('');
}

/** How a role is written for a person to read. */
export function labelForRole(role: Role): string {
  return {
    CLIENTE: 'Cliente',
    CAJERO_RECEPTOR: 'Cajero receptor',
    ADMINISTRADOR: 'Administrador',
  }[role];
}
