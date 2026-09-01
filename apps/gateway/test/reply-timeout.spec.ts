import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createEnvelope, accountBalanceRepliedV1 } from '@bank/contracts';
import { ReplyRegistry, ReplyTimeoutError } from '@bank/messaging';

import { AccountsController } from '../src/interfaces/accounts.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

const ACTOR = '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93';
const ACCOUNT = '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93';

describe('when nobody answers', () => {
  let harness: Harness;
  let app: INestApplication;
  let auth: string;

  beforeEach(async () => {
    harness = await buildHarness([AccountsController]);
    app = harness.app;
    auth = `Bearer ${harness.tokens.sign({ customerId: ACTOR, username: 'ana', role: 'CLIENTE' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 504 with the correlation identifier intact', async () => {
    harness.replier.staySilent();
    const mine = '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93';

    const response = await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', auth)
      .set('X-Correlation-Id', mine);

    expect(response.status).toBe(504);
    expect(response.body.type).toBe('REPLY_TIMEOUT');
    expect(response.body.correlationId).toBe(mine);
  });

  /**
   * The wording is load-bearing, but in the opposite direction from a command:
   * a balance lookup started nothing, so there is no "operation" to reassure
   * anyone about. The only honest statement for a read is that nothing changed
   * and it is safe to ask again.
   */
  it('says nothing changed, and that it is safe to ask again', async () => {
    harness.replier.staySilent();

    const response = await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', auth);

    expect(response.body.message).not.toMatch(/NO fue cancelada/);
    expect(response.body.message).toMatch(/no se modificó ningún dato/);
  });

  it('is a different answer from a business rejection', async () => {
    harness.replier.staySilent();
    const timedOut = await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', auth);

    harness.replier.answerWith(accountBalanceRepliedV1.name, {
      outcome: 'NOT_FOUND',
      reason: 'ACCOUNT_NOT_FOUND',
    });
    const rejected = await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', auth);

    expect(timedOut.status).not.toBe(rejected.status);
    expect(timedOut.body.type).not.toBe(rejected.body.type);
  });

  it('still published the question — the request was accepted, just unanswered', async () => {
    harness.replier.staySilent();

    await request(app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT}/balance`)
      .set('Authorization', auth);

    expect(harness.publisher.published).toHaveLength(1);
  });
});

/**
 * The registry is what makes "every wait ends" true, so it is tested directly
 * rather than only through a route.
 *
 * Time is injected. A suite that slept five real seconds per case would take
 * minutes and would be the first thing anyone deleted.
 */
describe('the reply registry', () => {
  function fakeClock(): {
    registry: ReplyRegistry;
    fire: () => void;
  } {
    const timers: (() => void)[] = [];

    const registry = new ReplyRegistry({
      timeoutMs: 5_000,
      setTimeoutFn: ((callback: () => void) => {
        timers.push(callback);
        return timers.length as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as unknown as typeof clearTimeout,
    });

    return {
      registry,
      fire: () => {
        for (const callback of timers.splice(0)) {
          callback();
        }
      },
    };
  }

  it('resolves the waiter whose correlation matches, and nobody else', async () => {
    const { registry } = fakeClock();
    const first = registry.waitFor('corr-1');
    const second = registry.waitFor('corr-2');

    registry.settle(
      createEnvelope(
        { outcome: 'FOUND' },
        {
          messageType: 'account.balance.replied.v1',
          producer: 'account-service',
          identity: null,
          correlationId: 'corr-1',
        },
      ),
    );

    await expect(first).resolves.toMatchObject({ correlationId: 'corr-1' });
    expect(registry.pendingCount).toBe(1);

    registry.abortAll('test over');
    await expect(second).rejects.toThrow();
  });

  /**
   * A reply that outlived its timeout, or one meant for a sibling replica.
   * Both are expected, so both are discarded rather than raised.
   */
  it('discards a reply nobody is waiting for, without failing', () => {
    const { registry } = fakeClock();

    const settled = registry.settle(
      createEnvelope(
        { outcome: 'FOUND' },
        {
          messageType: 'account.balance.replied.v1',
          producer: 'account-service',
          identity: null,
          correlationId: 'nobody-asked',
        },
      ),
    );

    expect(settled).toBe(false);
  });

  it('leaves nothing pending after a thousand waits time out', async () => {
    const { registry, fire } = fakeClock();

    const waits = Array.from({ length: 1_000 }, (_unused, index) =>
      registry.waitFor(`corr-${String(index)}`).catch((error: unknown) => error),
    );

    expect(registry.pendingCount).toBe(1_000);

    fire();
    const outcomes = await Promise.all(waits);

    expect(registry.pendingCount).toBe(0);
    expect(outcomes.every((outcome) => outcome instanceof ReplyTimeoutError)).toBe(true);
  });
});
