/**
 * Runs every E2E suite under `test/e2e/suites/` against a live stack, in one
 * process, and writes ONE aggregate report.
 *
 * Each suite file is self-contained (`export async function run()` returning
 * `Report.summary()`) and can still be run standalone for a quick loop while
 * writing one; this is the entry point that ties them all together into the
 * single artifact `test/scripts/pyramid.mjs` reads — see `docs/qa/README.md`'s
 * old admission that `happypath.e2e.mjs` and `qa-suite.e2e.mjs` used to write
 * two different shapes to the SAME path and silently clobber each other. There
 * is exactly one report writer now (`test/e2e/support/report.mjs`) and exactly
 * one place that calls it for the whole run: here.
 *
 * Suites run sequentially, not in parallel, on purpose: several of them share
 * mutable state on the live stack (the seeded admin/cajero/cliente accounts,
 * the notification-audit log a suite scrapes for activation links) and Node's
 * `--test`-style parallel runners are not in play here — this is plain
 * top-level `await` over real HTTP/Playwright calls against one stack, so
 * running two suites' browser contexts and gateway calls at once would make a
 * failure hard to attribute to either one.
 *
 *   node test/e2e/run-all.mjs          # pnpm test:e2e:all
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { GW, BASE } from './support/gateway.mjs';
import { writeReport, printSuiteLine } from './support/report.mjs';

const SUITES_DIR = resolve('test/e2e/suites');
const REPORT_PATH = 'docs/qa/pyramid-e2e.json';

/** Fails loudly before a single suite runs rather than 174 cases failing with a connection refused each. */
async function assertStackIsReady() {
  for (const [label, url] of [
    ['gateway', `${GW}/ready`],
    ['web', `${BASE}/ready`],
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== 'ready') {
        throw new Error(`${label} respondió ${res.status}: ${JSON.stringify(body)}`);
      }
    } catch (err) {
      throw new Error(
        `El stack no está listo en ${url} (${label}). ¿Está corriendo 'pnpm dev:host'? Detalle: ${err.message}`,
      );
    }
  }
}

/** `test/e2e/suites/*.e2e.mjs`, alphabetical — deterministic order, no suite named to skip it by accident. */
function discoverSuiteFiles() {
  return readdirSync(SUITES_DIR)
    .filter((f) => f.endsWith('.e2e.mjs'))
    .sort()
    .map((f) => join(SUITES_DIR, f));
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BANK USAC — E2E suite runner');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await assertStackIsReady();

  const files = discoverSuiteFiles();
  if (files.length === 0) {
    throw new Error(`No se encontró ninguna suite en ${SUITES_DIR} (patrón *.e2e.mjs).`);
  }
  console.log(`Suites encontradas (${files.length}):`);
  for (const f of files) console.log(`  - ${f.split('/').slice(-2).join('/')}`);
  console.log('');

  const summaries = [];
  for (const file of files) {
    const suiteLabel = file.split('/').pop();
    console.log(`\n▶ ${suiteLabel}`);
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.run !== 'function') {
      throw new Error(`${suiteLabel} no exporta run() — no puede agregarse al reporte.`);
    }

    /*
     * Una suite que revienta no puede llevarse por delante la medición entera.
     *
     * Antes, cualquier excepción abortaba `main()` y no se escribía el informe:
     * las suites ya ejecutadas perdían su resultado y la pirámide se quedaba
     * con el conteo de la corrida anterior, que es peor que no tener conteo
     * porque parece uno bueno. Y revienta de verdad: `customer-service` muere
     * bajo la carga de esta misma suite (TD-076), así que la primera que pide
     * un login se encuentra un 504 y lanza.
     *
     * Se anota como suite fallida con su motivo y se sigue. Lo que no se hace
     * es esconderlo: `failed` sube, el resumen la marca en rojo y el proceso
     * termina en distinto de cero igual.
     */
    let summary;
    try {
      summary = await mod.run();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ ${suiteLabel} abortó: ${reason}`);
      summary = { name: suiteLabel.replace(/\.e2e\.mjs$/, ''), cases: 1, passed: 0, failed: 1, skipped: 0, aborted: reason };
    }

    printSuiteLine(summary);
    summaries.push(summary);
  }

  const report = writeReport(REPORT_PATH, summaries);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RESUMEN');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const s of report.suites) {
    console.log(
      `  ${s.failed > 0 ? '❌' : '✅'} ${s.name}: ${s.passed}/${s.cases} pasaron` +
        `${s.skipped ? ` (${s.skipped} omitidos)` : ''}`,
    );
  }
  console.log(
    `\n  TOTAL: ${report.totals.passed}/${report.totals.cases} pasaron, ${report.totals.failed} fallaron.`,
  );
  console.log(`  Reporte escrito en ${REPORT_PATH}\n`);

  return report.totals.failed;
}

main()
  .then((failedCount) => {
    process.exit(failedCount > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('\n❌ Error fatal ejecutando la suite E2E:', err);
    process.exit(1);
  });
