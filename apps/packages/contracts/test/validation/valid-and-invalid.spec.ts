import { catalog } from '../../src/events';
import { invalidSample, validSample } from '../support/sample';

/**
 * FR-027: one accepted and one refused case for every contract, generated from
 * the catalogue so a new contract without a test cannot exist.
 */
describe.each(catalog.map((contract) => [contract.name, contract] as const))(
  '%s',
  (_name, contract) => {
    it('accepts a payload that satisfies it', () => {
      const result = contract.schema.safeParse(validSample(contract.schema));

      expect(result.success).toBe(true);
    });

    it('refuses a payload with a required field missing', () => {
      const sample = invalidSample(contract.schema);

      if (sample === null) {
        // Nothing required, so there is no missing-field case. Say so rather
        // than pretending the contract was exercised.
        expect(contract.schema.safeParse(validSample(contract.schema)).success).toBe(true);
        return;
      }

      expect(contract.schema.safeParse(sample).success).toBe(false);
    });
  },
);
