import {
  DomainRejection,
  applyChanges,
  canSignIn,
  mayInitiateTransactions,
  mayManageKyc,
  recordIdentityVerdict,
  registerCustomer,
  setKycStatus,
  verifyEmail,
  yearsBetween,
} from '../src/domain/customer';
import { judgeIdentityPhoto } from '../src/domain/identity-validation';
import { baseUsernameFor, usernameCandidates } from '../src/domain/username';

/**
 * The rules, without a database, a broker or a framework in sight.
 *
 * That is the whole point of the domain layer being import-free: these are the
 * statements the assignment makes about a customer, and they are checkable in
 * milliseconds.
 */

const NOW = new Date('2026-08-26T12:00:00.000Z');

const VALID = {
  customerId: '7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
  fullName: 'María Fernanda López García',
  identityDocument: '2547896320101',
  email: 'Maria.Lopez@Correo.com',
  dateOfBirth: '1996-04-18',
  address: '12 calle 3-45 zona 1, Guatemala',
  role: 'CLIENTE',
} as const;

describe('registering a customer', () => {
  it('starts pending on both axes, because neither has happened yet', () => {
    const customer = registerCustomer(VALID, 'mlopez', NOW);

    expect(customer.status).toBe('PENDING_ACTIVATION');
    expect(customer.identityStatus).toBe('PENDING');
    expect(customer.emailVerifiedAt).toBeNull();
  });

  it('starts the KYC status pending too, independent of the other two axes', () => {
    expect(registerCustomer(VALID, 'mlopez', NOW).kycStatus).toBe('PENDING');
  });

  it('lower-cases the email, so C-3 uniqueness is not case-sensitive to a person', () => {
    expect(registerCustomer(VALID, 'mlopez', NOW).email).toBe('maria.lopez@correo.com');
  });

  it('refuses a date the calendar does not have (C-5)', () => {
    // `new Date('1996-02-31')` is the 3rd of March: trusting the parser here
    // would store a date the customer never gave.
    expect(() => registerCustomer({ ...VALID, dateOfBirth: '1996-02-31' }, 'x', NOW)).toThrow(
      DomainRejection,
    );
  });

  it('refuses a future date (C-5)', () => {
    expect(() => registerCustomer({ ...VALID, dateOfBirth: '2027-01-01' }, 'x', NOW)).toThrow(
      /future/,
    );
  });

  it('refuses a minor and an implausible age (C-5)', () => {
    expect(() => registerCustomer({ ...VALID, dateOfBirth: '2015-04-18' }, 'x', NOW)).toThrow(
      /minimum age/,
    );
    expect(() => registerCustomer({ ...VALID, dateOfBirth: '1850-04-18' }, 'x', NOW)).toThrow(
      /implausible/,
    );
  });

  it('does not count a birthday that has not arrived yet', () => {
    expect(yearsBetween(new Date('1996-12-31T00:00:00Z'), NOW)).toBe(29);
    expect(yearsBetween(new Date('1996-01-01T00:00:00Z'), NOW)).toBe(30);
  });
});

describe('the username a name produces', () => {
  it('takes the given name and the first surname, without accents', () => {
    expect(baseUsernameFor('María Fernanda López García')).toBe('marialopez');
    expect(baseUsernameFor('Juan Pérez')).toBe('juanperez');
  });

  it('falls back rather than failing a registration on punctuation', () => {
    expect(baseUsernameFor('...')).toBe('cliente');
  });

  it('offers suffixes in order, so a collision resolves deterministically', () => {
    const candidates = [...take(usernameCandidates('Juan Pérez'), 3)];

    expect(candidates).toEqual(['juanperez', 'juanperez2', 'juanperez3']);
  });

  it('never offers a candidate longer than the column', () => {
    for (const candidate of take(usernameCandidates(`Ana ${'r'.repeat(200)}`), 5)) {
      expect(candidate.length).toBeLessThanOrEqual(60);
    }
  });
});

