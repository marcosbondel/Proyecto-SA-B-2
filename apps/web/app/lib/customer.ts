/**
 * Everything the Clientes module *decides*, as plain functions.
 *
 * The frontend has no component-test framework (TD-010), so a rule written
 * inside a `.vue` file is a rule nobody can assert on. This module exists so
 * that the parts of registration that can be wrong — a username derived from an
 * accented name, an age computed across a birthday, a photo one byte over the
 * limit — are verifiable without a browser, exactly as `navigation.ts` does for
 * the permission matrix.
 *
 * Nothing here talks to the Gateway. The bounds duplicate `RegisterCustomerDto`
 * on purpose: catching a short password before the request is sent is the
 * difference between a message next to the field and a `400` the person has to
 * interpret.
 */

/** Mirrors `MAX_PHOTO_BYTES` in `@bank/contracts`, which `apps/web` does not depend on. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** What the Gateway deposits in object storage; anything else is refused there too. */
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;

/** The team's policy for a bank account holder, stated once so it can be argued with. */
export const MIN_AGE_YEARS = 18;
export const MAX_AGE_YEARS = 120;

/** `customers.username` is `VARCHAR(60)`. */
const MAX_USERNAME_LENGTH = 60;

/**
 * The username a full name produces, for showing before it exists.
 *
 * The rule is the prototype's — initial of the first given name plus the first
 * surname, `María Fernanda López García` → `mlopez` — and the accents go
 * because a username that cannot be typed on an English keyboard is a support
 * ticket waiting to happen.
 *
 * **This is a preview, not the answer.** Customer Service owns the column and
 * resolves collisions with a suffix, so the value shown here can differ from
 * the one that ends up stored. Every screen that shows it says so; a screen
 * that presented it as final would be lying on the one field a person is about
 * to memorise.
 */
export function usernameFrom(fullName: string): string {
  const words = wordsOf(fullName);

  if (words.length === 0) {
    return '';
  }

  const [first] = words;
  // Two words are a name and a surname; three or more put the surname third,
  // because `María Fernanda López` is one person with two given names far more
  // often than it is somebody whose surname is Fernanda.
  const surname = words.length >= 3 ? words[2] : words[1];

  return `${first!.charAt(0)}${surname ?? first!.slice(1)}`.slice(0, MAX_USERNAME_LENGTH);
}

/**
 * A name as ASCII words, accents removed.
 *
 * `\u0300-\u036f` is the combining-marks block that `NFD` leaves behind once it
 * has split `é` into `e` plus its accent — the standard way to strip diacritics
 * without a table of every accented letter.
 */
function wordsOf(fullName: string): string[] {
  return fullName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/** Whole years elapsed, counted the way a person counts them. */
export function ageOn(birthDate: string, today: Date): number | null {
  const born = parseIsoDate(birthDate);

  if (born === null) {
    return null;
  }

  let age = today.getFullYear() - born.getFullYear();
  const monthsApart = today.getMonth() - born.getMonth();

  // The birthday has not arrived yet this year, so the last one has not counted.
  if (monthsApart < 0 || (monthsApart === 0 && today.getDate() < born.getDate())) {
    age -= 1;
  }

  return age;
}

/**
 * Why this birth date cannot be sent, or `null` when it can.
 *
 * `new Date('2026-02-31')` is not an error in JavaScript — it is the 3rd of
 * March — so a real calendar check has to compare the parsed date back against
 * the digits it came from. Without it, a typo becomes a silently different
 * person's date of birth.
 */
export function birthDateRejection(birthDate: string, today: Date): string | null {
  const parsed = parseIsoDate(birthDate);

  if (parsed === null) {
    // The field is a native `type="date"` input, which reads and writes
    // `YYYY-MM-DD` regardless of how the browser displays it — never
    // `día/mes/año`. This message almost never shows (the picker itself keeps
    // most typos out), and when it does it must not describe a format the
    // field never asked for.
    return 'Escribe una fecha válida en formato año-mes-día.';
  }

  if (parsed.getTime() > today.getTime()) {
    return 'La fecha de nacimiento no puede estar en el futuro.';
  }

  const age = ageOn(birthDate, today)!;

  if (age < MIN_AGE_YEARS) {
    return `Debes tener al menos ${MIN_AGE_YEARS} años para abrir una cuenta.`;
  }

  if (age > MAX_AGE_YEARS) {
    return 'Revisa la fecha: el año no parece correcto.';
  }

  return null;
}

/**
 * Why this file cannot be sent, or `null` when it can.
 *
 * Refusing it here costs nothing and tells the person the real reason. The
 * Gateway refuses the same two things while the upload is still arriving, so
 * this is a courtesy, never the enforcement.
 */
export function photoRejection(file: { type: string; size: number } | null): string | null {
  if (file === null) {
    return 'Adjunta la foto de tu documento de identidad.';
  }

  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return 'La foto debe ser JPG o PNG.';
  }

  if (file.size > MAX_PHOTO_BYTES) {
    const megabytes = (file.size / 1024 / 1024).toFixed(1);
    return `El archivo pesa ${megabytes} MB y el máximo es 5 MB. Reduce el tamaño e inténtalo de nuevo.`;
  }

  return null;
}

