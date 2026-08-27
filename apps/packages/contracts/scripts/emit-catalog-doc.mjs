/**
 * Regenerates `docs/events/catalog.md`.
 *
 * The field tables are derived from the contracts, so the document cannot drift
 * from the code. The prose that cannot be derived — preconditions, effects and
 * error behaviour — lives beside this script in `catalog-prose.json`, keyed by
 * message name, and a message with no prose entry fails the run rather than
 * being published with an empty section.
 *
 * Run after `pnpm build` and `pnpm schema:emit`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const repoRoot = join(packageRoot, '..', '..', '..');
const schemaDir = join(packageRoot, 'schema');

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const index = await readJson(join(schemaDir, 'index.json'));
const prose = await readJson(join(here, 'catalog-prose.json'));
const byName = new Map(index.contracts.map((c) => [c.name, c]));

const EXCHANGE = { command: 'bank.commands', event: 'bank.events', reply: 'bank.replies' };
const FOLDER = {
  customer: 'customer',
  account: 'account',
  transfer: 'transaction',
  transaction: 'transaction',
  payment: 'payment',
  audit: 'audit',
};

const FLOWS = [
  [
    'Register a customer',
    ['customer.register.v1', 'customer.registered.v1', 'customer.register.rejected.v1'],
  ],
  [
    'Sign in',
    [
      'customer.authenticate.v1',
      'customer.authenticate.replied.v1',
      'customer.login.succeeded.v1',
      'customer.login.rejected.v1',
    ],
  ],
  [
    'Activate by email',
    [
      'customer.activation.requested.v1',
      'customer.verify-email.v1',
      'customer.email.verified.v1',
      'customer.email.verification.rejected.v1',
    ],
  ],
  ['Update customer data', ['customer.update.v1', 'customer.updated.v1']],
  [
    'Validate identity',
    [
      'customer.validate-identity.v1',
      'customer.identity.validated.v1',
      'customer.identity.rejected.v1',
    ],
  ],
  ['Open an account', ['account.create.v1', 'account.opened.v1', 'account.open.rejected.v1']],
  ['Query a balance', ['account.balance.query.v1', 'account.balance.replied.v1']],
  ['List accounts', ['account.list.query.v1', 'account.list.replied.v1']],
  [
    'Read the movements of an account',
    ['account.operations.query.v1', 'account.operations.replied.v1'],
  ],
  ['Account status', ['account.set-status.v1', 'account.deactivated.v1', 'account.reactivated.v1']],
  [
    'Transfer — the Saga',
    [
      'transfer.requested.v1',
      'transaction.initiated.v1',
      'account.debit.requested.v1',
      'account.debited.v1',
      'account.debit.rejected.v1',
      'payment.requested.v1',
      'payment.succeeded.v1',
      'payment.failed.v1',
      'account.credit.requested.v1',
      'account.credited.v1',
      'account.credit.rejected.v1',
      'account.debit.compensation.requested.v1',
      'account.debit.compensated.v1',
      'transaction.completed.v1',
      'transaction.failed.v1',
      'transaction.compensated.v1',
    ],
  ],
  ['Consult a transfer', ['transaction.status.requested.v1', 'transaction.status.replied.v1']],
  ['Consult the audit trail', ['audit.query.requested.v1', 'audit.query.replied.v1']],
];

function typeOf(node) {
  for (const key of ['anyOf', 'oneOf']) {
    if (node[key] !== undefined) return node[key].map(typeOf).join(' \\| ');
  }
  if (node.enum !== undefined) return node.enum.map((v) => `\`${v}\``).join(' \\| ');
  if (node.const !== undefined) return `\`${node.const}\``;
  if (node.type === 'array') return `array of ${typeOf(node.items ?? {})}`;
  if (node.type === 'object') return 'object';
  if (node.format === 'uuid') return 'UUID v4';
  if (node.format === 'date-time') return 'ISO-8601 UTC';
  if (node.format === 'date') return 'ISO-8601 date';
  if (node.format === 'email') return 'email';
  return node.type ?? 'any';
}

function fieldsTable(schema) {
  const union = schema.oneOf ?? schema.anyOf;
  if (union !== undefined && union.some((b) => b.properties !== undefined)) {
    return union
      .map((branch) => {
        const disc = Object.entries(branch.properties ?? {}).find(([, v]) => v.const !== undefined);
        const header =
          disc === undefined ? '**Variant**' : `**When ${disc[0]} = \`${disc[1].const}\`**`;
        return `${header}\n\n${fieldsTable(branch)}`;
      })
      .join('\n\n');
  }

  const props = Object.entries(schema.properties ?? {});
  if (props.length === 0) return '_No fields._';

  const required = new Set(schema.required ?? []);
  return [
    '| Field | Type | Required |',
    '| --- | --- | --- |',
    ...props.map(([k, v]) => `| \`${k}\` | ${typeOf(v)} | ${required.has(k) ? 'yes' : 'no'} |`),
  ].join('\n');
}

const header = await readFile(join(here, 'catalog-preamble.md'), 'utf8');

const indexRows = ['| Message | Category | Producer | Consumers |', '| --- | --- | --- | --- |'];
for (const [, names] of FLOWS) {
  for (const name of names) {
    const c = byName.get(name);
    indexRows.push(`| \`${name}\` | ${c.category} | ${c.producer} | ${c.consumers.join(', ')} |`);
  }
}

if (indexRows.length - 2 !== index.count) {
  throw new Error(
    `Flow listing covers ${String(indexRows.length - 2)} of ${String(index.count)} contracts.`,
  );
}

const parts = [header, indexRows.join('\n'), ''];

for (const [flow, names] of FLOWS) {
  parts.push(`\n---\n\n## ${flow}\n`);

  for (const name of names) {
    const c = byName.get(name);
    const entry = prose[name];
    if (entry === undefined) {
      throw new Error(
        `No prose for "${name}"; every contract needs preconditions, effects and error behaviour.`,
      );
    }

    const [preconditions, effects, onError] = entry;
    const schema = await readJson(join(schemaDir, `${name}.schema.json`));
    const folder = FOLDER[name.split('.')[0]];

    parts.push(`### \`${name}\`

| | |
| --- | --- |
| **Category** | ${c.category} |
| **Producer** | ${c.producer} |
| **Consumers** | ${c.consumers.join(', ')} |
| **Exchange** | \`${EXCHANGE[c.category]}\` |
| **Routing key** | \`${name}\` |
| **Contract** | [\`${name}.ts\`](../../apps/packages/contracts/src/events/${folder}/${name}.ts) |

${fieldsTable(schema)}

**Preconditions.** ${preconditions}

**Effects.** ${effects}

**On error.** ${onError}
`);
  }
}

await writeFile(join(repoRoot, 'docs', 'events', 'catalog.md'), parts.join('\n'));
console.log(`Wrote docs/events/catalog.md from ${String(index.count)} contracts.`);
