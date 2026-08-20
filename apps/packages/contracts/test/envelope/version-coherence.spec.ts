import { createEnvelope } from '../../src/envelope';
import { envelopeSchema } from '../../src/schemas/envelope.schema';

/**
 * FR-005a. The version lives in two places on purpose — the name routes, the
 * field lets a consumer refuse a version it does not understand. The redundancy
 * only buys anything if a disagreement between the two is an error.
 */
describe('version coherence between the name suffix and the envelope field', () => {
  const valid = createEnvelope(
    {},
    { messageType: 'account.debited.v1', producer: 'account-service', identity: null },
  );

  it('accepts an envelope whose suffix and field agree', () => {
    expect(envelopeSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an envelope whose field claims a version its name does not', () => {
    const tampered = { ...valid, messageVersion: 2 };

    const result = envelopeSchema.safeParse(tampered);

    expect(result.success).toBe(false);
  });

  it('rejects an envelope whose name carries no version at all', () => {
    const tampered = { ...valid, messageType: 'account.debited' };

    expect(envelopeSchema.safeParse(tampered).success).toBe(false);
  });
});