export interface RegistrationFields {
  readonly fullName: string;
  readonly identityDocument: string;
  readonly email: string;
  readonly dateOfBirth: string;
  readonly address: string;
  readonly credential: string;
  readonly credentialConfirmation: string;
  readonly terms: boolean;
}

/** Field name → message. An empty object means the form may be sent. */
export type FieldErrors = Readonly<Record<string, string>>;

/**
 * The registration form checked without a request.
 *
 * Returns every problem at once rather than the first one: a three-step wizard
 * that revealed one error per attempt would make somebody walk the same step
 * four times to learn four things it already knew.
 */
export function validateRegistration(fields: RegistrationFields, today: Date): FieldErrors {
  const errors: Record<string, string> = {};

  const fullName = fields.fullName.trim();
  if (fullName.length === 0) {
    errors.fullName = 'Escribe tu nombre completo.';
  } else if (fullName.length > 200) {
    errors.fullName = 'El nombre no puede pasar de 200 caracteres.';
  } else if (wordsOf(fullName).length < 2) {
    // The username is derived from a given name and a surname; one word cannot
    // produce one, and finding that out after three steps would be worse.
    errors.fullName = 'Escribe al menos un nombre y un apellido.';
  }

  const birthProblem = birthDateRejection(fields.dateOfBirth, today);
  if (birthProblem !== null) {
    errors.dateOfBirth = birthProblem;
  }

  const address = fields.address.trim();
  if (address.length === 0) {
    errors.address = 'Escribe tu dirección.';
  } else if (address.length > 300) {
    errors.address = 'La dirección no puede pasar de 300 caracteres.';
  }

  if (!isEmail(fields.email.trim())) {
    errors.email = 'Escribe un correo electrónico válido.';
  }

  /**
   * Thirteen digits is the DPI, which is what the prototype asks for and what a
   * Guatemalan document actually has. The contract accepts up to fifty
   * characters because it must also accept a passport; this form does not.
   */
  const document = fields.identityDocument.replace(/\s/g, '');
  if (!/^\d{13}$/.test(document)) {
    errors.identityDocument = 'El DPI son 13 dígitos.';
  }

  if (fields.credential.length < 8) {
    errors.credential = 'La contraseña debe tener al menos 8 caracteres.';
  } else if (fields.credential.length > 256) {
    errors.credential = 'La contraseña no puede pasar de 256 caracteres.';
  }

  if (fields.credentialConfirmation !== fields.credential) {
    errors.credentialConfirmation = 'Las contraseñas no coinciden.';
  }

  if (!fields.terms) {
    errors.terms = 'Debes aceptar los términos para continuar.';
  }

  return errors;
}

