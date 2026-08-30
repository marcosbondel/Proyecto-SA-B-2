import { catalog } from '../../src/events';
import { EXCHANGES } from '../../src/routing/routing-keys';
import {
  GATEWAY_REPLY_BINDINGS,
  QUEUES,
  allQueueDeclarations,
  gatewayReplyQueueName,
  matchesTopicPattern,
  queuesFor,
} from '../../src/routing/topology';

/**
 * The Gateway's reply queue is the one queue in this system that must **not**
 * be durable, shared or retried. These tests exist because every one of those
 * three properties is the default, so getting it wrong is the easy mistake.
 */
describe('the gateway reply queue', () => {
  it('is not declared as a durable shared queue', () => {
    const declared = allQueueDeclarations().map((declaration) => declaration.name);

    expect(declared).not.toContain(gatewayReplyQueueName('gw-1'));
    expect(declared.some((name) => name.startsWith('gateway.'))).toBe(false);
  });

  it('is not one of the seven owned work queues', () => {
    expect(QUEUES.some((queue) => queue.owner === 'gateway')).toBe(false);
  });

  /**
   * Two replicas sharing a queue name is the failure this whole design avoids:
   * the broker would round-robin replies, and an answer would reach an instance
   * that never asked the question.
   */
  it('gives each replica a distinct name', () => {
    expect(gatewayReplyQueueName('gw-1')).not.toBe(gatewayReplyQueueName('gw-2'));
  });

  describe('bindings', () => {
    it('receives every reply in the catalogue', () => {
      const replies = catalog.filter((contract) => contract.category === 'reply');
      const replyPattern = GATEWAY_REPLY_BINDINGS.find(
        (binding) => binding.exchange === EXCHANGES.replies,
      );

      expect(replies.length).toBeGreaterThan(0);
      expect(replyPattern).toBeDefined();

      for (const reply of replies) {
        expect(matchesTopicPattern(reply.name, replyPattern!.pattern)).toBe(true);
      }
    });

    /**
     * Four event bindings, two flows, one reason: both end in an event pair
     * rather than a reply, and in both somebody is holding an HTTP connection
     * open waiting to be told which of the two happened.
     */
    it('listens for both outcomes of an email activation and of a password reset', () => {
      const events = GATEWAY_REPLY_BINDINGS.filter(
        (binding) => binding.exchange === EXCHANGES.events,
      ).map((binding) => binding.pattern);

      expect(events).toEqual([
        'customer.email.verified.v1',
        'customer.email.verification.rejected.v1',
        'customer.password-reset.completed.v1',
        'customer.password-reset.rejected.v1',
      ]);
    });

    it('binds to nothing on the command exchange, because it issues commands rather than handling them', () => {
      expect(
        GATEWAY_REPLY_BINDINGS.some((binding) => binding.exchange === EXCHANGES.commands),
      ).toBe(false);
    });
  });

  /**
   * Observing an event to answer a caller must not quietly remove it from the
   * audit trail. If this ever fails, the Gateway started consuming what it was
   * only supposed to overhear.
   */
  describe('what it does not take away', () => {
    it.each(['customer.email.verified.v1', 'customer.email.verification.rejected.v1'])(
      'leaves %s still routed to audit.customer',
      (name) => {
        const contract = catalog.find((entry) => entry.name === name);

        expect(contract).toBeDefined();
        expect(queuesFor(contract!)).toContain('audit.customer');
      },
    );

    it.each(['customer.email.verified.v1', 'customer.email.verification.rejected.v1'])(
      'leaves notification-audit-service as the declared consumer of %s',
      (name) => {
        const contract = catalog.find((entry) => entry.name === name);

        expect(contract!.consumers).toEqual(['notification-audit-service']);
      },
    );
  });
});
