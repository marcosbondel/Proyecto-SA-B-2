import { createHash } from 'node:crypto';

import type { CustomerRegisterV1 } from '@bank/contracts';

import { AuthenticateCustomerUseCase } from '../src/application/authenticate-customer.use-case';
import { GetCustomerUseCase } from '../src/application/get-customer.use-case';
import { GetIdentityDocumentUseCase } from '../src/application/get-identity-document.use-case';
import { GetPendingValidationUseCase } from '../src/application/get-pending-validation.use-case';
import { RegisterCustomerUseCase } from '../src/application/register-customer.use-case';
import { SetIdentityVerdictUseCase } from '../src/application/set-identity-verdict.use-case';
import { SetKycStatusUseCase } from '../src/application/set-kyc-status.use-case';
import { UpdateCustomerUseCase } from '../src/application/update-customer.use-case';
import { ValidateIdentityUseCase } from '../src/application/validate-identity.use-case';
import { VerifyEmailActivationUseCase } from '../src/application/verify-email-activation.use-case';
import {
  FakeHasher,
  FixedClock,
  InMemoryCustomerRepository,
  PredictableTokens,
  RecordingPublisher,
  StubDocumentReader,
  StubDocumentStager,
} from './support/in-memory';

/**
 * The use cases, against doubles that behave rather than count calls.
 *
 * What is asserted here is what the ticket's acceptance criteria actually say:
 * one row and one event per registration, a repeated command that changes
 * nothing, a duplicate that is refused with a safe reason, and a login that
 * cannot tell an unknown address from a wrong password.
 */

const NOW = new Date('2026-08-26T12:00:00.000Z');
const PHOTO_BYTES = Buffer.from('a pretend jpeg');
const PHOTO_DIGEST = createHash('sha256').update(PHOTO_BYTES).digest('hex');

const REGISTER: CustomerRegisterV1 = {
  customerId: '7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
  fullName: 'María Fernanda López García',
  identityDocument: '2547896320101',
  email: 'maria.lopez@correo.com',
  dateOfBirth: '1996-04-18',
  address: '12 calle 3-45 zona 1, Guatemala',
  role: 'CLIENTE',
  credential: 'una-clave-larga',
  photo: {
    objectKey: 'photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: PHOTO_BYTES.byteLength,
    sha256: PHOTO_DIGEST,
  },
};

function build(bytes: Buffer | null = PHOTO_BYTES) {
  const repository = new InMemoryCustomerRepository();
  const publisher = new RecordingPublisher();
  const documents = new StubDocumentReader(bytes);
  const stager = new StubDocumentStager();
  const clock = new FixedClock(NOW);
  const tokens = new PredictableTokens();
  const hasher = new FakeHasher();

  return {
    repository,
    publisher,
    documents,
    stager,
    clock,
    tokens,
    hasher,
    register: new RegisterCustomerUseCase({
      repository,
      publisher,
      hasher,
      tokens,
      documents,
      clock,
    }),
    update: new UpdateCustomerUseCase({ repository, publisher, clock }),
    getCustomer: new GetCustomerUseCase({ repository, publisher }),
    getIdentityDocument: new GetIdentityDocumentUseCase({ repository, publisher, stager }),
    setVerdict: new SetIdentityVerdictUseCase({ repository, publisher, clock, tokens }),
    setKycStatus: new SetKycStatusUseCase({ repository, publisher, clock }),
    pending: new GetPendingValidationUseCase({ repository, publisher }),
    authenticate: new AuthenticateCustomerUseCase({ repository, publisher, hasher, tokens, clock }),
    verifyEmail: new VerifyEmailActivationUseCase({ repository, publisher, tokens, clock }),
    validateIdentity: new ValidateIdentityUseCase({ repository, publisher, documents, clock }),
  };
}

