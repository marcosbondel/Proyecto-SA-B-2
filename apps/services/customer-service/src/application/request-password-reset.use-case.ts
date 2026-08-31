import { customerPasswordResetIssuedV1 } from '@bank/contracts';
import type { CustomerPasswordResetRequestedV1 } from '@bank/contracts';

import { normaliseEmail } from '../domain/customer';
import type { ActivationTokenFactory, Clock, CustomerRepository, EventPublisher } from './ports';

const MESSAGE_TYPE = 'customer.password-reset.requested.v1';

/**
 * One hour, not the activation link's twenty-four.
 *
 * A reset link replaces a credential, and it is requested by somebody sitting
 * at the screen right now — the window only has to cover reading an email, not
 * getting round to it tomorrow. The documented default on
 * `customer.password-reset.issued.v1` is this value.
 */
export const RESET_TTL_MS = 60 * 60 * 1_000;

/**
 * "I forgot my password", answered the same way for every address.
 *
 * This use case **publishes nothing when the address is unknown**, and that
 * asymmetry is the whole design rather than an omission: the Gateway returns
 * `202` either way and the screen says "revisa tu correo" either way, so a
 * stranger typing addresses into the form learns nothing about which of them
 * bank here. The audit record hears the command in both cases — it hears every
 * command — and only the known case produces an event.
 *
 * A password is not changed here and no session is ended. All that happens is
 * that a token starts existing; spending it is `ConfirmPasswordResetUseCase`.
 *
 * A redelivery is answered from the idempotency record rather than by issuing a
 * second token, because issuing invalidates the first — a broker retry would
 * otherwise kill the link in the email the person is about to click.
 */
export class RequestPasswordResetUseCase {
  readonly #repository: CustomerRepository;
  readonly #publisher: EventPublisher;
  readonly #tokens: ActivationTokenFactory;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly repository: CustomerRepository;
    readonly publisher: EventPublisher;
    readonly tokens: ActivationTokenFactory;
    readonly clock: Clock;
  }) {
    this.#repository = dependencies.repository;
    this.#publisher = dependencies.publisher;
    this.#tokens = dependencies.tokens;
    this.#clock = dependencies.clock;
  }

  public async execute(
    command: CustomerPasswordResetRequestedV1,
    idempotencyKey: string,
  ): Promise<void> {
    const seen = await this.#repository.findProcessed(idempotencyKey, MESSAGE_TYPE);

    if (seen !== null) {
      // Nothing to replay: the outcome of this command is an email that was
      // already sent, and sending a second one would be the duplicate the
      // idempotency record exists to prevent.
      return;
    }

    const now = this.#clock.now();
    const found = await this.#repository.findByEmail(normaliseEmail(command.email));

    if (found === null) {
      await this.#repository.recordProcessed({
        idempotencyKey,
        messageType: MESSAGE_TYPE,
        // No address, no customer id: this record must not become a list of
        // which addresses were asked about and which of them exist.
        resultSummary: { outcome: 'IGNORED' },
      });

      return;
    }

    const reset = this.#tokens.issue();
    const expiresAt = new Date(now.getTime() + RESET_TTL_MS).toISOString();

    await this.#repository.savePasswordResetToken({
      customerId: found.customer.customerId,
      tokenHash: reset.tokenHash,
      expiresAt,
    });

    await this.#repository.recordProcessed({
      idempotencyKey,
      messageType: MESSAGE_TYPE,
      resultSummary: { outcome: 'ISSUED', customerId: found.customer.customerId },
    });

    /**
     * The email is triggered by an event, never by an SMTP call from here.
     * Sending mail is Notification & Audit's job, and a service that reached
     * for a mail server would be the direct coupling §4.1 forbids.
     */
    await this.#publisher.publish({
      messageType: customerPasswordResetIssuedV1.name,
      payload: {
        customerId: found.customer.customerId,
        email: found.customer.email,
        expiresAt,
        resetToken: reset.token,
      },
    });
  }
}
