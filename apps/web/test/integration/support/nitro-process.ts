import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findFreePort } from './ports';

/** `apps/web`, computed from this file's own location rather than `process.cwd()`. */
export const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface NitroHandle {
  readonly baseUrl: string;
  readonly port: number;
  readonly logs: () => string;
  readonly close: () => Promise<void>;
}

/**
 * Boots the **already-built** `.output/server/index.mjs` as its own OS
 * process, with a chosen environment, and waits for `/health` to answer.
 *
 * This deliberately never runs `nuxt build`. The one expensive compile
 * (Tailwind + Nuxt UI through Vite) happens exactly once, in
 * `global-setup.ts`; every server this function starts afterwards reuses that
 * same `.output` directory and only pays for a Node process boot, which is
 * what makes it cheap enough to start a handful of them per env combination a
 * test needs (a different `GATEWAY_URL`, a missing one, and so on).
 */
export async function startNitro(env: Record<string, string | undefined>): Promise<NitroHandle> {
  const port = await findFreePort();
  let output = '';

  const merged: Record<string, string | undefined> = {
    ...process.env,
    ...env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
  };

  // A caller asking for `GATEWAY_URL: undefined` means "this process must not
  // see one" — including this shell's own ambient value, if it happens to
  // have one. `{...process.env, ...env}` alone would leave an `undefined`
  // entry sitting on top of it, and Node's `spawn` does not reliably treat
  // that as "absent" the same way `delete` does, so it is deleted explicitly.
  const childEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }

  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    ['.output/server/index.mjs'],
    {
      cwd: WEB_ROOT,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${String(port)}/`;

  await waitForHealth(baseUrl, child, () => output);

  return {
    baseUrl,
    port,
    logs: () => output,
    close: () =>
      new Promise<void>((resolveClose) => {
        if (child.exitCode !== null || child.killed) {
          resolveClose();
          return;
        }
        child.once('exit', () => {
          resolveClose();
        });
        child.kill('SIGTERM');
      }),
  };
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcessWithoutNullStreams,
  logs: () => string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Nitro process exited with code ${String(child.exitCode)} before becoming healthy.\n${logs()}`,
      );
    }

    try {
      const response = await fetch(new URL('health', baseUrl));

      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  throw new Error(
    `Nitro process at ${baseUrl} never answered /health within ${String(timeoutMs)}ms. Last error: ${String(lastError)}\n${logs()}`,
  );
}