describe('registering a customer (criteria 1, 2, 3, 4, 5, 10)', () => {
  it('persists one customer with its document, and says so', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');

    expect(context.repository.customers.size).toBe(1);
    expect(context.repository.documents).toHaveLength(1);
    expect(context.publisher.typesPublished()).toEqual(['customer.registered.v1']);
  });

  it('generates the username from the name and publishes it', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');

    expect(context.publisher.payloadOf('customer.registered.v1')).toMatchObject({
      username: 'marialopez',
    });
  });

  it('sends the activation email when teller validates identity, and no account can sign in yet', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');
    expect(context.repository.customers.get(REGISTER.customerId)!.status).toBe(
      'PENDING_ACTIVATION',
    );

    await context.setVerdict.execute(
      { customerId: REGISTER.customerId, verdict: 'VALIDATED' },
      { customerId: 'staff-1', role: 'CAJERO_RECEPTOR' },
      'verdict-key-1',
    );

    const activation = context.publisher.payloadOf('customer.activation.requested.v1');
    expect(activation).toMatchObject({ email: REGISTER.email, activationToken: 'token-2' });
  });

  it('does nothing at all the second time the same command arrives (criterion 2)', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');
    await context.register.execute(REGISTER, 'key-1');

    expect(context.repository.customers.size).toBe(1);
    expect(context.publisher.published).toHaveLength(1);
  });

  it('refuses a duplicated document with a safe reason and no success event', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');
    await context.register.execute(
      { ...REGISTER, customerId: '9a1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93', email: 'otra@correo.com' },
      'key-2',
    );

    expect(context.repository.customers.size).toBe(1);
    expect(context.publisher.published.filter((m) => m.messageType === 'customer.registered.v1')).toHaveLength(1);
    expect(context.publisher.payloadOf('customer.register.rejected.v1')).toMatchObject({
      reason: 'DOCUMENT_ALREADY_REGISTERED',
    });
  });

  it('refuses a duplicated email the same way', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');
    await context.register.execute(
      {
        ...REGISTER,
        customerId: '9a1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
        identityDocument: '9999999999999',
      },
      'key-2',
    );

    expect(context.publisher.payloadOf('customer.register.rejected.v1')).toMatchObject({
      reason: 'EMAIL_ALREADY_REGISTERED',
    });
  });

  it('never reaches the repository with an incoherent date (criterion 4)', async () => {
    const context = build();

    await context.register.execute({ ...REGISTER, dateOfBirth: '2027-01-01' }, 'key-1');

    expect(context.repository.customers.size).toBe(0);
    expect(context.publisher.payloadOf('customer.register.rejected.v1')).toMatchObject({
      reason: 'INVALID_BIRTH_DATE',
    });
  });

  it('registers the customer but rejects the identity when the object is missing (criterion 5)', async () => {
    const context = build(null);

    await context.register.execute(REGISTER, 'key-1');

    // The two axes are independent: losing the whole registration over an
    // unreadable photo would make somebody re-type everything.
    expect(context.repository.customers.get(REGISTER.customerId)!.identityStatus).toBe('REJECTED');
    expect(context.publisher.payloadOf('customer.identity.rejected.v1')).toMatchObject({
      reason: 'IDENTITY_OBJECT_NOT_FOUND',
    });
  });

  it('rejects the identity when the bytes do not match the digest claimed', async () => {
    const context = build(Buffer.from('different bytes entirely'));

    await context.register.execute(REGISTER, 'key-1');

    expect(context.publisher.payloadOf('customer.identity.rejected.v1')).toMatchObject({
      reason: 'IDENTITY_DIGEST_MISMATCH',
    });
  });

  it('leaves the identity PENDING when no photo was attached', async () => {
    const context = build();

    await context.register.execute({ ...REGISTER, photo: null }, 'key-1');

    expect(context.repository.customers.get(REGISTER.customerId)!.identityStatus).toBe('PENDING');
    expect(context.publisher.typesPublished()).not.toContain('customer.identity.rejected.v1');
  });

  it('resolves a username collision with the next candidate, not a failure', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-1');
    await context.register.execute(
      {
        ...REGISTER,
        customerId: '9a1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
        identityDocument: '9999999999999',
        email: 'otra@correo.com',
        photo: null,
      },
      'key-2',
    );

    const usernames = [...context.repository.customers.values()].map((c) => c.username);

    expect(usernames).toEqual(['marialopez', 'marialopez2']);
  });
});

