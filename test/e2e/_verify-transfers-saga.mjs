import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const mod = await import(pathToFileURL(resolve('test/e2e/suites/transfers-saga.e2e.mjs')).href);
const summary = await mod.run();

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nTOTAL=${summary.total} PASSED=${summary.passed} FAILED=${summary.failed} SKIPPED=${summary.skipped}`);
process.exit(summary.failed > 0 ? 1 : 0);
