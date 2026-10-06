import { createHash } from 'node:crypto';

import type { CustomerRegisterV1 } from '@bank/contracts';

import { ConfirmPasswordResetUseCase } from '../src/application/confirm-password-reset.use-case';
import { RegisterCustomerUseCase } from '../src/application/register-customer.use-case';
import {
  RequestPasswordResetUseCase,
  RESET_TTL_MS,
} from '../src/application/request-password-reset.use-case';
import {
  FakeHasher,
  FixedClock,
  InMemoryCustomerRepository,
  PredictableTokens,
  RecordingLifecycleTelemetry,
  RecordingPublisher,
  StubDocumentReader,
} from './support/in-memory';

/**
 * Password recovery — the prototype's `P-07`, and the two properties that make
 * it safe rather than merely working.
 *
 * The first is that **an unknown address is indistinguishable from a known
 * one** from outside. The command is accepted, the record says it was handled,
 * and no event is published; the caller is told the same thing either way. A
 * test that only checked the happy path would let a regression turn this route
 * into an account-enumeration oracle without anything going red.
 *
 * The second is that a link is **spent exactly once**, whatever the broker
 * does. At-least-once delivery means the same confirmation can arrive twice,
 * and the second arrival must repeat the first answer rather than reject a link
 * that had just worked.
 */

const NOW = new Date('2026-08-30T12:00:00.000Z');
const PHOTO_BYTES = Buffer.from('a pretend jpeg');

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
    sha256: createHash('sha256').update(PHOTO_BYTES).digest('hex'),
  },
};

function build() {
  const repository = new InMemoryCustomerRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(NOW);
  const tokens = new PredictableTokens();
  const hasher = new FakeHasher();

  return {
    repository,
    publisher,
    clock,
    tokens,
    hasher,
    register: new RegisterCustomerUseCase({
      repository,
      publisher,
      hasher,
      tokens,
      documents: new StubDocumentReader(PHOTO_BYTES),
      clock,
      telemetry: new RecordingLifecycleTelemetry(),
    }),
    request: new RequestPasswordResetUseCase({ repository, publisher, tokens, clock }),
    confirm: new ConfirmPasswordResetUseCase({ repository, publisher, hasher, tokens, clock }),
  };
}

/** Registers the customer and forgets everything the registration published. */
async function withCustomer(context: ReturnType<typeof build>) {
  await context.register.execute(REGISTER, 'register-key');
  context.publisher.published.length = 0;

  return context;
}

describe('asking to recover a password', () => {
  it('issues a link and asks for the email that carries it', async () => {
    const context = await withCustomer(build());

    await context.request.execute({ email: REGISTER.email }, 'ask-1');

    expect(context.publisher.published).toHaveLength(1);

    const event = context.publisher.published[0]!;
    const payload = event.payload as {
      customerId: string;
      email: string;
      expiresAt: string;
      resetToken: string;
    };

    expect(event.messageType).toBe('customer.password-reset.issued.v1');
    expect(payload.customerId).toBe(REGISTER.customerId);
    expect(payload.email).toBe(REGISTER.email);
    expect(payload.resetToken).not.toBe('');
    // One hour, not the activation link's twenty-four.
    expect(new Date(payload.expiresAt).getTime()).toBe(NOW.getTime() + RESET_TTL_MS);
    expect(RESET_TTL_MS).toBe(60 * 60 * 1_000);
  });

  it('stores the digest and never the token itself', async () => {
    const context = await withCustomer(build());

    await context.request.execute({ email: REGISTER.email }, 'ask-1');

    const payload = context.publisher.published[0]!.payload as { resetToken: string };
    const stored = [...context.repository.resetTokens.keys()];

    expect(stored).toHaveLength(1);
    expect(stored).not.toContain(payload.resetToken);
    expect(stored[0]).toBe(context.tokens.digest(payload.resetToken));
  });

  /**
   * The property the whole flow exists to preserve. An address nobody banks
   * with produces no event, no token and no distinguishable behaviour.
   */
  it('says nothing at all about an address it does not know', async () => {
    const context = await withCustomer(build());

    await context.request.execute({ email: 'nobody@correo.com' }, 'ask-1');

    expect(context.publisher.published).toEqual([]);
    expect(context.repository.resetTokens.size).toBe(0);
    // It is still recorded as handled, so a redelivery does no more work.
    expect(
      await context.repository.findProcessed('ask-1', 'customer.password-reset.requested.v1'),
    ).not.toBeNull();
  });

  it('leaves no trace of the address in the idempotency record', async () => {
    const context = await withCustomer(build());

    await context.request.execute({ email: 'nobody@correo.com' }, 'ask-1');

    const record = await context.repository.findProcessed(
      'ask-1',
      'customer.password-reset.requested.v1',
    );

    expect(JSON.stringify(record?.resultSummary)).not.toContain('nobody@correo.com');
  });

  /**
   * A broker retry must not issue a second token: issuing invalidates the
   * first, so the redelivery would kill the link in the inbox the person is
   * about to open.
   */
  it('does not issue a second link when the command is redelivered', async () => {
    const context = await withCustomer(build());

    await context.request.execute({ email: REGISTER.email }, 'ask-1');
    await context.request.execute({ email: REGISTER.email }, 'ask-1');

    expect(context.publisher.published).toHaveLength(1);
    expect(context.repository.resetTokens.size).toBe(1);
  });

  /** Asking twice on purpose is different: the newest link is the only live one. */
  it('kills the previous link when a new one is asked for', async () => {
    const context = await withCustomer(build());

    await context.request.execute({ email: REGISTER.email }, 'ask-1');
    await context.request.execute({ email: REGISTER.email }, 'ask-2');

    const live = [...context.repository.resetTokens.values()].filter(
      (token) => token.usedAt === null,
    );

    expect(context.repository.resetTokens.size).toBe(2);
    expect(live).toHaveLength(1);
  });
});

