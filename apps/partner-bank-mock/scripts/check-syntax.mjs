/**
 * `node --check` sobre cada módulo del mock.
 *
 * `node --check server.mjs` sólo mira un archivo y no sigue los `import`, así
 * que con el mock repartido en `src/` dejaría sin revisar casi todo el código.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'server.mjs',
  ...readdirSync(join(root, 'src'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join('src', name)),
];

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
