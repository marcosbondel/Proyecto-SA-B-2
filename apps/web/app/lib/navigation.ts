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
 * The four modules, and who sees each one.
 *
 * Plain data in a plain module, not a computed property inside a `.vue` file.
 * The frontend has no component-test framework (TD-010), so anything that lives
 * in a template is unverifiable; anything that lives here is a function anyone
 * can assert on. The permission matrix is too important to be the second kind.
 *
 * Only Auditoría is restricted, and that is not an oversight: D-06 restricts
 * almost everything else by **scope** — "own accounts", "own only" — which
 * neither this file nor the Gateway can evaluate, because neither knows who
 * owns what. The owning service refuses those with a named failure code.
 */
export const MODULES: readonly ModuleEntry[] = [
  { label: 'Clientes', to: '/clientes', roles: EVERY_ROLE },
  { label: 'Cuentas', to: '/cuentas', roles: EVERY_ROLE },
  { label: 'Transferencias', to: '/transferencias', roles: EVERY_ROLE },
  { label: 'Auditoría', to: '/auditoria', roles: ['ADMINISTRADOR'] },
];

/** Routes reachable with no session at all. */
export const PUBLIC_ROUTES: readonly string[] = ['/login', '/registro', '/activar', '/demo'];

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

/** How a role is written for a person to read. */
export function labelForRole(role: Role): string {
  return {
    CLIENTE: 'Cliente',
    CAJERO_RECEPTOR: 'Cajero receptor',
    ADMINISTRADOR: 'Administrador',
  }[role];
}