describe('role on registration (D-06)', () => {
  it('refuses a non-CLIENTE role from an anonymous registration', async () => {
    const context = build();

    await context.register.execute({ ...REGISTER, role: 'ADMINISTRADOR' }, 'key-admin', null);

    expect(context.repository.customers.size).toBe(0);
    expect(context.publisher.payloadOf('customer.register.rejected.v1')).toMatchObject({
      reason: 'ROLE_NOT_ELIGIBLE',
    });
  });

  it('lets an administrator create staff', async () => {
    const context = build();

    await context.register.execute({ ...REGISTER, role: 'CAJERO_RECEPTOR' }, 'key-staff', {
      role: 'ADMINISTRADOR',
      customerId: '44444444-4444-4444-8444-444444444444',
    });

    expect(context.repository.customers.size).toBe(1);
    expect([...context.repository.customers.values()][0]!.role).toBe('CAJERO_RECEPTOR');
  });

  it('lets the anonymous public form create a CLIENTE', async () => {
    const context = build();

    await context.register.execute(REGISTER, 'key-client', null);

    expect(context.repository.customers.size).toBe(1);
  });
});

describe('the teller validates an identity (US6)', () => {
  // A customer registered without a photo is PENDING: no automatic verdict ran.
  const PENDING = { ...REGISTER, photo: null };

  it('lets a teller approve a pending identity, publishing the validated event', async () => {
    const context = build();
    await context.register.execute(PENDING, 'key-1');

    await context.setVerdict.execute(
      { customerId: PENDING.customerId, verdict: 'VALIDATED' },
      { role: 'CAJERO_RECEPTOR', customerId: '22222222-2222-4222-8222-222222222222' },
      'key-verdict',
    );

    expect(context.repository.customers.get(PENDING.customerId)!.identityStatus).toBe('VALIDATED');
    expect(context.publisher.payloadOf('customer.identity.validated.v1')).toMatchObject({
      customerId: PENDING.customerId,
      identityStatus: 'VALIDATED',
    });
  });

  it('lets a teller reject it, publishing the rejected event', async () => {
    const context = build();
    await context.register.execute(PENDING, 'key-1');

    await context.setVerdict.execute(
      { customerId: PENDING.customerId, verdict: 'REJECTED' },
      { role: 'CAJERO_RECEPTOR', customerId: '22222222-2222-4222-8222-222222222222' },
      'key-verdict',
    );

    expect(context.repository.customers.get(PENDING.customerId)!.identityStatus).toBe('REJECTED');
    expect(context.publisher.payloadOf('customer.identity.rejected.v1')).toMatchObject({
      identityStatus: 'REJECTED',
    });
  });

  it('refuses a client trying to validate an identity, publishing nothing', async () => {
    const context = build();
    await context.register.execute(PENDING, 'key-1');
    const before = context.publisher.published.length;

    await context.setVerdict.execute(
      { customerId: PENDING.customerId, verdict: 'VALIDATED' },
      { role: 'CLIENTE', customerId: PENDING.customerId },
      'key-verdict',
    );

    expect(context.publisher.published).toHaveLength(before);
    expect(context.repository.customers.get(PENDING.customerId)!.identityStatus).toBe('PENDING');
  });

  it('shows the pending queue to staff and an empty list to a client', async () => {
    const context = build();
    await context.register.execute(PENDING, 'key-1');

    await context.pending.execute(
      {},
      { role: 'CAJERO_RECEPTOR', customerId: '22222222-2222-4222-8222-222222222222' },
    );
    expect(context.publisher.replies.at(-1)?.payload).toMatchObject({
      customers: [{ customerId: PENDING.customerId }],
      omitted: 0,
    });

    await context.pending.execute({}, { role: 'CLIENTE', customerId: PENDING.customerId });
    expect(context.publisher.replies.at(-1)?.payload).toMatchObject({ customers: [], omitted: 0 });
  });
});

