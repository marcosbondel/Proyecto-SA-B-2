/**
 * The Customer, and the rules that make one valid.
 *
 * This file imports nothing. Not a framework, not `@bank/contracts`, not the
 * driver — the lint rules forbid it and the design agrees with them: these are
 * the rules the assignment fixes, and they must be readable and testable
 * without a database, a broker or an HTTP request in sight.
 *
 * The invariants carry the identifiers `docs/domain/entities.md` gave them, so
 * a failure here can be traced back to the decision that caused it.
 */

export type Role = 'CLIENTE' | 'CAJERO_RECEPTOR' | 'ADMINISTRADOR';
export type CustomerStatus = 'PENDING_ACTIVATION' | 'ACTIVE';
export type IdentityStatus = 'PENDING' | 'VALIDATED' | 'REJECTED';

/**
 * The two axes are **independent** (`docs/domain/entities.md`).
 *
 * `status` says whether this person may sign in; `identityStatus` says whether
 * a teller accepted their document photo. A customer may be `ACTIVE` with
 * `identityStatus = PENDING`, and the reverse. Collapsing them into one field
 * would make "can sign in" and "may hold accounts" the same question, and they
 * are not.
 */
export interface Customer {
  readonly customerId: string;
  readonly fullName: string;
  readonly identityDocument: string;
  readonly email: string;
  readonly dateOfBirth: string;
  readonly address: string;
  readonly username: string;
  readonly role: Role;
  readonly status: CustomerStatus;
  readonly identityStatus: IdentityStatus;
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Optimistic-concurrency counter. Carried unchanged by the domain — an
   * `applyChanges` result keeps the version it was read at, and the repository
   * bumps it under a `WHERE version = <read>` guard, so two concurrent updates
   * cannot silently overwrite each other (the "protección contra condiciones de
   * carrera" the assignment asks of this service). Mirrors Account.
   */
  readonly version: number;
}

/** The fields `customer.update.v1` may change, and no others (C-1, C-3, C-6). */
export interface CustomerChanges {
  readonly fullName?: string;
  readonly address?: string;
  readonly dateOfBirth?: string;
}

export const UPDATABLE_FIELDS = ['fullName', 'address', 'dateOfBirth'] as const;
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

/**
 * A refusal that names an invariant, using the catalogue's own failure codes.
 *
 * It is an error class rather than a returned union because every caller of a
 * domain rule must handle the refusal, and a union invites a caller to ignore
 * it by destructuring only the success. The codes themselves are safe to show a
 * person: none of them says whether an address exists.
 */
export type RejectionCode =
  | 'DOCUMENT_ALREADY_REGISTERED'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_BIRTH_DATE'
  | 'ROLE_NOT_ELIGIBLE'
  | 'ACTIVATION_TOKEN_INVALID'
  | 'ACTIVATION_TOKEN_EXPIRED'
  /* The password-recovery pair, kept distinct from the activation pair for the
   * reason the catalogue keeps them distinct: a dead activation link should
   * offer to resend the activation, a dead reset link should offer to start the
   * reset again. */
  | 'RESET_TOKEN_INVALID'
  | 'RESET_TOKEN_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'IDENTITY_DOCUMENT_UNREADABLE'
  | 'IDENTITY_OBJECT_NOT_FOUND'
  | 'IDENTITY_DIGEST_MISMATCH'
  | 'ILLEGAL_TRANSITION';

export class DomainRejection extends Error {
  public readonly code: RejectionCode;

