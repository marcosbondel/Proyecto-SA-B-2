import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { sampledTraceparent } from '../server/utils/trace-context.ts';

/**
 * The trace context `/interbank/**` hands the Gateway. The trace id must
 * survive (it is what ties a partner bank's half of a transfer to ours) and
 * the result must always be sampled, or the Gateway answers with a trace id
 * Tempo never receives.
 */

const TRACE = '1234567890abcdef1234567890abcdef';
const PARENT = '1111222233334444';

describe('the traceparent the interbank proxy forwards', () => {
  test('keeps a sampled one as it is', () => {
    assert.equal(sampledTraceparent(`00-${TRACE}-${PARENT}-01`), `00-${TRACE}-${PARENT}-01`);
  });

  test('forces an unsampled one to sampled, keeping both ids', () => {
    assert.equal(sampledTraceparent(`00-${TRACE}-${PARENT}-00`), `00-${TRACE}-${PARENT}-01`);
  });

  test('replaces any other flag byte, not only 00', () => {
    assert.equal(sampledTraceparent(`00-${TRACE}-${PARENT}-ff`), `00-${TRACE}-${PARENT}-01`);
  });

  test('lower-cases an upper-case header', () => {
    assert.equal(
      sampledTraceparent(`00-${TRACE.toUpperCase()}-${PARENT}-00`),
      `00-${TRACE}-${PARENT}-01`,
    );
  });

  test('ignores surrounding whitespace', () => {
    assert.equal(sampledTraceparent(`  00-${TRACE}-${PARENT}-01 `), `00-${TRACE}-${PARENT}-01`);
  });

  test('drops an absent header', () => {
    assert.equal(sampledTraceparent(undefined), undefined);
  });

  test('drops a header sent twice', () => {
    assert.equal(sampledTraceparent([`00-${TRACE}-${PARENT}-01`, `00-${TRACE}-${PARENT}-01`]), undefined);
  });

  test('drops garbage', () => {
    assert.equal(sampledTraceparent('not-a-trace'), undefined);
  });

  test('drops a version it does not know', () => {
    assert.equal(sampledTraceparent(`01-${TRACE}-${PARENT}-01`), undefined);
  });

  test('drops a trace id of the wrong length', () => {
    assert.equal(sampledTraceparent(`00-${TRACE.slice(1)}-${PARENT}-01`), undefined);
  });

  test('drops non-hex characters', () => {
    assert.equal(sampledTraceparent(`00-${TRACE.slice(1)}g-${PARENT}-01`), undefined);
  });

  test('drops trailing fields', () => {
    assert.equal(sampledTraceparent(`00-${TRACE}-${PARENT}-01-extra`), undefined);
  });

  test('drops an all-zero trace id, which W3C reserves for "none"', () => {
    assert.equal(sampledTraceparent(`00-${'0'.repeat(32)}-${PARENT}-01`), undefined);
  });

  test('drops an all-zero parent id', () => {
    assert.equal(sampledTraceparent(`00-${TRACE}-${'0'.repeat(16)}-01`), undefined);
  });
});
