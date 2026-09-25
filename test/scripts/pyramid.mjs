#!/usr/bin/env node
/**
 * Mide la pirámide de pruebas del monorepo y falla si se ha desviado.
 *
 * El problema que resuelve: "tenemos 70/20/10" es una afirmación sobre números
 * que nadie estaba calculando. Contar archivos no sirve — un `it.each` de
 * doscientas filas es un archivo y doscientos casos — así que lo que se cuenta
 * aquí es lo que el runner ejecuta, que es también lo único que un evaluador
 * puede reproducir con un comando.
 *
 * Clasifica por `test/pyramid.manifest.json` y no renombra nada: el criterio es
 * el sufijo `.integration.spec.ts` para lo que cruza un proceso real, `test/e2e/`
 * para lo que atraviesa los siete componentes, y unitaria todo lo demás.
 *
 * Distingue **declarado** de **ejecutado**. Una suite cerrada tras `describe.skip`
 * por falta de `DATABASE_URL` sigue contando para la proporción — las pruebas
 * existen — pero el informe dice cuántas no llegaron a correr, porque un verde
 * que no se ejecutó es la peor clase de verde y este repositorio ya se tropezó
 * con eso una vez (TD-069).
 *
 *   node test/scripts/pyramid.mjs            # mide y falla si hay desvío
 *   node test/scripts/pyramid.mjs --no-fail  # solo informa
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'test', 'pyramid.manifest.json'), 'utf8'));
const FAIL_ON_DEVIATION = !process.argv.includes('--no-fail');

/**
 * En CI la pirámide se mide con la infraestructura en pie, así que una suite de
 * integración que se salta no es una circunstancia: es la medición que no se
 * hizo. Con esta bandera el script lo trata como fallo en vez de informarlo al
 * pie, que es la misma lección que dejó TD-069 — un verde que no se ejecutó es
 * la peor clase de verde.
 */
const REQUIRE_EXECUTED = process.argv.includes('--require-executed');

/** Capa a la que pertenece un archivo de prueba, según el manifiesto. */
function layerOf(relativePath) {
  const normalised = relativePath.split('\\').join('/');

  if (normalised.startsWith('test/e2e/')) return 'e2e';
  if (MANIFEST.integrationFiles.includes(normalised)) return 'integration';
  if (MANIFEST.integrationSuffixes.some((suffix) => normalised.endsWith(suffix))) {
    return 'integration';
  }

  return 'unit';
}

const empty = () => ({
  unit: 0,
  integration: 0,
  e2e: 0,
  skipped: { unit: 0, integration: 0, e2e: 0 },
  files: [],
});

/**
 * Corre Jest pidiéndole el informe en JSON.
 *
 * `--outputFile` en vez de leer stdout a propósito: Jest escribe su resumen por
 * stderr y cualquier `console.warn` de una suite que se salta acaba mezclado con
 * el JSON si se leen juntos.
 */