/** The fields a person may change afterwards — the three `PATCH` accepts. */
export interface UpdateFields {
  readonly fullName: string;
  readonly address: string;
  readonly dateOfBirth: string;
}

/**
 * The update form, checked locally.
 *
 * The email is absent on purpose: `UpdateCustomerDto` does not accept it, so
 * offering the field would be offering a change that silently never happens.
 *
 * Every field is optional here, and that is a consequence of the Gateway having
 * no route to read a customer: with nothing to prefill, an empty box means
 * "leave this alone" rather than "erase it". An update with every box empty is
 * refused before it is sent, because the contract refuses the empty update.
 */
export function validateUpdate(fields: Partial<UpdateFields>, today: Date): FieldErrors {
  const errors: Record<string, string> = {};
  const payload = updatePayload(fields);

  if (Object.keys(payload).length === 0) {
    errors.form = 'Cambia al menos un dato antes de guardar.';
    return errors;
  }

  if (payload.fullName !== undefined && payload.fullName.length > 200) {
    errors.fullName = 'El nombre no puede pasar de 200 caracteres.';
  }

  if (payload.address !== undefined && payload.address.length > 300) {
    errors.address = 'La dirección no puede pasar de 300 caracteres.';
  }

  if (payload.dateOfBirth !== undefined) {
    const birthProblem = birthDateRejection(payload.dateOfBirth, today);

    if (birthProblem !== null) {
      errors.dateOfBirth = birthProblem;
    }
  }

  return errors;
}

/** Only the fields that were actually filled in, trimmed. */
export function updatePayload(fields: Partial<UpdateFields>): Partial<UpdateFields> {
  const payload: Record<string, string> = {};

  for (const field of ['fullName', 'address', 'dateOfBirth'] as const) {
    const value = (fields[field] ?? '').trim();

    if (value.length > 0) {
      payload[field] = value;
    }
  }

  return payload;
}

export type IdentityStatus = 'PENDING' | 'VALIDATED' | 'REJECTED';

export interface IdentityPresentation {
  readonly label: string;
  /** A Nuxt UI semantic colour, so the badge never hard-codes a hex. */
  readonly color: 'warning' | 'success' | 'error';
  readonly explanation: string;
}

/**
 * How each identity state is written for a person.
 *
 * `PENDING` is amber rather than neutral because it is not "nothing yet": it is
 * the state in which no account can be opened, and a grey chip would read as
 * incidental.
 */
export const IDENTITY_PRESENTATION: Readonly<Record<IdentityStatus, IdentityPresentation>> = {
  PENDING: {
    label: 'Pendiente de revisión',
    color: 'warning',
    explanation: 'Un cajero receptor debe revisar la foto de tu documento antes de que puedas abrir cuentas.',
  },
  VALIDATED: {
    label: 'Identidad verificada',
    color: 'success',
    explanation: 'El documento de identificación ha sido verificado satisfactoriamente.',
  },
  REJECTED: {
    label: 'Identidad rechazada',
    color: 'error',
    explanation: 'La foto del documento no pudo validarse. Puedes volver a cargarla con mejor calidad.',
  },
};

/**
 * The Fase 2 compliance verdict (T-26, §4.1 p. 4) — distinct from
 * `IdentityStatus` above, which is Fase 1's review of the document photo.
 * `PENDING` here does not block opening an account; since T-31 it blocks
 * initiating a transfer, which is the fact this presentation exists to
 * explain before a customer discovers it as a rejected transfer instead.
 */
export type KycStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface KycPresentation {
  readonly label: string;
  readonly color: 'warning' | 'success' | 'error';
  readonly explanation: string;
}

