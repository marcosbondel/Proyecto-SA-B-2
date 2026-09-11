import { callProvider } from '../src/domain/provider';
import type { PaymentScenario } from '../src/domain/payment';

/**
 * The simulated provider on its own, separate from `decideAttempt`'s ladder —
 * T-29 asks for exactly this split: "un proveedor externo simulado y
 * determinista" that can be exercised without also asserting on retry policy.
 */

const REFERENCE = 'ref-provider-0001';

function ask(scenario: PaymentScenario | null): ReturnType<typeof callProvider> {
  return callProvider({ scenario, reference: REFERENCE });
}

describe('the simulated provider', () => {
  it('approves and carries the reference it was given', () => {
    expect(ask('APPROVE')).toEqual({ result: 'SUCCESS', providerReference: REFERENCE });
  });

  it('treats an absent scenario as approval', () => {
    expect(ask(null)).toEqual({ result: 'SUCCESS', providerReference: REFERENCE });
  });

  it('fails permanently on REJECT', () => {
    expect(ask('REJECT')).toEqual({ result: 'FAILURE', errorType: 'PERMANENT' });
  });

  it('fails transiently on TRANSIENT_FAILURE', () => {
    expect(ask('TRANSIENT_FAILURE')).toEqual({ result: 'FAILURE', errorType: 'TRANSIENT' });
  });

  /** The third external result: no answer at all, and nothing else attached to it. */
  it('gives no answer on TIMEOUT', () => {
    expect(ask('TIMEOUT')).toEqual({ result: 'TIMEOUT' });
  });

  it('is a pure function of its scenario: same input, same answer, every time', () => {
    const scenarios: readonly (PaymentScenario | null)[] = [
      'APPROVE',
      'REJECT',
      'TRANSIENT_FAILURE',
      'TIMEOUT',
      null,
    ];

    for (const scenario of scenarios) {
      const first = ask(scenario);
      const second = ask(scenario);
      const third = ask(scenario);

      expect(second).toEqual(first);
      expect(third).toEqual(first);
    }
  });

  it('never confuses the three results with one another', () => {
    const results = new Set(
      ['APPROVE', 'REJECT', 'TRANSIENT_FAILURE', 'TIMEOUT'].map(
        (scenario) => ask(scenario as PaymentScenario).result,
      ),
    );

    expect(results).toEqual(new Set(['SUCCESS', 'FAILURE', 'TIMEOUT']));
  });
});