function collectJest(pkg) {
  const result = empty();
  const scratch = mkdtempSync(join(tmpdir(), 'pyramid-'));
  const reportPath = join(scratch, 'report.json');

  try {
    try {
      execFileSync('npx', ['jest', '--json', '--silent', `--outputFile=${reportPath}`], {
        cwd: join(ROOT, pkg.dir),
        stdio: 'ignore',
      });
    } catch {
      // Una suite en rojo hace salir a Jest con código 1 pero el informe ya está
      // escrito. La pirámide se puede medir igual, y medirla es justamente lo
      // que interesa cuando algo está roto.
    }

    if (!existsSync(reportPath)) {
      throw new Error(`Jest no produjo informe para ${pkg.name}. ¿Está construido el workspace?`);
    }

    const report = JSON.parse(readFileSync(reportPath, 'utf8'));

    for (const suite of report.testResults) {
      const relativePath = relative(ROOT, suite.name).split('\\').join('/');
      const layer = layerOf(relativePath);
      const total = suite.assertionResults.length;
      const notRun = suite.assertionResults.filter((a) => a.status === 'pending').length;

      result[layer] += total;
      result.skipped[layer] += notRun;
      result.files.push({ path: relativePath, layer, cases: total, skipped: notRun });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  return result;
}

/**
 * `apps/web` corre dos runners: el de Node sobre las funciones puras de
 * `app/lib/`, y Vitest sobre el servidor Nitro real cuando exista. Se leen por
 * separado porque son dos capas distintas y un solo número las confundiría.
 */
function collectWeb(pkg) {
  const result = empty();
  const cwd = join(ROOT, pkg.dir);

  // Capa unitaria: `node --test` sobre test/**/*.test.mjs.
  let nodeOutput = '';
  try {
    nodeOutput = execFileSync('node', ['--test', 'test/**/*.test.mjs'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    nodeOutput = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  const tests = /^\u2139 tests (\d+)$/m.exec(nodeOutput);
  const skipped = /^\u2139 skipped (\d+)$/m.exec(nodeOutput);
  result.unit += tests === null ? 0 : Number(tests[1]);
  result.skipped.unit += skipped === null ? 0 : Number(skipped[1]);
  result.files.push({ path: `${pkg.dir}/test/**/*.test.mjs`, layer: 'unit', cases: result.unit });

  // Capa de integración: Vitest contra un Nitro real. Ausente hasta que TD-010
  // se cierre, y entonces el informe dirá 0 — que es la verdad, no un error.
  const vitestConfig = join(cwd, 'vitest.config.ts');
  if (!existsSync(vitestConfig)) {
    result.files.push({ path: `${pkg.dir}/vitest.config.ts`, layer: 'integration', cases: 0, missing: true });

    return result;
  }

  const scratch = mkdtempSync(join(tmpdir(), 'pyramid-web-'));
  const reportPath = join(scratch, 'vitest.json');
  try {
    try {
      execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${reportPath}`], {
        cwd,
        stdio: 'ignore',
      });
    } catch {
      // Mismo motivo que en Jest: el informe existe aunque algo esté en rojo.
    }

    if (existsSync(reportPath)) {
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      for (const suite of report.testResults ?? []) {
        const relativePath = relative(ROOT, suite.name).split('\\').join('/');
        const layer = layerOf(relativePath);
        const total = suite.assertionResults.length;
        const notRun = suite.assertionResults.filter((a) => a.status === 'pending').length;

        result[layer] += total;
        result.skipped[layer] += notRun;
        result.files.push({ path: relativePath, layer, cases: total, skipped: notRun });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  return result;
}

/**
 * El E2E no lo ejecuta este script: necesita los siete contenedores en pie. Lee
 * el informe que deja `test/e2e/run-all.mjs` y dice con todas las letras cuándo
 * no hay ninguno, en vez de reportar cero como si fuera un hecho medido.
 */
function collectE2e() {
  const reportPath = join(ROOT, MANIFEST.e2e.report);

  if (!existsSync(reportPath)) {
    return { cases: 0, stale: true, suites: [], generatedAt: null };
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const suites = report.suites ?? [];

  return {
    cases: suites.reduce((sum, suite) => sum + suite.cases, 0),
    stale: false,
    suites,
    generatedAt: report.generatedAt ?? null,
  };
}

const share = (part, whole) => (whole === 0 ? 0 : (part / whole) * 100);
const pct = (value) => `${value.toFixed(1)} %`;

function main() {
  const packages = [];

  for (const pkg of MANIFEST.packages) {
    process.stderr.write(`  midiendo ${pkg.name}\n`);
    const counts = pkg.runner === 'web' ? collectWeb(pkg) : collectJest(pkg);
    const own = counts.unit + counts.integration;

    packages.push({
      ...pkg,
      ...counts,
      own,
      integrationShare: share(counts.integration, own),
    });
  }

  const e2e = collectE2e();

  // La proporción por app se mide sobre sus pruebas propias: una E2E atraviesa
  // los siete componentes y no pertenece a ninguno, así que repartirla entre
  // ellos sería inventarse una cifra. El objetivo por app es 70:20, es decir
  // que la integración pese un 22.2 % de lo propio.
  const ownIntegrationTarget =
    (MANIFEST.targets.integration / (MANIFEST.targets.unit + MANIFEST.targets.integration)) * 100;

  const apps = packages.filter((p) => p.tier === 'app');
  const systemUnit = apps.reduce((s, p) => s + p.unit, 0);
  const systemIntegration = apps.reduce((s, p) => s + p.integration, 0);
  const systemTotal = systemUnit + systemIntegration + e2e.cases;

  const system = {
    unit: systemUnit,
    integration: systemIntegration,
    e2e: e2e.cases,
    total: systemTotal,
    unitShare: share(systemUnit, systemTotal),
    integrationShare: share(systemIntegration, systemTotal),
    e2eShare: share(e2e.cases, systemTotal),
  };

  const deviations = [];
  for (const pkg of packages) {
    if (pkg.exception !== undefined) continue;
    const delta = Math.abs(pkg.integrationShare - ownIntegrationTarget);
    if (delta > MANIFEST.tolerancePoints) {
      const needed = Math.round((pkg.unit * MANIFEST.targets.integration) / MANIFEST.targets.unit);
      const gap = needed - pkg.integration;
      // Una app puede desviarse por arriba, y entonces el remedio no es quitar
      // integración sino subir la base unitaria: nunca se borra una prueba que
      // cruza un proceso real para cuadrar un porcentaje.
      const remedy =
        gap >= 0
          ? `faltan ${gap} de integración`
          : `sobra integración: sube la base unitaria en ${Math.round((pkg.integration * MANIFEST.targets.unit) / MANIFEST.targets.integration) - pkg.unit} casos`;
      deviations.push(
        `${pkg.name}: integración ${pct(pkg.integrationShare)} de lo propio ` +
          `(objetivo ${pct(ownIntegrationTarget)}) — ${pkg.integration} casos, ${remedy}`,
      );
    }
  }

  if (REQUIRE_EXECUTED) {
    for (const pkg of packages) {
      for (const file of pkg.files) {
        if (file.layer === 'integration' && (file.skipped ?? 0) > 0) {
          deviations.push(
            `${file.path}: ${file.skipped} casos de integración no se ejecutaron — ` +
              'falta DATABASE_URL o RABBITMQ_URL. La pirámide no se midió, se estimó.',
          );
        }
      }
    }
    if (e2e.stale) {
      deviations.push(
        `no hay informe E2E en ${MANIFEST.e2e.report}: levanta el stack y corre test/e2e/run-all.mjs`,
      );
    }
  }

  for (const [layer, target] of Object.entries(MANIFEST.targets)) {
    const actual = system[`${layer}Share`];
    if (Math.abs(actual - target) > MANIFEST.tolerancePoints) {
      deviations.push(`sistema ${layer}: ${pct(actual)} (objetivo ${target} %)`);
    }
  }

  // ── Informe ────────────────────────────────────────────────────────────────
  const lines = [];
  lines.push('# Pirámide de pruebas', '');
  lines.push(`Generado por \`pnpm test:pyramid\` el ${new Date().toISOString()}.`, '');
  lines.push(
    'Integración es la prueba que cruza un proceso real (PostgreSQL, RabbitMQ o',
    'MinIO). Todo lo que corre en proceso con dobles es unitaria. E2E atraviesa los',
    'siete componentes desplegados.',
    '',
  );

  lines.push('## Por paquete', '');
  lines.push('| Paquete | Unitarias | Integración | % integ | Objetivo | Estado |');
  lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
  for (const pkg of packages) {
    const status =
      pkg.exception !== undefined
        ? 'excepción'
        : Math.abs(pkg.integrationShare - ownIntegrationTarget) <= MANIFEST.tolerancePoints
          ? 'ok'
          : 'desviado';
    const target = pkg.exception !== undefined ? '—' : pct(ownIntegrationTarget);
    lines.push(
      `| \`${pkg.name}\` | ${pkg.unit} | ${pkg.integration} | ${pct(pkg.integrationShare)} | ${target} | ${status} |`,
    );
  }

  lines.push('', '## Sistema (las siete apps desplegables)', '');
  lines.push('| Capa | Casos | Real | Objetivo |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push(`| Unitarias | ${system.unit} | ${pct(system.unitShare)} | ${MANIFEST.targets.unit} % |`);
  lines.push(
    `| Integración | ${system.integration} | ${pct(system.integrationShare)} | ${MANIFEST.targets.integration} % |`,
  );
  lines.push(`| E2E | ${system.e2e} | ${pct(system.e2eShare)} | ${MANIFEST.targets.e2e} % |`);
  lines.push(`| **Total** | **${system.total}** | | |`);

  const notRun = packages.reduce(
    (sum, p) => sum + p.skipped.unit + p.skipped.integration + p.skipped.e2e,
    0,
  );
  if (notRun > 0 || e2e.stale) {
    lines.push('', '## Lo que no se ejecutó', '');
    if (notRun > 0) {
      lines.push(
        `${notRun} casos están declarados pero se saltaron en esta corrida — suites`,
        'cerradas tras `describe.skip` por falta de `DATABASE_URL` o `RABBITMQ_URL`.',
        'Cuentan para la proporción porque las pruebas existen; no cuentan como',
        'evidencia de que el comportamiento funciona.',
        '',
      );
      for (const pkg of packages) {
        for (const file of pkg.files) {
          if ((file.skipped ?? 0) > 0) lines.push(`- \`${file.path}\` — ${file.skipped} casos`);
        }
      }
    }
    if (e2e.stale) {
      lines.push(
        '',
        `No hay informe E2E en \`${MANIFEST.e2e.report}\`. El E2E necesita los siete`,
        'contenedores en pie: levanta el stack y corre `node test/e2e/run-all.mjs`.',
      );
    }
  }

  const markdown = `${lines.join('\n')}\n`;
  const outputJson = join(ROOT, MANIFEST.output.json);
  const outputMd = join(ROOT, MANIFEST.output.markdown);
  mkdirSync(dirname(outputJson), { recursive: true });
  writeFileSync(
    outputJson,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), targets: MANIFEST.targets, ownIntegrationTarget, packages, system, e2e, deviations }, null, 2)}\n`,
  );
  writeFileSync(outputMd, markdown);

  process.stdout.write(`\n${markdown}`);
  process.stdout.write(`\nInforme escrito en ${MANIFEST.output.json} y ${MANIFEST.output.markdown}\n`);

  if (deviations.length === 0) {
    process.stdout.write('\nLa pirámide está dentro de la tolerancia.\n');

    return 0;
  }

  process.stdout.write(`\nDesviaciones (${deviations.length}):\n`);
  for (const deviation of deviations) process.stdout.write(`  - ${deviation}\n`);

  return FAIL_ON_DEVIATION ? 1 : 0;
}

process.exitCode = main();
