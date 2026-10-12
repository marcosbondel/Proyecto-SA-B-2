import { StructuredLogger, redact } from '../src/interfaces/logging';
import type { LogFields } from '../src/interfaces/logging';

/**
 * `StructuredLogger` and `redact`, checked directly against what they write —
 * not against what their docstring says they do. That distinction matters
 * here specifically: see the last `it` in this file.
 */

function capture(): { logger: StructuredLogger; lines: () => Record<string, unknown>[] } {
  const raw: string[] = [];
  const logger = new StructuredLogger('transaction-service', (line) => raw.push(line));

  return {
    logger,
    lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('StructuredLogger', () => {
  it('names the correlationId and the transactionId on the line, alongside the shared envelope', () => {
    const { logger, lines } = capture();

    logger.info('saga advanced', {
      correlationId: 'corr-1',
      transactionId: 'txn-1',
      status: 'COMPLETED',
    });

    const [line] = lines();
    expect(line).toMatchObject({
      level: 'info',
      serviceName: 'transaction-service',
      message: 'saga advanced',
      correlationId: 'corr-1',
      transactionId: 'txn-1',
      status: 'COMPLETED',
    });
    expect(typeof line?.timestamp).toBe('string');
  });

  it('omits a field that was never provided, rather than writing it as null or undefined', () => {
    const { logger, lines } = capture();

    logger.warn('event for an unknown transaction', { correlationId: 'corr-2' });

    const [line] = lines();
    expect(line).not.toHaveProperty('transactionId');
    expect(line).not.toHaveProperty('reason');
    // T-48: every line now also names its environment and image version — the
    // fields the assignment requires — and the service as `serviceName`.
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ['correlationId', 'environment', 'level', 'message', 'serviceName', 'timestamp', 'version'].sort(),
    );
  });

  it('info, warn and error each stamp their own level and nothing else changes shape', () => {
    const { logger, lines } = capture();

    logger.info('a', {});
    logger.warn('b', {});
    logger.error('c', {});

    const [info, warn, error] = lines();
    expect([info?.level, warn?.level, error?.level]).toEqual(['info', 'warn', 'error']);
  });

  it('does not drop a field by value — a "reason" that mentions "token" survives (name-based, not content-based)', () => {
    // Guardrail on the guardrail: `redact` matches **field names**, not field
    // contents. A value that merely mentions "token" inside an otherwise
    // legitimate field must survive, or the redaction would be silently
    // swallowing real diagnostics rather than protecting a secret.
    const { logger, lines } = capture();

    logger.error('failure', { reason: 'the customer token expired' } as LogFields);

    const [line] = lines();
    expect(line?.reason).toBe('the customer token expired');
  });

  describe('a field literally named for a secret is dropped outright', () => {
    it.each([['apiCredential'], ['DB_PASSWORD'], ['authToken'], ['clientSecret']])(
      'a field named "%s" — embedded, and in whatever case — never reaches the sink',
      (fieldName) => {
        const output = redact({ correlationId: 'corr-3', [fieldName]: 'sk_live_do_not_log' } as LogFields);

        expect(output).not.toHaveProperty(fieldName);
        expect(JSON.stringify(output)).not.toContain('sk_live_do_not_log');
        // The rest of the line is untouched: redaction is field-scoped, not a
        // reason to drop the whole line.
        expect(output.correlationId).toBe('corr-3');
      },
    );
  });

  /**
   * **A real gap, not a hypothetical one.** `redact`'s `FORBIDDEN` pattern is
   * `/credential|password|token|secret/i` — nothing in it, and nothing
   * anywhere else in this file, ever masks or truncates an account number.
   * `LogFields` does not even declare a field for one, which is presumably why
   * no caller in `src/` has logged one yet (checked: no `sourceAccount`,
   * `targetAccount` or `accountId` reaches `StructuredLogger` today). But the
   * type system is the only thing stopping it — `redact` accepts any object
   * shape at runtime — and this test proves the gap directly: an account
   * identifier attached to a log call today would be written in full, with no
   * masking of any kind. If a future change ever threads an account number
   * into `LogFields` (or spreads one in via a wider object, as this test
   * deliberately does), it will leave the sink unmasked. This is reported as a
   * finding, not fixed here — `logging.ts` is production code.
   */
  it('DEFECT: an account number is not masked if it is ever logged — nothing in this module masks one', () => {
    const { logger, lines } = capture();

    logger.info('transfer accepted', {
      correlationId: 'corr-4',
      // `sourceAccount` is not a declared `LogFields` member; the cast is the
      // point — it shows the runtime has no defence even though the type does.
      sourceAccount: '11111111-1111-4111-8111-111111111111',
    } as LogFields);

    const [line] = lines();
    // If masking existed, this would be redacted or truncated. It is neither.
    expect(line?.sourceAccount).toBe('11111111-1111-4111-8111-111111111111');
  });
});
