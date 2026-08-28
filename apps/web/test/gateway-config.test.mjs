import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { describeGatewayConfig } from '../server/utils/gateway-config.ts';

/**
 * What `/ready` answers with, asserted here rather than through the handler:
 * `apps/web` has no way to run a Nitro route in a test (TD-010), so the
 * decision lives in a pure function and the handler only shapes the response.
 */

describe('the Gateway origin readiness reports on', () => {
  test('accepts the address the container is configured with', () => {
    assert.deepEqual(describeGatewayConfig('http://gateway:3000'), {
      ok: true,
      gateway: 'http://gateway:3000',
    });
  });

  test('normalises to the origin, so a trailing path cannot creep in', () => {
    assert.deepEqual(describeGatewayConfig('https://api.example.gt/v1/'), {
      ok: true,
      gateway: 'https://api.example.gt',
    });
  });

  /**
   * The failure this probe exists for. An empty value produces an interface
   * that renders, offers a login form, and cannot reach anything — up and
   * useless, which is worse than honestly unready.
   */
  test('refuses an empty address', () => {
    const verdict = describeGatewayConfig('');

    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /empty/);
  });

  test('refuses a missing address', () => {
    assert.equal(describeGatewayConfig(undefined).ok, false);
  });

  /**
   * A relative path is the plausible mistake: it works in the dev server behind
   * a proxy and breaks the moment the browser is on a different origin.
   */
  test('refuses a relative path, because the browser resolves this, not the server', () => {
    const verdict = describeGatewayConfig('/api');

    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /absolute/);
  });

  test('refuses a protocol a browser cannot fetch from', () => {
    const verdict = describeGatewayConfig('amqp://rabbitmq:5672');

    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /http/);
  });
});