describe('reading a customer (US6)', () => {
  it('lets a client read their own record', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.getCustomer.execute(
      { customerId: REGISTER.customerId },
      { role: 'CLIENTE', customerId: REGISTER.customerId },
    );

    const reply = context.publisher.replies.at(-1);
    expect(reply?.messageType).toBe('customer.get.replied.v1');
    expect(reply?.payload).toMatchObject({ outcome: 'FOUND', customerId: REGISTER.customerId });
  });

  it('lets staff read any customer', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.getCustomer.execute(
      { customerId: REGISTER.customerId },
      { role: 'CAJERO_RECEPTOR', customerId: '22222222-2222-4222-8222-222222222222' },
    );

    expect(context.publisher.replies.at(-1)?.payload).toMatchObject({ outcome: 'FOUND' });
  });

  it('answers NOT_FOUND when a client reads someone else, indistinguishable from unknown', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.getCustomer.execute(
      { customerId: REGISTER.customerId },
      { role: 'CLIENTE', customerId: '11111111-1111-4111-8111-111111111111' },
    );

    expect(context.publisher.replies.at(-1)?.payload).toMatchObject({ outcome: 'NOT_FOUND' });
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    const context = build();

    await context.getCustomer.execute(
      { customerId: '00000000-0000-4000-8000-000000000000' },
      { role: 'ADMINISTRADOR', customerId: '33333333-3333-4333-8333-333333333333' },
    );

    expect(context.publisher.replies.at(-1)?.payload).toMatchObject({ outcome: 'NOT_FOUND' });
  });

  it('never carries the credential or the activation token in the reply', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.getCustomer.execute(
      { customerId: REGISTER.customerId },
      { role: 'ADMINISTRADOR', customerId: '33333333-3333-4333-8333-333333333333' },
    );

    const serialised = JSON.stringify(context.publisher.replies.at(-1)?.payload);
    expect(serialised).not.toContain('credential');
    expect(serialised).not.toContain('token');
    expect(serialised).not.toContain(REGISTER.credential);
  });
});

describe('viewing the identity-document photo (the cajero half of US6)', () => {
  it('stages the stored bytes and replies with a reference, never the bytes themselves', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.getIdentityDocument.execute(
      { customerId: REGISTER.customerId },
      { role: 'CAJERO_RECEPTOR', customerId: '22222222-2222-4222-8222-222222222222' },
    );

    expect(context.stager.staged).toHaveLength(1);
    expect(context.stager.staged[0]).toMatchObject({
      content: PHOTO_BYTES,
      mimeType: 'image/jpeg',
      sha256: PHOTO_DIGEST,
    });

    const reply = context.publisher.replies.at(-1);
    expect(reply?.messageType).toBe('customer.identity-document.replied.v1');
    expect(reply?.payload).toMatchObject({
      outcome: 'FOUND',
      photo: { contentType: 'image/jpeg', sha256: PHOTO_DIGEST },
    });

    // Never the bytes, whatever shape they might have travelled in.
    const serialised = JSON.stringify(reply?.payload);
    expect(serialised).not.toContain(PHOTO_BYTES.toString('base64'));
  });

  it('lets an administrator view it too', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.getIdentityDocument.execute(
      { customerId: REGISTER.customerId },
      { role: 'ADMINISTRADOR', customerId: '33333333-3333-4333-8333-333333333333' },
    );

    expect(context.publisher.replies.at(-1)?.payload).toMatchObject({ outcome: 'FOUND' });
  });

  it('answers NOT_FOUND/CUSTOMER_NOT_FOUND for a CLIENTE, indistinguishable from unknown', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.getIdentityDocument.execute(
      { customerId: REGISTER.customerId },
      { role: 'CLIENTE', customerId: REGISTER.customerId },
    );

    expect(context.publisher.replies.at(-1)?.payload).toEqual({
      outcome: 'NOT_FOUND',
      reason: 'CUSTOMER_NOT_FOUND',
    });
    expect(context.stager.staged).toHaveLength(0);
  });

  it('answers NOT_FOUND/CUSTOMER_NOT_FOUND for an unknown id', async () => {
    const context = build();

    await context.getIdentityDocument.execute(
      { customerId: '00000000-0000-4000-8000-000000000000' },
      { role: 'ADMINISTRADOR', customerId: '33333333-3333-4333-8333-333333333333' },
    );

    expect(context.publisher.replies.at(-1)?.payload).toEqual({
      outcome: 'NOT_FOUND',
      reason: 'CUSTOMER_NOT_FOUND',
    });
  });

  it('answers NOT_FOUND/IDENTITY_OBJECT_NOT_FOUND for a customer who registered with no photo', async () => {
    const context = build();
    await context.register.execute({ ...REGISTER, photo: null }, 'key-1');

    await context.getIdentityDocument.execute(
      { customerId: REGISTER.customerId },
      { role: 'CAJERO_RECEPTOR', customerId: '22222222-2222-4222-8222-222222222222' },
    );

    expect(context.publisher.replies.at(-1)?.payload).toEqual({
      outcome: 'NOT_FOUND',
      reason: 'IDENTITY_OBJECT_NOT_FOUND',
    });
    expect(context.stager.staged).toHaveLength(0);
  });
});

