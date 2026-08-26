import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { customerAuthenticateRepliedV1 } from '@bank/contracts';

import { GatewayError } from '../src/application/errors/gateway-error';
import { AuthController } from '../src/interfaces/auth.controller';
import { buildHarness } from './support/harness';
import type { Harness } from './support/harness';

/**
 * A password that is easy to find and impossible to mistake for anything else.
 * If this string appears in any byte the process wrote, the test knows.
 */
const SECRET = 'Tr4buco-Marmota-Zafiro-9182734';

const CREDENTIALS = { email: 'ana@example.com', credential: SECRET };

const APPROVED = {
  outcome: 'APPROVED' as const,
  claims: {
    customerId: '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93',
    username: 'ana.lopez',
    role: 'CLIENTE' as const,
  },
  activationPending: false,
};

/**
 * The credential is the one value in this system that has no legitimate reason
 * to be written down anywhere, and logging is how it usually escapes: not
 * through a deliberate `log(password)`, but inside a serialised request object
 * or an error message that happened to include the body.
 *
 * So this test does not check the code. It checks the **output**, on every
 * outcome the route has, by capturing everything written to the process's
 * streams and to Nest's logger.
 */
describe('the sign-in credential never reaches a log', () => {
  let harness: Harness;
  let app: INestApplication;
  let written: string[];
  let restore: (() => void)[];

  beforeEach(async () => {
    harness = await buildHarness([AuthController]);
    app = harness.app;

    written = [];
    restore = [];

    for (const stream of [process.stdout, process.stderr] as const) {
      const original = stream.write.bind(stream);
      const spy = jest
        .spyOn(stream, 'write')
        .mockImplementation((chunk: string | Uint8Array, ...rest: unknown[]) => {
          written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
          void original;
          void rest;
          return true;
        });
      restore.push(() => spy.mockRestore());
    }

    for (const method of ['log', 'warn', 'error', 'debug'] as const) {
      const spy = jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(args.map((value) => String(value)).join(' '));
      });
      restore.push(() => spy.mockRestore());
    }
  });

  afterEach(async () => {
    for (const undo of restore) {
      undo();
    }

    await app.close();
  });

  function everythingWritten(): string {
    return written.join('\n');
  }

  it.each([
    ['an approved sign-in', APPROVED],
    ['a rejected credential', { outcome: 'REJECTED' as const, reason: 'INVALID_CREDENTIALS' as const }],
    ['an unactivated account', { ...APPROVED, activationPending: true }],
    ['a reply nobody can parse', { outcome: 'MAYBE' }],
  ])('stays out of the log after %s', async (_case, payload) => {
    harness.replier.answerWith(customerAuthenticateRepliedV1.name, payload);

    await request(app.getHttpServer()).post('/api/auth/login').send(CREDENTIALS);

    expect(everythingWritten()).not.toContain(SECRET);
  });

  it('stays out of the log when nobody answers', async () => {
    harness.replier.staySilent();

    await request(app.getHttpServer()).post('/api/auth/login').send(CREDENTIALS);

    expect(everythingWritten()).not.toContain(SECRET);
  });

  it('stays out of the log when the broker refuses the message', async () => {
    harness.publisher.failWith = GatewayError.brokerUnavailable();

    await request(app.getHttpServer()).post('/api/auth/login').send(CREDENTIALS);

    expect(everythingWritten()).not.toContain(SECRET);
  });

  /**
   * The response is a log of its own — one the caller keeps. Echoing the
   * credential back would put it in browser history, proxy caches and any
   * screenshot of a failed request.
   */
  it('is never echoed back in the response either', async () => {
    harness.replier.answerWith(customerAuthenticateRepliedV1.name, APPROVED);

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(CREDENTIALS);

    expect(JSON.stringify(response.body)).not.toContain(SECRET);
  });
});
