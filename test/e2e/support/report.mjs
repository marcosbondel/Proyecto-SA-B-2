/**
 * One test-result shape, used by every suite and by the aggregator.
 *
 * `happypath.e2e.mjs` and `qa-suite.e2e.mjs` each wrote `docs/qa/qa-test-results.json`
 * in a different shape — one flat (`{ tests: [...] }`), one nested
 * (`{ categories: {...} }`) — to the SAME path, so whichever ran last silently
 * overwrote the other (`docs/qa/README.md` used to admit as much). This module
 * exists so there is exactly one shape from here on.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class Report {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.results = [];
  }

  /**
   * Records one case. `pass` must already be a boolean the caller computed
   * from a real observation — this throws rather than silently coercing a
   * truthy string, because `record(id, ..., 'ok')` is exactly the kind of
   * decoration (a case that reports its own description as its verdict) that
   * cannot fail, and that is the defect this restructuring exists to remove.
   */
  record(id, category, name, expected, actual, pass, detail = '') {
    if (typeof pass !== 'boolean') {
      throw new TypeError(
        `[${this.suiteName}] record(${id}): "pass" must be a boolean computed from a real check, got ${typeof pass} (${JSON.stringify(pass)}). ` +
          'A case that cannot fail is not a test.',
      );
    }
    this.results.push({ id, category, name, expected, actual, pass, detail });
    console.log(`  ${pass ? '✅' : '❌'} [${this.suiteName}] ${id}: ${name}`);
    return pass;
  }

  /** Records a case that was skipped rather than run, with a reason. Counted separately from pass/fail so a SKIP can never masquerade as a PASS. */
  skip(id, category, name, reason) {
    this.results.push({ id, category, name, expected: null, actual: null, pass: null, skipped: true, detail: reason });
    console.log(`  ⏭️  [${this.suiteName}] ${id}: ${name} — SKIPPED (${reason})`);
  }

  summary() {
    const ran = this.results.filter((r) => !r.skipped);
    const passed = ran.filter((r) => r.pass).length;
    const failed = ran.filter((r) => !r.pass).length;
    const skipped = this.results.length - ran.length;
    return { suite: this.suiteName, total: ran.length, passed, failed, skipped, results: this.results };
  }
}

/**
 * Writes the aggregate report `test/e2e/run-all.mjs` produces, in the shape
 * `test/scripts/pyramid.mjs` reads (`{ generatedAt, suites: [{name, cases, passed, failed}] }`),
 * plus the full per-case detail under `tests` for anyone reading the file by hand.
 */
export function writeReport(path, suiteSummaries) {
  const generatedAt = new Date().toISOString();
  const suites = suiteSummaries.map((s) => ({
    name: s.suite,
    cases: s.total,
    passed: s.passed,
    failed: s.failed,
    ...(s.skipped > 0 ? { skipped: s.skipped } : {}),
  }));
  const tests = suiteSummaries.flatMap((s) => s.results.map((r) => ({ suite: s.suite, ...r })));
  const totals = suites.reduce(
    (acc, s) => ({ cases: acc.cases + s.cases, passed: acc.passed + s.passed, failed: acc.failed + s.failed }),
    { cases: 0, passed: 0, failed: 0 },
  );

  const report = { generatedAt, suites, totals, tests };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8');
  return report;
}

/** One line per suite, machine-readable, for a CI log or a human skimming stdout. */
export function printSuiteLine(summary) {
  const { suite, total, passed, failed, skipped } = summary;
  console.log(
    `SUITE ${suite} cases=${total} passed=${passed} failed=${failed}${skipped ? ` skipped=${skipped}` : ''}`,
  );
}