describe('updating a customer', () => {
  it('publishes the names of the fields that changed, never their values', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.update.execute(
      { customerId: REGISTER.customerId, address: 'Nueva dirección 1-23' },
      { role: 'CLIENTE', customerId: REGISTER.customerId },
      'key-update',
    );

    const payload = context.publisher.payloadOf('customer.updated.v1');

    expect(payload).toMatchObject({ changedFields: ['address'] });
    expect(JSON.stringify(payload)).not.toContain('Nueva dirección');
  });

  it('refuses a client updating another customer, and publishes nothing (D-06, IDOR)', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    const before = context.publisher.published.length;

    // A different client, editing REGISTER's record by its id.
    await context.update.execute(
      { customerId: REGISTER.customerId, address: 'Intrusión 9-99' },
      { role: 'CLIENTE', customerId: '11111111-1111-4111-8111-111111111111' },
      'key-idor',
    );

    expect(context.publisher.published).toHaveLength(before);
    expect(context.repository.customers.get(REGISTER.customerId)!.address).toBe(REGISTER.address);
    expect(await context.repository.findProcessed('key-idor', 'customer.update.v1')).toMatchObject({
      resultSummary: { outcome: 'FORBIDDEN' },
    });
  });

  it('lets a teller update any customer (D-06, staff not own-only)', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.update.execute(
      { customerId: REGISTER.customerId, address: 'Actualizado por cajero 2-34' },
      { role: 'CAJERO_RECEPTOR', customerId: '22222222-2222-4222-8222-222222222222' },
      'key-staff',
    );

    expect(context.publisher.payloadOf('customer.updated.v1')).toMatchObject({
      changedFields: ['address'],
    });
  });

  it('refuses an update with no verified actor', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    const before = context.publisher.published.length;

    await context.update.execute(
      { customerId: REGISTER.customerId, address: 'Sin sesión 0-00' },
      null,
      'key-noidentity',
    );

    expect(context.publisher.published).toHaveLength(before);
    expect(context.repository.customers.get(REGISTER.customerId)!.address).toBe(REGISTER.address);
  });

  it('publishes nothing when the update changes nothing', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    const before = context.publisher.published.length;

    await context.update.execute(
      { customerId: REGISTER.customerId, address: REGISTER.address },
      { role: 'CLIENTE', customerId: REGISTER.customerId },
      'key-update',
    );

    expect(context.publisher.published).toHaveLength(before);
  });

  it('ignores a command for a customer that does not exist, instead of retrying forever', async () => {
    const context = build();

    await context.update.execute(
      { customerId: '00000000-0000-4000-8000-000000000000', address: 'x' },
      { role: 'ADMINISTRADOR', customerId: '33333333-3333-4333-8333-333333333333' },
      'key-update',
    );

    expect(context.publisher.published).toHaveLength(0);
    expect(await context.repository.findProcessed('key-update', 'customer.update.v1')).not.toBeNull();
  });
});

describe('email activation (criteria 10, 12)', () => {
  it('activates the account and says when', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.verifyEmail.execute({ activationToken: 'token-1' }, 'key-verify');

    const customer = context.repository.customers.get(REGISTER.customerId)!;

    expect(customer.status).toBe('ACTIVE');
    expect(context.publisher.payloadOf('customer.email.verified.v1')).toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('refuses a token that was already used, without touching the account', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    await context.verifyEmail.execute({ activationToken: 'token-1' }, 'key-verify');
    const verifiedAt = context.repository.customers.get(REGISTER.customerId)!.emailVerifiedAt;

    await context.verifyEmail.execute({ activationToken: 'token-1' }, 'key-verify-2');

    expect(context.repository.customers.get(REGISTER.customerId)!.emailVerifiedAt).toBe(verifiedAt);
    expect(context.publisher.payloadOf('customer.email.verification.rejected.v1')).toMatchObject({
      reason: 'ACTIVATION_TOKEN_INVALID',
    });
  });

  it('refuses an expired token as expired, so the audit record can tell', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    context.clock.advanceTo(new Date('2026-08-28T12:00:00.000Z'));

    await context.verifyEmail.execute({ activationToken: 'token-1' }, 'key-verify');

    expect(context.publisher.payloadOf('customer.email.verification.rejected.v1')).toMatchObject({
      reason: 'ACTIVATION_TOKEN_EXPIRED',
    });
    expect(context.repository.customers.get(REGISTER.customerId)!.emailVerifiedAt).toBeNull();
  });

  it('refuses an invented token', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.verifyEmail.execute({ activationToken: 'invented-token-value' }, 'key-verify');

    expect(context.publisher.payloadOf('customer.email.verification.rejected.v1')).toMatchObject({
      reason: 'ACTIVATION_TOKEN_INVALID',
    });
  });

  it('answers a redelivered verification with the same verdict, not with a rejection', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    await context.verifyEmail.execute({ activationToken: 'token-1' }, 'key-verify');

    await context.verifyEmail.execute({ activationToken: 'token-1' }, 'key-verify');

    const verifications = context.publisher.published.filter(
      (message) => message.messageType === 'customer.email.verified.v1',
    );

    // Somebody is holding an HTTP connection open on the other side of this.
    expect(verifications).toHaveLength(2);
  });
});