/** `REJECTED` is not terminal here (a new review reopens it), unlike `VERIFIED`. */
export const KYC_PRESENTATION: Readonly<Record<KycStatus, KycPresentation>> = {
  PENDING: {
    label: 'KYC pendiente',
    color: 'warning',
    explanation:
      'Un cajero receptor debe verificar tu identidad para cumplimiento antes de que puedas transferir.',
  },
  VERIFIED: {
    label: 'KYC verificado',
    color: 'success',
    explanation: 'Tu identidad fue verificada para cumplimiento. Puedes transferir con normalidad.',
  },
  REJECTED: {
    label: 'KYC rechazado',
    color: 'error',
    explanation: 'No pudimos completar tu verificación de cumplimiento. Un cajero puede revisarla de nuevo.',
  },
};

/**
 * Whether a failed fetch of the identity-document photo means "nothing was
 * ever uploaded" rather than a real failure.
 *
 * A registration may legally carry no photo (`photoRejection` above only
 * refuses one locally chosen and offered; the Gateway itself accepts a
 * registration with none), so a cajero opening the validation screen for that
 * customer sees an ordinary empty state, never the same alert a broker outage
 * would show. Anything else the Gateway's `failureCode` could be — including
 * `null`, a network failure with no code at all — falls through to the real
 * error path.
 */
export function isMissingDocumentPhoto(failureCode: string | null): boolean {
  return failureCode === 'IDENTITY_OBJECT_NOT_FOUND';
}

/**
 * The shape `GET /api/audit` returns: metadata, plus whatever survived
 * redaction.
 *
 * `payload` is optional for two reasons: an older reply predating T-20 never
 * carried one, and a message whose whole payload was sensitive redacts down to
 * nothing. When it is present, though, a field the audit service's deny-list
 * does not recognise — `reason` on a rejection, for instance — travels
 * unredacted, which is what makes `explainCustomerRejection` possible without
 * this module ever touching the Gateway.
 */
export interface AuditEvent {
  readonly messageType: string;
  readonly payload?: Record<string, unknown>;
}

export type CommandOutcome = 'SUCCESS' | 'BUSINESS_REJECTION';

/**
 * How a command ended, read from the audit trail — or `null` to keep waiting.
 *
 * The reply carries **metadata only**, by design: echoing every payload back
 * would rebuild, in one response, the personal data the per-service databases
 * exist to keep apart. So the verdict is the presence of a message type, and
 * the reason has to come from elsewhere.
 *
 * `customer.register.rejected.v1` was added by T-16 for exactly this reason: a
 * duplicated document or email used to produce silence, and silence is
 * indistinguishable from a message still in flight.
 */
export function outcomeFromAudit(events: readonly AuditEvent[]): CommandOutcome | null {
  const types = new Set(events.map((event) => event.messageType));

  if (types.has('customer.registered.v1') || types.has('customer.updated.v1')) {
    return 'SUCCESS';
  }

  if (
    types.has('customer.register.rejected.v1') ||
    types.has('customer.identity.rejected.v1')
  ) {
    return 'BUSINESS_REJECTION';
  }

  return null;
}

/**
 * What a rejection's `reason` means, in Spanish, to the person it happened to.
 *
 * The two codes that actually reach a person through this screen are the two
 * that matter most: a duplicated email or a duplicated document, and both are
 * actionable rather than merely apologetic — the point is to tell somebody
 * what to do next, not just that something went wrong. `ROLE_NOT_ELIGIBLE` and
 * `INVALID_BIRTH_DATE` belong to the staff form (`mode: 'staff'`), where the
 * caller who reads this is the one who chose the role or typed the date.
 *
 * A code this map does not recognise falls back rather than being shown raw —
 * `explainCustomerRejection` returns `null` for it, exactly as `explainReason`
 * does in `transaction.ts`, and the caller supplies the honest, role-aware
 * fallback.
 */
