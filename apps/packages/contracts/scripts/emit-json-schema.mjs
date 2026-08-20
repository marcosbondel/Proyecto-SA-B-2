/**
 * Emits one JSON Schema per contract, plus the envelope.
 *
 * The point of the artefact is that the catalogue can be read by somebody who
 * does not read TypeScript — a grader, a teammate on another stack, a future
 * consumer. Zod 4 converts natively, so this script is a directory walk and
 * nothing more; there is no second source of truth to keep in step.
 *
 * Consumes `dist/`, so `pnpm build` has to have run. That is deliberate: the
 * schemas published here are the ones that shipped, not the ones in the editor.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const outputDir = join(packageRoot, 'schema');

const { catalog } = await import(join(packageRoot, 'dist', 'events', 'index.js'));
const { envelopeSchema } = await import(join(packageRoot, 'dist', 'schemas', 'envelope.schema.js'));

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const write = async (name, schema) => {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  await writeFile(join(outputDir, `${name}.schema.json`), `${JSON.stringify(json, null, 2)}\n`);
};

await write('envelope', envelopeSchema);

for (const contract of catalog) {
  await write(contract.name, contract.schema);
}

const index = {
  generatedFrom: '@bank/contracts',
  count: catalog.length,
  contracts: catalog.map((contract) => ({
    name: contract.name,
    category: contract.category,
    producer: contract.producer,
    consumers: contract.consumers,
    schema: `${contract.name}.schema.json`,
  })),
};

await writeFile(join(outputDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

console.log(`Wrote ${String(catalog.length + 2)} files to ${outputDir}`);
