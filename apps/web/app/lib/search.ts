import type { Role } from './navigation.ts';
import { canOpen } from './navigation.ts';

/**
 * The header's "go to" box.
 *
 * The prototype draws a search field reading "Buscar cuenta, cliente,
 * transactionId…". This system has no search: no service indexes text, and a
 * box that guesses which of four things a UUID names would send somebody to the
 * wrong screen most of the time — every identifier in the bank is a UUID v4, so
 * the value itself says nothing about what it identifies.
 *
 * So this resolves nothing and **offers** instead. Type an identifier and the
 * box lists the screens that identifier could open, filtered to the ones this
 * role may actually reach; the person picks. That is an honest reading of the
 * affordance the prototype drew, it needs no backend, and — because it is a
 * pure function over a string — it is testable despite TD-010.
 */
export interface SearchDestination {
  /** What the visitor would be opening. */
  readonly label: string;
  readonly to: string;
}

/** Every identifier this system hands out is a UUID v4. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Whether the text is an identifier this system could have issued. */
export function isIdentifier(query: string): boolean {
  return UUID_V4.test(query.trim());
}

/**
 * The screens `query` could open, for this role.
 *
 * Empty when the text is not an identifier — which is most of the time, and is
 * why the box says so rather than showing "sin resultados" for something it was
 * never going to find.
 */
export function searchDestinations(query: string, role: Role | null): readonly SearchDestination[] {
  const identifier = query.trim();

  if (!isIdentifier(identifier)) {
    return [];
  }

  const candidates: readonly SearchDestination[] = [
    { label: 'Cuenta', to: `/cuentas/${identifier}` },
    { label: 'Cliente', to: `/clientes/${identifier}` },
    { label: 'Transferencia', to: `/transferencias/${identifier}` },
    { label: 'Pago', to: `/pagos/${identifier}` },
  ];

  // Offering a destination the Gateway will refuse is the same discourtesy as
  // showing a module a role cannot open, so the same matrix filters both.
  return candidates.filter((candidate) => canOpen(role, candidate.to));
}