describe('signing in (criterion 11)', () => {
  it('approves an activated account and records the sign-in', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    await context.verifyEmail.execute({ activationToken: 'token-1' }, 'key-verify');

    await context.authenticate.execute(
      {
        email: REGISTER.email,
        credential: REGISTER.credential,
      },
      'login-1',
    );

    expect(context.publisher.replies.at(-1)?.payload).toMatchObject({
      outcome: 'APPROVED',
      activationPending: false,
      claims: { username: 'marialopez', role: 'CLIENTE' },
    });
    expect(context.publisher.typesPublished()).toContain('customer.login.succeeded.v1');
  });

  it('answers a wrong password and an unknown address identically', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    await context.verifyEmail.execute({ activationToken: 'token-1' }, 'key-verify');

    await context.authenticate.execute(
      { email: REGISTER.email, credential: 'wrong-password' },
      'login-1',
    );
    const wrongPassword = context.publisher.replies.at(-1)?.payload;

    await context.authenticate.execute(
      { email: 'nobody@correo.com', credential: 'whatever' },
      'login-2',
    );
    const unknownAddress = context.publisher.replies.at(-1)?.payload;

    // Distinguishing them would turn the login route into an enumeration oracle.
    expect(wrongPassword).toEqual(unknownAddress);
    expect(wrongPassword).toEqual({ outcome: 'REJECTED', reason: 'INVALID_CREDENTIALS' });
  });

  it('will not let an unactivated account in, and re-sends the activation email', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.authenticate.execute(
      {
        email: REGISTER.email,
        credential: REGISTER.credential,
      },
      'login-1',
    );

    // The claims are correct and `activationPending` is what refuses the
    // session — the Gateway turns it into the same 401 as a wrong password.
    expect(context.publisher.replies.at(-1)?.payload).toMatchObject({ activationPending: true });
    expect(
      context.publisher.published.filter(
        (message) => message.messageType === 'customer.activation.requested.v1',
      ),
    ).toHaveLength(1);
  });

  it('re-sends the reply on a broker redelivery, but does not invalidate the token it just issued', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    // The first delivery of the authenticate command legitimately re-issues a
    // link, exactly as the "re-sends the activation email" test above shows.
    await context.authenticate.execute(
      { email: REGISTER.email, credential: REGISTER.credential },
      'login-1',
    );

    const afterFirstDelivery = context.publisher.published.filter(
      (message) => message.messageType === 'customer.activation.requested.v1',
    );
    expect(afterFirstDelivery).toHaveLength(1);

    // A broker redelivery of that *same* command — same idempotencyKey,
    // exactly as the broker replays the identical envelope.
    await context.authenticate.execute(
      { email: REGISTER.email, credential: REGISTER.credential },
      'login-1',
    );

    // Both deliveries still get a fresh reply — the reply itself is unguarded.
    expect(context.publisher.replies).toHaveLength(2);
    expect(context.publisher.replies.at(-1)?.payload).toMatchObject({ activationPending: true });

    // The redelivery must not have issued a third link, which would have
    // invalidated the one the first delivery just handed the customer.
    const afterRedelivery = context.publisher.published.filter(
      (message) => message.messageType === 'customer.activation.requested.v1',
    );
    expect(afterRedelivery).toEqual(afterFirstDelivery);
  });

  it('does re-issue the link for a genuinely new sign-in attempt', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.authenticate.execute(
      { email: REGISTER.email, credential: REGISTER.credential },
      'login-1',
    );
    await context.authenticate.execute(
      { email: REGISTER.email, credential: REGISTER.credential },
      'login-2',
    );

    // One per distinct login attempt.
    expect(
      context.publisher.published.filter(
        (message) => message.messageType === 'customer.activation.requested.v1',
      ),
    ).toHaveLength(2);
  });
});