export const CUSTOMER_REJECTION_TEXT: Readonly<Record<string, string>> = {
  EMAIL_ALREADY_REGISTERED:
    'Ya existe una cuenta con este correo electrónico. Si es tuya, inicia sesión en lugar de ' +
    'registrarte de nuevo, o recupera tu contraseña si no la recuerdas.',
  DOCUMENT_ALREADY_REGISTERED:
    'Ya existe un cliente registrado con este número de DPI. Si crees que se trata de un error, ' +
    'contacta al banco.',
  ROLE_NOT_ELIGIBLE: 'El rol elegido no se puede crear desde este formulario.',
  INVALID_BIRTH_DATE: 'La fecha de nacimiento no es válida para abrir una cuenta.',
  IDENTITY_DOCUMENT_UNREADABLE: 'La foto del documento no se pudo leer. Vuelve a cargarla con mejor calidad.',
  IDENTITY_OBJECT_NOT_FOUND: 'La foto del documento no llegó a guardarse. Vuelve a cargarla.',
  IDENTITY_DIGEST_MISMATCH: 'La foto del documento no coincide con la que se envió. Vuelve a cargarla.',
};

/**
 * Why a registration or an identity check was refused, read from the trail.
 *
 * Only reachable while the outcome can actually be observed — an
 * `ADMINISTRADOR` session, per D-06 (TD-021) — because it is `useCommandOutcome`
 * that decides whether the trail is ever polled. `null` here means either
 * "nothing rejected" or "the reason is not one this map knows yet"; the caller
 * cannot tell which and does not need to, because both get the same honest,
 * role-aware fallback.
 */
export function explainCustomerRejection(events: readonly AuditEvent[]): string | null {
  const rejection = events.find(
    (event) =>
      event.messageType === 'customer.register.rejected.v1' ||
      event.messageType === 'customer.identity.rejected.v1',
  );

  const reason = rejection?.payload?.reason;

  return typeof reason === 'string' ? (CUSTOMER_REJECTION_TEXT[reason] ?? null) : null;
}

export type RegistrationOutcome = CommandOutcome | 'PENDING';

export interface RegistrationHeading {
  readonly heading: string;
  /** Whether the body may claim the activation email was sent. */
  readonly confirmed: boolean;
}

/**
 * What the "accepted" screen may claim, before or after the outcome resolves.
 *
 * Self-service registration happens with no session, so D-06 keeps the trail
 * from ever being read (TD-021) and this stays `PENDING` forever for that
 * caller — the screen must never promise the activation email went out,
 * because it may never have. A staff-driven registration *can* resolve, and
 * only once it resolves to `SUCCESS` may the screen say the email was sent. A
 * `BUSINESS_REJECTION` gets its own heading rather than sharing one with
 * either: `SharedAsyncStateAlert` is where the specific reason lives.
 */
export function registrationHeading(outcome: RegistrationOutcome): RegistrationHeading {
  if (outcome === 'SUCCESS') {
    return { heading: 'Registro completado', confirmed: true };
  }

  if (outcome === 'BUSINESS_REJECTION') {
    return { heading: 'No pudimos completar el registro', confirmed: false };
  }

  return { heading: 'Registro recibido', confirmed: false };
}

/** A size as the upload card writes it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A DPI grouped the way the prototype prints it: `2547 89632 0101`. */
export function formatDocument(document: string): string {
  const digits = document.replace(/\D/g, '');

  return /^\d{13}$/.test(digits)
    ? `${digits.slice(0, 4)} ${digits.slice(4, 9)} ${digits.slice(9)}`
    : document;
}

/**
 * `YYYY-MM-DD` as a real calendar date, or `null`.
 *
 * Parsed in UTC and compared field by field: `new Date('2026-02-31')` rolls
 * over to March without complaining, and a form that accepts an impossible date
 * stores somebody else's birthday.
 */
function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match === null) {
    return null;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));

  const isRealDate =
    parsed.getFullYear() === Number(year) &&
    parsed.getMonth() === Number(month) - 1 &&
    parsed.getDate() === Number(day);

  return isRealDate ? parsed : null;
}

/**
 * Deliberately permissive, and deliberately not a regular expression contest.
 *
 * The only authority on whether an address exists is the activation email that
 * either arrives or does not. A stricter pattern here would mostly succeed at
 * refusing valid, unusual addresses.
 */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}
