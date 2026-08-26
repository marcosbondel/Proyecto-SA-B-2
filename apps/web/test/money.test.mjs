import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  MIN_AMOUNT_MINOR,
  amountProblem,
  formatQuetzales,
  toAmountMinor,
  toDecimal,
} from '../app/lib/money.ts';

describe('money as a person reads it', () => {
  test('always shows two decimals and a thousands separator', () => {
    assert.equal(formatQuetzales(125000), 'Q 1,250.00');
    assert.equal(formatQuetzales(100), 'Q 1.00');
    assert.equal(formatQuetzales(1), 'Q 0.01');
    assert.equal(formatQuetzales(0), 'Q 0.00');
  });

  test('keeps the second decimal even when it is a zero', () => {
    // `Q 1,250` next to `Q 1,250.00` in the same column costs the reader a
    // double-take on the one thing they cannot afford to misread.
    assert.equal(formatQuetzales(125000), 'Q 1,250.00');
    assert.equal(formatQuetzales(125050), 'Q 1,250.50');
  });

  test('handles amounts large enough to need two separators', () => {
    assert.equal(formatQuetzales(123456789), 'Q 1,234,567.89');
  });
});

describe('money as the wire wants it', () => {
  test('converts a decimal to an integer of minor units', () => {
    assert.equal(toAmountMinor(1250.0), 125000);
    assert.equal(toAmountMinor(0.01), 1);
  });

  test('rounds once rather than accumulating float error', () => {
    // 19.99 * 100 is 1998.9999999999998 in binary floating point.
    assert.equal(toAmountMinor(19.99), 1999);
    assert.equal(toAmountMinor(0.07), 7);
    // Without the normalisation this lands on 100, losing a centavo.
    assert.equal(toAmountMinor(1.005), 101);
  });

  test('round-trips through the decimal form', () => {
    for (const minor of [1, 7, 999, 125000, 123456789]) {
      assert.equal(toAmountMinor(toDecimal(minor)), minor);
    }
  });
});

describe('what an amount field must refuse', () => {
  test('accepts one centavo, the smallest thing this system moves', () => {
    assert.equal(amountProblem(0.01), null);
    assert.equal(MIN_AMOUNT_MINOR, 1);
  });

  test('refuses zero and anything below a centavo', () => {
    assert.equal(amountProblem(0), 'TOO_SMALL');
    assert.equal(amountProblem(0.004), 'TOO_SMALL');
    assert.equal(amountProblem(-5), 'TOO_SMALL');
  });

  test('refuses more precision than a centavo, rather than rounding it away', () => {
    // Silently rounding somebody's money is not an option. Conversion rounds;
    // validation refuses — and the field runs validation first.
    assert.equal(amountProblem(1.234), 'TOO_PRECISE');
    assert.equal(amountProblem(1.005), 'TOO_PRECISE');
  });

  test('refuses what is not a number at all', () => {
    assert.equal(amountProblem(Number.NaN), 'NOT_A_NUMBER');
    assert.equal(amountProblem(Number.POSITIVE_INFINITY), 'NOT_A_NUMBER');
  });

  test('accepts ordinary amounts', () => {
    for (const amount of [1, 19.99, 1250.5, 123456.78]) {
      assert.equal(amountProblem(amount), null, String(amount));
    }
  });
});