describe('validating an identity again', () => {
  it('accepts a new photo after a rejection and publishes the verdict', async () => {
    const context = build(null);
    await context.register.execute(REGISTER, 'key-1');

    const bytes = Buffer.from('a better photograph');
    context.documents.setBytes(bytes);

    await context.validateIdentity.execute(
      {
        customerId: REGISTER.customerId,
        photo: {
          objectKey: 'better.jpg',
          contentType: 'image/jpeg',
          sizeBytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      },
      'key-identity',
    );

    expect(context.repository.customers.get(REGISTER.customerId)!.identityStatus).toBe('VALIDATED');
    expect(context.publisher.typesPublished()).toContain('customer.identity.validated.v1');
  });

  it('does nothing when the same validation command arrives twice', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    const before = context.publisher.published.length;

    const command = {
      customerId: REGISTER.customerId,
      photo: REGISTER.photo!,
    };

    await context.validateIdentity.execute(command, 'key-identity');
    const afterFirst = context.publisher.published.length;
    expect(afterFirst).toBe(before + 1);

    await context.validateIdentity.execute(command, 'key-identity');
    expect(context.publisher.published.length).toBe(afterFirst);
  });
});

describe('the teller registers a KYC verdict (Fase 2, T-26)', () => {
  const STAFF = { role: 'CAJERO_RECEPTOR' as const, customerId: '22222222-2222-4222-8222-222222222222' };

  it('lets staff verify a pending customer, publishing the verified event', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'VERIFIED' },
      STAFF,
      'key-kyc-1',
    );

    expect(context.repository.customers.get(REGISTER.customerId)!.kycStatus).toBe('VERIFIED');
    expect(context.publisher.payloadOf('customer.kyc.verified.v1')).toMatchObject({
      customerId: REGISTER.customerId,
      kycStatus: 'VERIFIED',
    });
  });

  it('lets staff reject it, publishing the rejected event', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'REJECTED' },
      STAFF,
      'key-kyc-1',
    );

    expect(context.repository.customers.get(REGISTER.customerId)!.kycStatus).toBe('REJECTED');
    expect(context.publisher.payloadOf('customer.kyc.rejected.v1')).toMatchObject({
      kycStatus: 'REJECTED',
    });
  });

  it('refuses a CLIENTE, publishing nothing and changing nothing', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    const before = context.publisher.published.length;

    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'VERIFIED' },
      { role: 'CLIENTE', customerId: REGISTER.customerId },
      'key-kyc-1',
    );

    expect(context.publisher.published).toHaveLength(before);
    expect(context.repository.customers.get(REGISTER.customerId)!.kycStatus).toBe('PENDING');
  });

  it('does nothing when the same verdict command arrives twice (idempotency)', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');
    const before = context.publisher.published.length;

    const command = { customerId: REGISTER.customerId, status: 'VERIFIED' as const };

    await context.setKycStatus.execute(command, STAFF, 'key-kyc-1');
    const afterFirst = context.publisher.published.length;
    expect(afterFirst).toBe(before + 1);

    await context.setKycStatus.execute(command, STAFF, 'key-kyc-1');
    expect(context.publisher.published.length).toBe(afterFirst);
  });

  it('records a re-opened rejection as a no-op that publishes nothing (VERIFIED is terminal)', async () => {
    const context = build();
    await context.register.execute(REGISTER, 'key-1');

    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'VERIFIED' },
      STAFF,
      'key-kyc-1',
    );
    const afterVerified = context.publisher.published.length;

    await context.setKycStatus.execute(
      { customerId: REGISTER.customerId, status: 'REJECTED' },
      STAFF,
      'key-kyc-2',
    );

    expect(context.publisher.published.length).toBe(afterVerified);
    expect(context.repository.customers.get(REGISTER.customerId)!.kycStatus).toBe('VERIFIED');
  });
});
