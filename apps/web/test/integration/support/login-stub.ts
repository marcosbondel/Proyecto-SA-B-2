import { createServer, type Server } from 'node:http';

import { fakeToken } from './fake-token';
import { findFreePort } from './ports';
import type { Role } from '../../../app/lib/navigation';

export interface LoginStub {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

/**
 * Just enough of the Gateway to make `session-guard.integration.spec.ts`'s
 * one real sign-in round trip honest: it answers `POST /api/auth/login` with
 * a token `app/lib/session.ts#decodeSession` actually accepts, keyed off the
 * email the test submitted through the real form, and answers `200 {}` for
 * anything else so an unrelated `onMounted` fetch elsewhere on the page does
 * not fail the run with a console error.
 *
 * The email-to-role mapping is this file's own fixture, not a Gateway
 * contract — `test.customer.com` addresses map to import roles by the local
 * part before `@`, e.g. `cliente@test.bank`.
 */
export async function startLoginStub(): Promise<LoginStub> {
  const server: Server = createServer((req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/api/auth/login')) {
      let raw = '';

      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on('end', () => {
        const parsed = safeParse(raw);
        const email = typeof parsed?.email === 'string' ? parsed.email : '';
        const role = roleFromEmail(email);

        if (role === null) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              type: 'UNAUTHENTICATED',
              message: 'No pudimos iniciar sesión con esos datos.',
              correlationId: 'test-correlation',
            }),
          );
          return;
        }

        const token = fakeToken({ sub: `customer-${role.toLowerCase()}`, username: email, role });

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ token, expiresIn: 3600, correlationId: 'test-correlation' }));
      });
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });

  const port = await findFreePort();

  await new Promise<void>((resolveListen) => {
    server.listen(port, '127.0.0.1', resolveListen);
  });

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose();
        });
      }),
  };
}

function roleFromEmail(email: string): Role | null {
  const localPart = email.split('@')[0]?.toUpperCase();

  if (localPart === 'CLIENTE' || localPart === 'CAJERO_RECEPTOR' || localPart === 'ADMINISTRADOR') {
    return localPart;
  }

  return null;
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
