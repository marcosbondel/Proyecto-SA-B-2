import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The cardinality rule of the telemetry catalogue, made executable.
 *
 * §4.1 of the Fase 3 brief: *"Logs de actividad con el accountId. El detalle
 * por cuenta se consulta en los logs, no como etiqueta de una métrica (evitar
 * alta cardinalidad)"*. §8.3 prices metrics that do not reflect the real system
 * at 50 % of the grade, and a metric with one time series per account stops
 * answering anything long before it is wrong.
 *
 * The system keeps three planes and each identifier lives in exactly one:
 * metrics carry closed sets, spans and logs carry the identifiers. `bank.*.id`
 * therefore exists in the code **and is correct** — as a span attribute and a
 * log field. What must never happen is one of them becoming a metric label.
 *
 * This test is the tripwire for that, and it is deliberately a *unit* test: it
 * reads files, crosses no process, and needs no database — which is where it is
 * cheapest to hear about the problem.
 *
 * Two nets, on purpose:
 *
 * 1. **An allow-list** over the files that create instruments. Every attribute
 *    key an `.add(` or `.record(` call passes must appear in
 *    `docs/sre/telemetry-catalog.md`. A new label fails this test until its row
 *    exists, which is the coupling the catalogue is for.
 * 2. **A deny-list** over every source file of every component, for the rogue
 *    case the first net cannot see: an instrument handed to a file that does
 *    not create one.
 *
 * It lives in `@bank/observability` because the rule is the platform's, not any
 * one service's, and because no service may import another's code — but any of
 * them can be read from disk.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');

/** Where a component's own code lives. The chart, the tests and `dist` are not it. */
const COMPONENT_SOURCES = [
  'apps/gateway/src',
  'apps/packages/messaging/src',
  'apps/packages/observability/src',
  'apps/partner-bank-mock',
  'apps/services/account-service/src',
  'apps/services/customer-service/src',
  'apps/services/notification-audit-service/src',
  'apps/services/payment-service/src',
  'apps/services/transaction-service/src',
];

/**
 * The labels `docs/sre/telemetry-catalog.md` §2 declares. Adding one here
 * without adding its row there is half a change: the row is what records *why*
 * the new label cannot grow without bound.
 */
const CATALOGUED_LABELS = new Set([
  // §2.1 messaging — the closed sets of `@bank/messaging`
  'messaging.system',
  'messaging.operation.name',
  'messaging.destination.name',
  'bank.delivery.outcome',
  'error.type',
  // §2.3 customer
  'result',
  'reason',
  'path',
  // §2.4 account
  'account_type',
  'operation',
  'rule',
  // §2.6 payment provider
  'source',
  'action',
  // §2.8 audit
  'family',
  'severity',
  'outcome',
  'processing',
  'status',
]);

/** A key that names one entity rather than one category. */
const IDENTIFIER_SHAPED = /(^|[._])(id|ids)$|[a-z](Id|Ids)$|(^|[._])(account|customer|transfer|payment|deposit|correlation|message|trace|span|user|session)[._]?(id|ids)$/i;

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

function filesUnder(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist' && entry !== 'test') {
        found.push(...filesUnder(path));
      }
    } else if (path.endsWith('.ts') || path.endsWith('.mjs')) {
      found.push(path);
    }
  }

  return found;
}

/**
 * Comments are stripped before searching, so prose that *names* a forbidden
 * label in order to explain why it is forbidden does not fail the test that
 * forbids it. (This file is full of such prose.)
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const SOURCES: readonly SourceFile[] = COMPONENT_SOURCES.flatMap((relative) => {
  const absolute = join(REPO, relative);

  return filesUnder(absolute).map((path) => ({
    path: path.slice(REPO.length + 1).replace(/\\/g, '/'),
    text: withoutComments(readFileSync(path, 'utf8')),
  }));
});

/** `{ result, source }` and `{ 'error.type': e }` alike, as the keys they declare. */
function keysOf(literal: string): string[] {
  return literal
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0 && !piece.startsWith('...'))
    .map((piece) => {
      const [name] = piece.split(':');

      return (name ?? '').trim().replace(/^['"`]|['"`]$/g, '');
    })
    .filter((name) => name.length > 0);
}

/**
 * The attribute literals of every `.add(` / `.record(` call. Flat by
 * construction — a metric attribute set with a nested object in it would not be
 * a metric attribute set — so one level of braces is the whole grammar.
 */
function metricAttributeKeys(file: SourceFile): string[] {
  return [...file.text.matchAll(/\.(?:add|record)\(\s*[^,()]+,\s*\{([^{}]*)\}/g)].flatMap((match) =>
    keysOf(match[1] ?? ''),
  );
}

describe('metric cardinality against the telemetry catalogue', () => {
  it('finds the instruments it is meant to police', () => {
    const emitters = SOURCES.filter((file) => /createCounter\(|createHistogram\(/.test(file.text));

    // Seven: messaging, plus one telemetry adapter per service and two in
    // payment (the provider and the interbank deposits). A drop to zero would
    // mean this test passes by looking at nothing.
    expect(emitters.length).toBeGreaterThanOrEqual(7);
  });

  it('labels every metric with a key the catalogue declares', () => {
    const emitters = SOURCES.filter(
      (file) =>
        /createCounter\(|createHistogram\(/.test(file.text) || file.path.includes('/telemetry'),
    );

    const uncatalogued = [
      ...new Set(
        emitters.flatMap((file) =>
          metricAttributeKeys(file)
            .filter((key) => !CATALOGUED_LABELS.has(key))
            .map((key) => `${file.path}: ${key}`),
        ),
      ),
    ].sort();

    expect(uncatalogued).toEqual([]);
  });

  it('never labels a metric with an identifier, in any component', () => {
    const offenders = [
      ...new Set(
        SOURCES.flatMap((file) =>
          metricAttributeKeys(file)
            .filter((key) => IDENTIFIER_SHAPED.test(key))
            .map((key) => `${file.path}: ${key}`),
        ),
      ),
    ].sort();

    expect(offenders).toEqual([]);
  });

  it('keeps the named attribute sets of @bank/messaging within the catalogue', () => {
    // The one place that builds its attributes into a `const` before handing
    // them to an instrument, because publish and consume each use theirs twice
    // (a counter and a histogram). The regex above cannot see through a
    // variable, so the declarations are checked directly.
    const messaging = SOURCES.find((file) => file.path.endsWith('messaging/src/telemetry.ts'));

    expect(messaging).toBeDefined();

    const declared = [
      ...(messaging?.text.matchAll(
        /const\s+\w*[Aa]ttributes\s*:\s*Attributes\s*=\s*\{([^{}]*)\}/g,
      ) ?? []),
    ].flatMap((match) => keysOf(match[1] ?? ''));

    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((key) => !CATALOGUED_LABELS.has(key))).toEqual([]);
  });
});
