/**
 * Regenera `src/contract-schemas.json` a partir del contrato oficial.
 *
 *   node scripts/sync-contract.mjs           # escribe el archivo
 *   node scripts/sync-contract.mjs --check   # sale 1 si el archivo no corresponde al contrato
 *
 * Por qué existe: el mock se despliega como un solo proceso de Node sin
 * dependencias, así que no puede leer YAML en tiempo de ejecución. En lugar de
 * copiar los patrones a mano —que es como un mock termina validando contra un
 * contrato que ya no existe—, se genera un JSON con los `components.schemas` del
 * archivo del curso y se verifica en cada prueba que sigue siendo el mismo:
 * guarda el SHA-256 del YAML del que salió.
 *
 * El contrato (`docs/references/interbank-contract-v1.openapi.yaml`) no se toca.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
export const CONTRACT_PATH = resolve(
  here,
  '../../../docs/references/interbank-contract-v1.openapi.yaml',
);
export const SCHEMAS_PATH = resolve(here, '../src/contract-schemas.json');

export function buildSchemasDocument() {
  const yaml = readFileSync(CONTRACT_PATH);
  const document = parse(yaml.toString('utf8'));
  return `${JSON.stringify(
    {
      $comment:
        'GENERADO por scripts/sync-contract.mjs a partir de docs/references/interbank-contract-v1.openapi.yaml. No editar a mano.',
      source: 'docs/references/interbank-contract-v1.openapi.yaml',
      sha256: createHash('sha256').update(yaml).digest('hex'),
      schemas: document.components.schemas,
    },
    null,
    2,
  )}\n`;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = buildSchemasDocument();
  if (process.argv.includes('--check')) {
    const current = readFileSync(SCHEMAS_PATH, 'utf8');
    if (current !== next) {
      process.stderr.write(
        'src/contract-schemas.json no corresponde al contrato. Ejecuta: node scripts/sync-contract.mjs\n',
      );
      process.exit(1);
    }
    process.stdout.write('src/contract-schemas.json corresponde al contrato.\n');
  } else {
    writeFileSync(SCHEMAS_PATH, next);
    process.stdout.write('src/contract-schemas.json regenerado.\n');
  }
}
