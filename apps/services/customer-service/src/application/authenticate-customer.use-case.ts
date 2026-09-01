import {
  customerActivationRequestedV1,
  customerAuthenticateRepliedV1,
  customerLoginRejectedV1,
  customerLoginSucceededV1,
} from '@bank/contracts';
import type { CustomerAuthenticateV1 } from '@bank/contracts';

import { canSignIn, normaliseEmail } from '../domain/customer';
import { ACTIVATION_TTL_MS } from './register-customer.use-case';
import type {
  ActivationTokenFactory,
  Clock,
  CustomerRepository,
  EventPublisher,
  PasswordHasher,
} from './ports';

/**
 * A hash of nothing in particular, verified against when the email is unknown.
 *
 * Without it, an unknown address returns in microseconds while a known one
 * costs a full scrypt verification, and the difference is measurable from
 * outside. The endpoint would then answer "does this person bank here?" to
 * anyone with a stopwatch, which is exactly what the single generic rejection
 * exists to prevent.
 */
const TIMING_DECOY = 'decoy';

/**
 * Not a real contract — a private key under which this use case marks its own
 * side effect processed. `saveActivationToken` invalidates every live token
 * before issuing a new one, so a broker redelivery of the same authenticate
 * command must not run it twice: the second run would invalidate the very
 * token the first run just handed to the customer, moments before they open
 * the email carrying it. Scoped to the delivery's own `idempotencyKey`, never
 * the customer's, so a genuinely new sign-in attempt still gets a fresh link.
 */
const ACTIVATION_REISSUE_MESSAGE_TYPE = 'customer.authenticate.activation-reissue';

/**
 * Signing in, and the two ways it can fail that must look identical.
 *
 * An unknown email and a wrong password produce the same `INVALID_CREDENTIALS`,
 * take the same work to compute, and are recorded as the same event. The
 * catalogue is explicit about this: the reply "never distinguishes unknown from
 * wrong".
 *
 * The unverified account is the third case, and it is the one the assignment
 * cares about: "el usuario se activa por medio del primer logging". So a
 * correct password on a `PENDING_ACTIVATION` account **re-issues the activation
 * email** and answers with `activationPending`. The Gateway turns that into the
 * same `401` as the other two, so nothing leaks; what the person gets is a
 * fresh link in their inbox, which is the only useful thing that can happen.
 *
 * The reply itself stays deliberately unguarded — a redelivery must produce a
 * fresh answer, not a silence the Gateway waits out — but re-issuing the
 * activation link is a write, and it is guarded by the delivery's own
 * `idempotencyKey` (see `#requestActivation`), so a redelivery cannot
 * invalidate the token the first delivery just emailed.
 */
export class AuthenticateCustomerUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #hasher: PasswordHasher;
  readonly #tokens: ActivationTokenFactory;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly hasher: PasswordHasher;
    readonly tokens: ActivationTokenFactory;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#hasher = dependencies.hasher;
    this.#tokens = dependencies.tokens;
    this.#clock = dependencies.clock;
  }

  /**
   * Answers the asker, always. A sign-in attempt with no reply would leave the
   * Gateway waiting out its five seconds and reporting a timeout for something
   * this service decided instantly.
   */
  public async execute(command: CustomerAuthenticateV1, idempotencyKey: string): Promise<void> {
    const now = this.#clock.now();
    const found = await this.#repository.findByEmail(normaliseEmail(command.email));

    if (found === null) {
      // Same work, same answer, same event as a wrong password.
      await this.#hasher.verify(command.credential, TIMING_DECOY);
      await this.#reject(now);
      return;
    }

    const correct = await this.#hasher.verify(command.credential, found.credentialHash);

    if (!correct) {
      await this.#reject(now);
      return;
    }

    const { customer } = found;

    if (!canSignIn(customer)) {
      await this.#requestActivation(customer.customerId, customer.email, now, idempotencyKey);

      await this.#publisher.reply({
        messageType: customerAuthenticateRepliedV1.name,
        payload: {
          outcome: 'APPROVED',
          claims: {
            customerId: customer.customerId,
            username: customer.username,
            role: customer.role,
          },
          // The Gateway refuses on this flag. Customer Service reports the
          // fact; it does not decide what a session is worth (ADR-010).
          activationPending: true,
        },
      });
      return;
    }

    await this.#publisher.reply({
      messageType: customerAuthenticateRepliedV1.name,
      payload: {
        outcome: 'APPROVED',
        claims: {
          customerId: customer.customerId,
          username: customer.username,
          role: customer.role,
        },
        activationPending: false,
      },
    });

    await this.#publisher.publish({
      messageType: customerLoginSucceededV1.name,
      payload: {
        customerId: customer.customerId,
        // Every sign-in that gets here has a verified email, so the first one
        // is no longer what triggers the activation mail — it is recorded
        // because the audit record distinguishes a first sign-in from a habit.
        firstLogin: false,
        occurredAt: now.toISOString(),
      },
    });
  }

  /**
   * Issues a fresh link, because the old one may be expired or lost.
   *
   * Guarded by the delivery's own `idempotencyKey` — not by the login as a
   * whole, which stays deliberately unguarded so every delivery gets a fresh
   * reply. A redelivery of the same command finds its marker already recorded
   * and skips straight past the invalidate-then-insert, so the token the first
   * delivery just emailed out stays live.
   */
  async #requestActivation(
    customerId: string,
    email: string,
    now: Date,
    idempotencyKey: string,
  ): Promise<void> {
    if (
      (await this.#repository.findProcessed(idempotencyKey, ACTIVATION_REISSUE_MESSAGE_TYPE)) !==
      null
    ) {
      return;
    }

    const activation = this.#tokens.issue();
    const expiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS).toISOString();

    await this.#repository.saveActivationToken({
      customerId,
      tokenHash: activation.tokenHash,
      expiresAt,
    });

    await this.#repository.recordProcessed({
      idempotencyKey,
      messageType: ACTIVATION_REISSUE_MESSAGE_TYPE,
      resultSummary: { outcome: 'ACTIVATION_REISSUED', customerId },
    });

    await this.#publisher.publish({
      messageType: customerActivationRequestedV1.name,
      payload: { customerId, email, expiresAt, activationToken: activation.token },
    });
  }

  /** The one rejection, carrying no hint about which fact caused it. */
  async #reject(now: Date): Promise<void> {
    await this.#publisher.reply({
      messageType: customerAuthenticateRepliedV1.name,
      payload: { outcome: 'REJECTED', reason: 'INVALID_CREDENTIALS' },
    });

    await this.#publisher.publish({
      messageType: customerLoginRejectedV1.name,
      payload: { reason: 'INVALID_CREDENTIALS', occurredAt: now.toISOString() },
    });
  }
}
