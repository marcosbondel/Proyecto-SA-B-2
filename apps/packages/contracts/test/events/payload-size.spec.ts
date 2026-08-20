import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalog } from '../../src/events';
import { validSample } from '../support/sample';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const EXAMPLES = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'events', 'examples');

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

/**
 * SC-009a. The cap is what makes the delivery policy uniform: retry and
 * dead-lettering behave the same for every message because no message is
 * orders of magnitude larger than the rest. It is also the reason the
 * identity-document photo travels by reference (ADR-012).
 */
describe('payload size', () => {
  it.each(catalog.map((c) => [c.name, c] as const))('%s stays under 64 KB', (_name, contract) => {
    expect(bytes(validSample(contract.schema))).toBeLessThan(MAX_PAYLOAD_BYTES);
  });

  it.each(['happy-path', 'rejected', 'compensated'])(
    'every message of the %s example stays under 64 KB',
    (example) => {
      const messages = JSON.parse(
        readFileSync(join(EXAMPLES, `${example}.json`), 'utf8'),
      ) as unknown[];

      for (const message of messages) {
        expect(bytes(message)).toBeLessThan(MAX_PAYLOAD_BYTES);
      }
    },
  );
});
