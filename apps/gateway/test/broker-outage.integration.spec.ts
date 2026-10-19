import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import request from 'supertest';

import { ACCOUNT_ID } from './support/route-fixtures';
import {
  bearerFor,
  buildBrokerHarness,
  closeBrokerHarness,
  fire,
  waitFor,
} from './support/broker-harness';
import type { BrokerHarness } from './support/broker-harness';
import { ServiceDouble } from './support/service-double';

/**
 * What the Gateway does when RabbitMQ goes away and comes back — the failure
 * that, in production on 2026-10-19, took every Gateway pod down within ten
 * seconds (an unhandled `REPLY_TIMEOUT` rejection) and left the public address
 * refusing connections for two minutes.
 *
 * The broker is real; the *network to it* is a small TCP proxy this file owns,
 * so an outage can be started and ended without touching the shared RabbitMQ
 * other suites (and other people) are using. Three states of that proxy:
 *
 * - **blackhole** — the sockets stay open and nothing is forwarded. This is the
 *   nasty one: the client does not yet know the broker is gone, `publish`
 *   neither resolves nor rejects, and the reply ceiling races the publish.
 * - **severed** — the sockets are destroyed and nothing listens. The client
 *   sees the connection drop and retries.
 * - **open** — forwarding again; the client must reconnect on its own.
 */
const RABBITMQ_URL = process.env.RABBITMQ_URL;
const describeBroker = RABBITMQ_URL ? describe : describe.skip;

jest.setTimeout(90_000);

const REPLY_CEILING_MS = 2_000;

class FlakyProxy {
  readonly #target: { host: string; port: number };
  readonly #sockets = new Set<net.Socket>();
  #blackhole = false;
  #server: net.Server | undefined;
  #port = 0;

  constructor(target: { host: string; port: number }) {
    this.#target = target;
  }

  public get port(): number {
    return this.#port;
  }

  public async open(): Promise<void> {
    const server = net.createServer((client) => {
      const upstream = net.connect(this.#target.port, this.#target.host);
      this.#sockets.add(client);
      this.#sockets.add(upstream);

      client.pipe(upstream);
      upstream.pipe(client);

      const drop = (): void => {
        client.destroy();
        upstream.destroy();
        this.#sockets.delete(client);
        this.#sockets.delete(upstream);
      };
      client.on('error', drop);
      upstream.on('error', drop);
      client.on('close', drop);
      upstream.on('close', drop);

      if (this.#blackhole) {
        client.pause();
        upstream.pause();
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.#port, '127.0.0.1', () => {
        resolve();
      });
    });

    this.#server = server;
    this.#port = (server.address() as AddressInfo).port;
  }

  /** Keeps every socket open and stops forwarding in both directions. */
  public blackhole(): void {
    this.#blackhole = true;
    for (const socket of this.#sockets) {
      socket.pause();
    }
  }

  public restoreFlow(): void {
    this.#blackhole = false;
    for (const socket of this.#sockets) {
      socket.resume();
    }
  }

  /** Destroys every connection and stops listening, so the port refuses. */
  public async sever(): Promise<void> {
    this.#blackhole = false;
    for (const socket of this.#sockets) {
      socket.destroy();
    }
    this.#sockets.clear();

    const server = this.#server;
    this.#server = undefined;
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }
}

function proxiedUrl(url: string, proxyPort: number): string {
  const parsed = new URL(url);
  parsed.hostname = '127.0.0.1';
  parsed.port = String(proxyPort);
  return parsed.toString();
}

describeBroker('the Gateway through a broker outage', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  let proxy: FlakyProxy;
  let harness: BrokerHarness;
  let double: ServiceDouble;
  const auth = (): string => bearerFor(harness, 'CLIENTE');

  const balance = (): request.Test =>
    request(harness.app.getHttpServer())
      .get(`/api/accounts/${ACCOUNT_ID}/balance`)
      .set('Authorization', auth());

  const ready = async (): Promise<number> =>
    (await request(harness.app.getHttpServer()).get('/ready')).status;

  beforeAll(async () => {
    if (!RABBITMQ_URL) {
      console.warn('Skipping broker-outage.integration.spec.ts: RABBITMQ_URL is not set.');
      return;
    }

    process.on('unhandledRejection', onUnhandled);

    const target = new URL(RABBITMQ_URL);
    proxy = new FlakyProxy({
      host: target.hostname,
      port: target.port === '' ? 5672 : Number(target.port),
    });
    await proxy.open();

    harness = await buildBrokerHarness({
      rabbitmqUrl: proxiedUrl(RABBITMQ_URL, proxy.port),
      replyTimeoutMs: REPLY_CEILING_MS,
    });
    double = await ServiceDouble.connect(RABBITMQ_URL);
    await double.spyOnEverythingPublished();
  });

  afterAll(async () => {
    if (!RABBITMQ_URL) {
      return;
    }
    process.off('unhandledRejection', onUnhandled);
    await double.close();
    await closeBrokerHarness(harness);
    await proxy.sever();
  });

  it('is ready while the broker is reachable', async () => {
    expect(await ready()).toBe(200);
  });

  it('answers BROKER_UNAVAILABLE before its own ceiling when the broker stops confirming', async () => {
    proxy.blackhole();
    const started = Date.now();

    const response = await balance();
    const elapsed = Date.now() - started;
    proxy.restoreFlow();

    expect(response.status).toBe(503);
    expect(response.body.type).toBe('BROKER_UNAVAILABLE');
    expect(elapsed).toBeLessThan(REPLY_CEILING_MS);
  });

  it('stays alive, unready, and refuses writes at once while the broker is gone', async () => {
    await proxy.sever();

    await waitFor(async () => (await ready()) === 503, 15_000);

    const health = await request(harness.app.getHttpServer()).get('/health');
    expect(health.status).toBe(200);

    const started = Date.now();
    const response = await balance();
    expect(response.status).toBe(503);
    expect(response.body.type).toBe('BROKER_UNAVAILABLE');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('keeps refusing past the reply ceiling without any unhandled rejection', async () => {
    await new Promise((resolve) => setTimeout(resolve, REPLY_CEILING_MS + 500));

    expect((await balance()).status).toBe(503);
    expect(unhandled).toEqual([]);
  });

  it('recovers on its own when the broker returns, and serves again', async () => {
    await proxy.open();

    await waitFor(async () => (await ready()) === 200, 30_000);

    const correlationId = randomUUID();
    const pending = fire(balance().set('X-Correlation-Id', correlationId));

    const cause = await double.waitForEnvelope((e) => e.correlationId === correlationId, 5_000);
    if (cause.envelope === undefined) {
      throw new Error('unreachable: waitForEnvelope only resolves with a parsed envelope');
    }
    await double.reply(cause.envelope, 'account.balance.replied.v1', {
      outcome: 'FOUND',
      accountId: ACCOUNT_ID,
      balance: { amountMinor: 125_000, currency: 'GTQ' },
      status: 'ACTIVE',
      lastActivityAt: '2026-10-19T20:00:00.000Z',
    });

    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.body.balance).toEqual({ amountMinor: 125_000, currency: 'GTQ' });
    expect(unhandled).toEqual([]);
  });
});
