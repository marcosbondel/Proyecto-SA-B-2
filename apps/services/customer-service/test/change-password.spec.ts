import { createHash } from 'node:crypto';

import type { CustomerRegisterV1, Identity } from '@bank/contracts';

import { ChangePasswordUseCase } from '../src/application/change-password.use-case';
import { RegisterCustomerUseCase } from '../src/application/register-customer.use-case';
import { RequestPasswordResetUseCase } from '../src/application/request-password-reset.use-case';
import {
  FakeHasher,
  FixedClock,
  InMemoryCustomerRepository,
  PredictableTokens,
  RecordingPublisher,
  StubDocumentReader,
} from './support/in-memory';

/**
 * Changing a password from inside a session — `C-01`'s second form.
 *
 * Three properties, and none of them is "it writes a new hash".
 *
 * **A session is not authorisation.** The current password is verified first,
 * because a borrowed unlocked laptop is the common case and the one this
 * defends against.
 *
 * **Staff cannot do it for you.** Not a teller, not an administrator. Editing a
 * customer's address is a service; replacing their credential is taking the
 * account, and the people who need to help somebody locked out have the
 * recovery flow, whose link goes to that customer's own inbox.
 *
 * **A redelivery does not re-verify the old password**, which by then has been
 * replaced — the second attempt would otherwise report a wrong credential for a
 * change that succeeded.
 */

const NOW = new Date('2026-08-30T12:00:00.000Z');
const PHOTO_BYTES = Buffer.from('a pretend jpeg');
const CUSTOMER = '7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';
const STRANGER = '1a2b3c4d-9c2e-4a71-b8f5-2d6e7c0a1b93';

const REGISTER: CustomerRegisterV1 = {
  customerId: CUSTOMER,
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
    sha256: createHash('sha256').update(PHOTO_BYTES).digest('hex'),
  },
};

const OWNER: Identity = { customerId: CUSTOMER, role: 'CLIENTE' };
const ADMIN: Identity = { customerId: STRANGER, role: 'ADMINISTRADOR' };

async function build() {
  const repository = new InMemoryCustomerRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(NOW);
  const tokens = new PredictableTokens();
  const hasher = new FakeHasher();

  const register = new RegisterCustomerUseCase({
    repository,
    publisher,
    hasher,
    tokens,
    documents: new StubDocumentReader(PHOTO_BYTES),
    clock,
  });

  await register.execute(REGISTER, 'register-key');
  publisher.published.length = 0;

  return {
    repository,
    publisher,
    clock,
    change: new ChangePasswordUseCase({ repository, publisher, hasher, clock }),
    request: new RequestPasswordResetUseCase({ repository, publisher, tokens, clock }),
  };
}

const COMMAND = {
  customerId: CUSTOMER,
  currentCredential: REGISTER.credential,
  newCredential: 'una-clave-nueva-larga',
};

describe('changing your own password', () => {
  it('replaces the credential and says so', async () => {
    const context = await build();

    await context.change.execute(COMMAND, OWNER, 'change-1');

    expect(context.publisher.published).toHaveLength(1);
    expect(context.publisher.published[0]!.messageType).toBe('customer.password-changed.v1');
    expect(context.repository.credentials.get(CUSTOMER)).toBe('hashed:una-clave-nueva-larga');
  });

  it('refuses a wrong current password and changes nothing', async () => {
    const context = await build();

    await context.change.execute(
      { ...COMMAND, currentCredential: 'no-es-la-clave' },
      OWNER,
      'change-1',
    );

    const event = context.publisher.published[0]!;

    expect(event.messageType).toBe('customer.password-change.rejected.v1');
    expect((event.payload as { reason: string }).reason).toBe('INVALID_CREDENTIALS');
    expect(context.repository.credentials.get(CUSTOMER)).toBe(`hashed:${REGISTER.credential}`);
  });

  /**
   * A wrong current password is unremarkable once and is the most interesting
   * line in the trail when it appears eleven times in a minute, so the refusal
   * is published rather than swallowed.
   */
  it('publishes the refusal, so the trail can hold it', async () => {
    const context = await build();

    await context.change.execute(
      { ...COMMAND, currentCredential: 'no-es-la-clave' },
      OWNER,
      'change-1',
    );

    expect((context.publisher.published[0]!.payload as { customerId: string }).customerId).toBe(
      CUSTOMER,
    );
  });

  it('repeats the first answer when the command is redelivered', async () => {
    const context = await build();

    await context.change.execute(COMMAND, OWNER, 'change-1');
    context.publisher.published.length = 0;

    // The old password no longer verifies; without the idempotency guard this
    // would report INVALID_CREDENTIALS for a change that succeeded.
    await context.change.execute(COMMAND, OWNER, 'change-1');

    expect(context.publisher.published).toHaveLength(1);
    expect(context.publisher.published[0]!.messageType).toBe('customer.password-changed.v1');
  });

  it('never puts either credential in what it publishes', async () => {
    const context = await build();

    await context.change.execute(COMMAND, OWNER, 'change-1');

    const said = JSON.stringify(context.publisher.published);

    expect(said).not.toContain(REGISTER.credential);
    expect(said).not.toContain(COMMAND.newCredential);
  });

  /**
   * Somebody who has just proved they know the current password does not need
   * a reset link, and a live one in an inbox is exactly what an attacker who
   * asked for it is waiting on.
   */
  it('kills any outstanding reset link', async () => {
    const context = await build();

    await context.request.execute({ email: REGISTER.email }, 'ask-1');
    context.publisher.published.length = 0;

    await context.change.execute(COMMAND, OWNER, 'change-1');

    expect(
      [...context.repository.resetTokens.values()].every((token) => token.usedAt !== null),
    ).toBe(true);
  });
});

describe('changing somebody else’s password', () => {
  it.each([
    ['an administrator', ADMIN],
    ['another client', { customerId: STRANGER, role: 'CLIENTE' } as Identity],
    ['a teller', { customerId: STRANGER, role: 'CAJERO_RECEPTOR' } as Identity],
    ['nobody at all', null],
  ])('is refused for %s', async (_who, actor) => {
    const context = await build();

    await context.change.execute(COMMAND, actor, 'change-1');

    const event = context.publisher.published[0]!;

    expect(event.messageType).toBe('customer.password-change.rejected.v1');
    expect((event.payload as { reason: string }).reason).toBe('FORBIDDEN_ACCOUNT_ACCESS');
    expect(context.repository.credentials.get(CUSTOMER)).toBe(`hashed:${REGISTER.credential}`);
  });

  /** The subject travels on the refusal, so the trail can answer "who was targeted". */
  it('records which account was targeted', async () => {
    const context = await build();

    await context.change.execute(COMMAND, ADMIN, 'change-1');

    expect((context.publisher.published[0]!.payload as { customerId: string }).customerId).toBe(
      CUSTOMER,
    );
  });
});
