import { createServer } from 'node:net';

/**
 * Asks the OS for a free TCP port by binding to port 0 and reading back what
 * it chose, then releasing it immediately.
 *
 * `get-port-please` (what `@nuxt/test-utils` uses internally) is not a direct
 * dependency of this workspace, and pnpm's strict linking refuses to resolve
 * it from `apps/web` even though it sits in the store as a transitive
 * dependency of another package — so this is the ten-line version rather than
 * a phantom import.
 */
export async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();

    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        reject(new Error('could not read back an assigned port'));
        return;
      }

      const { port } = address;

      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolvePort(port);
      });
    });
  });
}
