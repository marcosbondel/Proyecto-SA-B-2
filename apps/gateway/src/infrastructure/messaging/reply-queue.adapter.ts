import { GATEWAY_REPLY_BINDINGS, gatewayReplyQueueName } from '@bank/contracts';
import type { MessageEnvelope } from '@bank/contracts';
import { ReplyRegistry, ReplyTimeoutError } from '@bank/messaging';
import type { MessageBroker } from '@bank/messaging';

import { GatewayError } from '../../application/errors/gateway-error';
import type { ReplyWaiterPort } from '../../application/ports';

/**
 * This replica's private mailbox for answers.
 *
 * The queue is exclusive because a shared one would be wrong in a way that only
 * shows up under load with more than one replica: the broker would deliver
 * replies round-robin, and the answer to instance A's question would land on
 * instance B, where nobody is waiting for it. The system is deployed to
 * Kubernetes (constitution VII), so more than one replica is the normal case.
 *
 * It also listens for the two outcomes of an email activation. Those are
 * events, not replies, and the gateway does not become their consumer by
 * overhearing them — `notification-audit-service` still receives every one, and
 * `audit.all` is still bound to `#`. What the gateway needs is to correlate one
 * of them with a caller who is holding an HTTP connection open, and a binding
 * on a topic exchange takes nothing away from anybody.
 */
export class ReplyQueueAdapter implements ReplyWaiterPort {
  readonly #broker: MessageBroker;
  readonly #registry: ReplyRegistry;
  readonly #queueName: string;

  constructor(broker: MessageBroker, instanceId: string, timeoutMs: number) {
    this.#broker = broker;
    this.#registry = new ReplyRegistry({ timeoutMs });
    this.#queueName = gatewayReplyQueueName(instanceId);
  }

  /** Visible so the evidence can name the queue it found in the broker. */
  public get queueName(): string {
    return this.#queueName;
  }

  /** How many answers this instance is currently waiting for. Zero at rest. */
  public get pendingCount(): number {
    return this.#registry.pendingCount;
  }

  public async start(): Promise<void> {
    await this.#broker.subscribeExclusive(
      { queue: this.#queueName, bindings: GATEWAY_REPLY_BINDINGS },
      (envelope: MessageEnvelope<unknown>) => {
        // `settle` returns false when nobody was waiting — a reply that
        // outlived its timeout, or one for a sibling replica. Both are
        // expected, so the return value is deliberately ignored.
        this.#registry.settle(envelope);
      },
    );
  }

  public async waitFor(correlationId: string): Promise<MessageEnvelope<unknown>> {
    try {
      return await this.#registry.waitFor(correlationId);
    } catch (error) {
      if (error instanceof ReplyTimeoutError) {
        throw GatewayError.replyTimeout();
      }

      throw GatewayError.internal();
    }
  }

  /**
   * Fails every outstanding wait, so shutdown does not hang on promises whose
   * answers can no longer arrive.
   */
  public stop(): void {
    this.#registry.abortAll('the gateway is shutting down');
  }
}