describe('spending the reset link', () => {
  async function askedFor(context: ReturnType<typeof build>): Promise<string> {
    await context.request.execute({ email: REGISTER.email }, 'ask-1');
    const payload = context.publisher.published[0]!.payload as { resetToken: string };
    context.publisher.published.length = 0;

    return payload.resetToken;
  }

  it('changes the credential and says so', async () => {
    const context = await withCustomer(build());
    const token = await askedFor(context);

    await context.confirm.execute(
      { resetToken: token, credential: 'otra-clave-larga' },
      'spend-1',
    );

    expect(context.publisher.published).toHaveLength(1);
    expect(context.publisher.published[0]!.messageType).toBe(
      'customer.password-reset.completed.v1',
    );
    expect(context.repository.credentials.get(REGISTER.customerId)).toBe(
      'hashed:otra-clave-larga',
    );
  });

  it('leaves the new password stored the way registration stores one', async () => {
    const context = await withCustomer(build());
    const before = context.repository.credentials.get(REGISTER.customerId);
    const token = await askedFor(context);

    await context.confirm.execute(
      { resetToken: token, credential: REGISTER.credential },
      'spend-1',
    );

    // The same plaintext through the same hasher: a password set here is not a
    // weaker way in than one set at sign-up.
    expect(context.repository.credentials.get(REGISTER.customerId)).toBe(before);
  });

  it('burns the link, so the same one cannot be spent twice', async () => {
    const context = await withCustomer(build());
    const token = await askedFor(context);

    await context.confirm.execute({ resetToken: token, credential: 'clave-nueva-1' }, 'spend-1');
    context.publisher.published.length = 0;

    await context.confirm.execute({ resetToken: token, credential: 'clave-nueva-2' }, 'spend-2');

    expect(context.publisher.published[0]!.messageType).toBe(
      'customer.password-reset.rejected.v1',
    );
    expect(context.repository.credentials.get(REGISTER.customerId)).toBe('hashed:clave-nueva-1');
  });

  /** At-least-once delivery: the second arrival repeats the first answer. */
  it('repeats the first answer when the confirmation is redelivered', async () => {
    const context = await withCustomer(build());
    const token = await askedFor(context);

    await context.confirm.execute({ resetToken: token, credential: 'clave-nueva-1' }, 'spend-1');
    context.publisher.published.length = 0;

    await context.confirm.execute({ resetToken: token, credential: 'clave-nueva-1' }, 'spend-1');

    expect(context.publisher.published).toHaveLength(1);
    expect(context.publisher.published[0]!.messageType).toBe(
      'customer.password-reset.completed.v1',
    );
  });

  it('refuses a token it never issued, and changes nothing', async () => {
    const context = await withCustomer(build());

    await context.confirm.execute(
      { resetToken: 'inventado-por-alguien-mas', credential: 'clave-nueva-1' },
      'spend-1',
    );

    const event = context.publisher.published[0]!;

    expect(event.messageType).toBe('customer.password-reset.rejected.v1');
    expect((event.payload as { reason: string }).reason).toBe('RESET_TOKEN_INVALID');
    expect(context.repository.credentials.get(REGISTER.customerId)).toBe(
      `hashed:${REGISTER.credential}`,
    );
  });

  it('refuses a token that has run out of time, and says which it was', async () => {
    const context = await withCustomer(build());
    const token = await askedFor(context);

    context.clock.advanceTo(new Date(NOW.getTime() + RESET_TTL_MS + 1_000));

    await context.confirm.execute({ resetToken: token, credential: 'clave-nueva-1' }, 'spend-1');

    const event = context.publisher.published[0]!;

    expect(event.messageType).toBe('customer.password-reset.rejected.v1');
    // Expired and invalid stay distinct in the event so the audit record can
    // tell them apart; the Gateway is what collapses them into one sentence.
    expect((event.payload as { reason: string }).reason).toBe('RESET_TOKEN_EXPIRED');
  });

  /**
   * Somebody resetting a password may be doing it because their inbox is not
   * theirs alone, so completing the reset must kill every other live link.
   */
  it('kills every other live link for that customer', async () => {
    const context = await withCustomer(build());

    await context.request.execute({ email: REGISTER.email }, 'ask-1');
    const first = (context.publisher.published[0]!.payload as { resetToken: string }).resetToken;

    await context.request.execute({ email: REGISTER.email }, 'ask-2');
    const second = (context.publisher.published[1]!.payload as { resetToken: string }).resetToken;
    context.publisher.published.length = 0;

    await context.confirm.execute({ resetToken: second, credential: 'clave-nueva-1' }, 'spend-1');
    context.publisher.published.length = 0;

    await context.confirm.execute({ resetToken: first, credential: 'clave-nueva-2' }, 'spend-2');

    expect(context.publisher.published[0]!.messageType).toBe(
      'customer.password-reset.rejected.v1',
    );
    expect(
      [...context.repository.resetTokens.values()].every((token) => token.usedAt !== null),
    ).toBe(true);
  });

  it('never puts the token or the credential in what it publishes', async () => {
    const context = await withCustomer(build());
    const token = await askedFor(context);

    await context.confirm.execute({ resetToken: token, credential: 'clave-nueva-1' }, 'spend-1');

    const said = JSON.stringify(context.publisher.published);

    expect(said).not.toContain(token);
    expect(said).not.toContain('clave-nueva-1');
  });
});