describe('updating a customer', () => {
  const customer = registerCustomer(VALID, 'mlopez', NOW);

  it('reports only what actually changed', () => {
    const result = applyChanges(customer, { address: 'Otra dirección' }, NOW);

    expect(result.changedFields).toEqual(['address']);
    expect(result.customer.address).toBe('Otra dirección');
  });

  it('does not call a field changed when the value is the one already stored', () => {
    // The event carries the names of changed fields; claiming a change that did
    // not happen is a lie the audit record keeps forever.
    const result = applyChanges(customer, { address: customer.address }, NOW);

    expect(result.changedFields).toEqual([]);
    expect(result.customer).toBe(customer);
  });

  it('still refuses an incoherent date on the way in', () => {
    expect(() => applyChanges(customer, { dateOfBirth: '2027-01-01' }, NOW)).toThrow(
      DomainRejection,
    );
  });

  it('leaves the username alone when the name changes', () => {
    // It is an identifier people sign in with and share; regenerating it would
    // break every reference to satisfy a rule that only applied at creation.
    const result = applyChanges(customer, { fullName: 'María Fernanda Ruiz' }, NOW);

    expect(result.customer.username).toBe('mlopez');
  });
});

describe('activation, and the one legal transition of status (C-4)', () => {
  const customer = registerCustomer(VALID, 'mlopez', NOW);

  it('cannot sign in before the email is verified', () => {
    expect(canSignIn(customer)).toBe(false);
  });

  it('becomes ACTIVE and records when, because C-4 ties the two together', () => {
    const activated = verifyEmail(customer, NOW);

    expect(activated.status).toBe('ACTIVE');
    expect(activated.emailVerifiedAt).toBe(NOW.toISOString());
    expect(canSignIn(activated)).toBe(true);
  });

  it('refuses a second verification, so a leaked link is not reusable', () => {
    const activated = verifyEmail(customer, NOW);

    expect(() => verifyEmail(activated, NOW)).toThrow(DomainRejection);
  });
});

describe('the verdict on an identity document', () => {
  const customer = registerCustomer(VALID, 'mlopez', NOW);

  it('accepts a rejected identity being reviewed again', () => {
    const rejected = recordIdentityVerdict(customer, 'REJECTED', NOW);

    expect(recordIdentityVerdict(rejected, 'VALIDATED', NOW).identityStatus).toBe('VALIDATED');
  });

  it('refuses to re-open a validated identity', () => {
    // Otherwise a second, different document silently replaces an accepted one.
    const validated = recordIdentityVerdict(customer, 'VALIDATED', NOW);

    expect(() => recordIdentityVerdict(validated, 'REJECTED', NOW)).toThrow(DomainRejection);
  });
});

describe('the KYC verdict (Fase 2, C-8)', () => {
  const customer = registerCustomer(VALID, 'mlopez', NOW);

  it('accepts a rejected KYC status being reviewed again', () => {
    const rejected = setKycStatus(customer, 'REJECTED', NOW);

    expect(setKycStatus(rejected, 'VERIFIED', NOW).kycStatus).toBe('VERIFIED');
  });

  it('refuses to re-open a verified KYC status', () => {
    // Otherwise a later, weaker review silently replaces an accepted one.
    const verified = setKycStatus(customer, 'VERIFIED', NOW);

    expect(() => setKycStatus(verified, 'REJECTED', NOW)).toThrow(DomainRejection);
  });

  // The name used to say "leaves every other field untouched" while asserting
  // that `identityStatus` had changed — the assertion contradicted the title it
  // was written under, which is how the disagreement with the integration suite
  // stayed invisible.
  it('carries identityStatus with the verdict, and touches nothing else', () => {
    const verified = setKycStatus(customer, 'VERIFIED', NOW);

    expect(verified.updatedAt).toBe(NOW.toISOString());
    expect(verified.customerId).toBe(customer.customerId);
    expect(verified.identityStatus).toBe('VALIDATED');
  });

  it('rejects the document review too when the KYC verdict is REJECTED', () => {
    expect(setKycStatus(customer, 'REJECTED', NOW).identityStatus).toBe('REJECTED');
  });
});