  constructor(code: RejectionCode, message?: string) {
    super(message ?? code);
    this.name = 'DomainRejection';
    this.code = code;
  }
}

/** What a registration needs before a username or a hash is computed. */
export interface RegistrationRequest {
  readonly customerId: string;
  readonly fullName: string;
  readonly identityDocument: string;
  readonly email: string;
  readonly dateOfBirth: string;
  readonly address: string;
  readonly role: Role;
}

/**
 * A customer at the moment of registration.
 *
 * `PENDING_ACTIVATION` and `PENDING` are not defaults chosen for convenience:
 * C-4 ties `ACTIVE` to a verified email, and nobody has clicked the link yet;
 * the photo has not been read yet, so the identity is not `VALIDATED` either.
 *
 * @throws DomainRejection INVALID_BIRTH_DATE when C-5 refuses the date.
 */
export function registerCustomer(
  request: RegistrationRequest,
  username: string,
  now: Date,
): Customer {
  assertCoherentBirthDate(request.dateOfBirth, now);

  const timestamp = now.toISOString();

  return {
    customerId: request.customerId,
    fullName: request.fullName.trim(),
    identityDocument: request.identityDocument.trim(),
    email: normaliseEmail(request.email),
    dateOfBirth: request.dateOfBirth,
    address: request.address.trim(),
    username,
    role: request.role,
    status: 'PENDING_ACTIVATION',
    identityStatus: 'PENDING',
    emailVerifiedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 0,
  };
}

/**
 * Applies a partial update and reports what actually changed.
 *
 * A field set to the value it already had is **not** a change, and saying so
 * matters: `customer.updated.v1` carries the names of the changed fields, and
 * an event claiming a change that did not happen is a lie the audit record
 * keeps forever.
 *
 * The username is deliberately not recomputed when the name changes. It is an
 * identifier somebody signs in with and shares; regenerating it silently would
 * break every reference to it to satisfy a derivation rule that only ever
 * applied at creation.
 */
export function applyChanges(
  customer: Customer,
  changes: CustomerChanges,
  now: Date,
): { readonly customer: Customer; readonly changedFields: readonly UpdatableField[] } {
  if (changes.dateOfBirth !== undefined) {
    assertCoherentBirthDate(changes.dateOfBirth, now);
  }

  const changed: UpdatableField[] = [];
  const next = { ...customer } as Record<string, unknown>;

  for (const field of UPDATABLE_FIELDS) {
    const value = changes[field];

    if (value === undefined) {
      continue;
    }

    const normalised = field === 'dateOfBirth' ? value : value.trim();

    if (normalised !== customer[field]) {
      next[field] = normalised;
      changed.push(field);
    }
  }

  if (changed.length === 0) {
    return { customer, changedFields: [] };
  }

  next.updatedAt = now.toISOString();

  return { customer: next as unknown as Customer, changedFields: changed };
}

/**
 * The one legal transition of `status` (C-4).
 *
 * Verifying an already-verified account is refused rather than ignored: it can
 * only happen through a token that was already used, and treating that as
 * harmless would make a leaked link reusable forever.
 */
export function verifyEmail(customer: Customer, now: Date): Customer {
  if (customer.emailVerifiedAt !== null) {
    throw new DomainRejection('ACTIVATION_TOKEN_INVALID', 'the email was already verified');
  }

  const timestamp = now.toISOString();

  return { ...customer, status: 'ACTIVE', emailVerifiedAt: timestamp, updatedAt: timestamp };
}

/** Whether this account may sign in at all (C-4). */
export function canSignIn(customer: Customer): boolean {
  return customer.status === 'ACTIVE' && customer.emailVerifiedAt !== null;
}

/**
 * Records the verdict on the document photo.
 *
 * `REJECTED → PENDING` is legal — a new photo reopens the review — and
 * `VALIDATED` is terminal in Phase 1: re-validating an accepted identity would
 * let a second, different document silently replace an accepted one.
 */
export function recordIdentityVerdict(
  customer: Customer,
  verdict: 'VALIDATED' | 'REJECTED',
  now: Date,
): Customer {
  if (customer.identityStatus === 'VALIDATED') {
    throw new DomainRejection('ILLEGAL_TRANSITION', 'the identity was already validated');
  }

  return { ...customer, identityStatus: verdict, updatedAt: now.toISOString() };
}

/** Only `CLIENTE` holds accounts and therefore needs a validated identity (C-6). */
export function requiresIdentityValidation(customer: Pick<Customer, 'role'>): boolean {
  return customer.role === 'CLIENTE';
}

/** The verified actor a command carries, reduced to what a domain rule needs. */
export interface Actor {
  readonly role: Role;
  readonly customerId: string;
}

/**
 * Who may change a customer's data (D-06).
 *
 * A `CLIENTE` may update only their own record — "own only" in the decision;
 * staff (`CAJERO_RECEPTOR`, `ADMINISTRADOR`) may update anyone. A command that
 * reached the broker with **no** verified actor may update nobody.
 *
 * The check lives here, not only at the Gateway, because a permission enforced
 * only at the edge holds until a second producer appears — the same reason
 * Account re-checks its own status change. The Gateway has no customer table and
 * cannot answer "is this the owner", so the owning service must.
 */
export function mayUpdateCustomer(actor: Actor | null, subjectCustomerId: string): boolean {
  if (actor === null) {
    return false;
  }

  if (actor.role === 'CLIENTE') {
    return actor.customerId === subjectCustomerId;
  }

  return true;
}

/**
 * Who may read a customer's record (D-06, same scope as updating it).
 *
 * A `CLIENTE` may read only their own record; staff may read anyone. Reused by
 * the query path so the update form and the validation detail can show real
 * data without letting a client read a stranger's. An unauthorised read is
 * answered `NOT_FOUND`, not "forbidden", so it cannot enumerate ids.
 */
export function mayReadCustomer(actor: Actor | null, subjectCustomerId: string): boolean {
  return mayUpdateCustomer(actor, subjectCustomerId);
}

/**
 * Who may change a password from inside a session: **the account's owner, and
 * nobody else** — an administrator included.
 *
 * This is deliberately stricter than `mayUpdateCustomer`, which lets staff edit
 * a customer's name or address. Editing a record is something a teller does for
 * somebody standing in front of them; replacing a credential is taking the
 * account. Staff who need to help somebody locked out have the recovery flow,
 * and its link goes to the customer's own inbox, which is the whole point.
 */
export function mayChangeOwnPassword(actor: Actor | null, subjectCustomerId: string): boolean {
  return actor !== null && actor.customerId === subjectCustomerId;
}

/**
 * Who may give a manual verdict on an identity document, and who may see the
 * queue of documents awaiting one: staff only (`CAJERO_RECEPTOR` or
 * `ADMINISTRADOR`). A `CLIENTE` reviews nobody's identity, their own included —
 * the automatic photo check at submission is the only thing a client triggers.
 */
export function mayValidateIdentity(actor: Actor | null): boolean {
  return actor !== null && actor.role !== 'CLIENTE';
}

/**
 * Which role a registration may ask for, given who is asking (D-06).
 *
 * Anyone — including the anonymous public form — may create a `CLIENTE`. Only an
 * `ADMINISTRADOR` may create staff (`CAJERO_RECEPTOR`, `ADMINISTRADOR`). The
 * Gateway already refuses an elevated role from a public request, but this
 * service repeats the check because the command could arrive from a second
 * producer on the broker with no actor at all; trusting the edge would let one
 * mint an administrator.
 */
export function mayRegisterWithRole(actor: Actor | null, requestedRole: Role): boolean {
  if (requestedRole === 'CLIENTE') {
    return true;
  }

  return actor?.role === 'ADMINISTRADOR';
}

/** The oldest person on record was 122. A century and a quarter is generous. */
export const MAX_AGE_YEARS = 125;
export const MIN_AGE_YEARS = 18;

/**
 * C-5: the date must be a real one, in the past, and plausible for a living
 * adult.
 *
 * The calendar check is not pedantry. `new Date('2026-02-31')` is the 3rd of
 * March in JavaScript, so a service that trusts the parser stores a date its
 * customer never gave it.
 */
export function assertCoherentBirthDate(dateOfBirth: string, now: Date): void {
  const parsed = parseCalendarDate(dateOfBirth);

  if (parsed === null) {
    throw new DomainRejection('INVALID_BIRTH_DATE', 'not a real calendar date');
  }

  if (parsed.getTime() > now.getTime()) {
    throw new DomainRejection('INVALID_BIRTH_DATE', 'in the future');
  }

  const age = yearsBetween(parsed, now);

  if (age < MIN_AGE_YEARS) {
    throw new DomainRejection('INVALID_BIRTH_DATE', 'under the minimum age');
  }

  if (age > MAX_AGE_YEARS) {
    throw new DomainRejection('INVALID_BIRTH_DATE', 'implausible for a living person');
  }
}

/** Whole years, counted the way a person counts them. */
export function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const months = to.getUTCMonth() - from.getUTCMonth();

  if (months < 0 || (months === 0 && to.getUTCDate() < from.getUTCDate())) {
    years -= 1;
  }

  return years;
}

/** Lower-cased, because C-3's uniqueness is not case-sensitive to a person. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `YYYY-MM-DD` as a real UTC date, or `null` when the calendar refuses it. */
function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match === null) {
    return null;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  const isReal =
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day);

  return isReal ? parsed : null;
}