describe('who may manage KYC (staff only)', () => {
  it('refuses a CLIENTE and an unauthenticated caller', () => {
    expect(mayManageKyc(null)).toBe(false);
    expect(mayManageKyc({ role: 'CLIENTE', customerId: 'c1' })).toBe(false);
  });

  it('allows a cajero and an administrador', () => {
    expect(mayManageKyc({ role: 'CAJERO_RECEPTOR', customerId: 'staff-1' })).toBe(true);
    expect(mayManageKyc({ role: 'ADMINISTRADOR', customerId: 'staff-2' })).toBe(true);
  });
});

describe('who may initiate a transaction (§4.1 p. 4)', () => {
  it('requires a VERIFIED kycStatus for a CLIENTE', () => {
    expect(mayInitiateTransactions({ role: 'CLIENTE', kycStatus: 'PENDING' })).toBe(false);
    expect(mayInitiateTransactions({ role: 'CLIENTE', kycStatus: 'REJECTED' })).toBe(false);
    expect(mayInitiateTransactions({ role: 'CLIENTE', kycStatus: 'VERIFIED' })).toBe(true);
  });

  it('does not gate staff, who hold no accounts', () => {
    expect(mayInitiateTransactions({ role: 'CAJERO_RECEPTOR', kycStatus: 'PENDING' })).toBe(true);
    expect(mayInitiateTransactions({ role: 'ADMINISTRADOR', kycStatus: 'REJECTED' })).toBe(true);
  });
});

describe('the simulated photo validation', () => {
  const declared = { contentType: 'image/jpeg', sizeBytes: 1_000, sha256: 'a'.repeat(64) };
  const fetched = { byteLength: 1_000, sha256: 'a'.repeat(64), digestBelongsToAnother: false };

  it('accepts bytes that match the reference', () => {
    expect(judgeIdentityPhoto(declared, fetched)).toEqual({ outcome: 'VALIDATED' });
  });

  it('rejects an object that is not there', () => {
    expect(judgeIdentityPhoto(declared, null)).toEqual({
      outcome: 'REJECTED',
      reason: 'IDENTITY_OBJECT_NOT_FOUND',
    });
  });

  it('rejects a type nobody agreed to store', () => {
    expect(judgeIdentityPhoto({ ...declared, contentType: 'application/pdf' }, fetched)).toEqual({
      outcome: 'REJECTED',
      reason: 'IDENTITY_DOCUMENT_UNREADABLE',
    });
  });

  it('rejects an object larger than the ceiling', () => {
    expect(
      judgeIdentityPhoto(declared, { ...fetched, byteLength: 5_242_881 }),
    ).toMatchObject({ reason: 'IDENTITY_DOCUMENT_UNREADABLE' });
  });

  it('rejects bytes whose digest disagrees with the reference', () => {
    // This is the check that makes an object swapped in storage between upload
    // and read unable to become an accepted identity document.
    expect(judgeIdentityPhoto(declared, { ...fetched, sha256: 'b'.repeat(64) })).toEqual({
      outcome: 'REJECTED',
      reason: 'IDENTITY_DIGEST_MISMATCH',
    });
  });

  it('rejects a size that disagrees with the reference', () => {
    expect(judgeIdentityPhoto(declared, { ...fetched, byteLength: 999 })).toMatchObject({
      reason: 'IDENTITY_DIGEST_MISMATCH',
    });
  });

  it('rejects a photograph that already backs another identity', () => {
    expect(
      judgeIdentityPhoto(declared, { ...fetched, digestBelongsToAnother: true }),
    ).toMatchObject({ reason: 'IDENTITY_DOCUMENT_UNREADABLE' });
  });
});

function* take<T>(values: Iterable<T>, count: number): Generator<T> {
  let taken = 0;

  for (const value of values) {
    if (taken >= count) {
      return;
    }

    taken += 1;
    yield value;
  }
}
