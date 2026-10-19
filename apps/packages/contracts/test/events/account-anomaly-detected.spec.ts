import { QUEUES, catalogByName, destinationFor, routingKeyFor } from '../../src';
import { accountAnomalyDetectedV1 } from '../../src/events/account/account.anomaly.detected.v1';

/**
 * T-42's contract, written first so T-45 can consume it without waiting for the
 * detector. What matters here is what the event *can* say and what it can
 * never say: it names the rule that fired and the numbers behind it, and it has
 * no field a person's data could travel in.
 */

const VALID = {
  accountId: '8b7e5d21-9c2e-4a71-b8f5-2d6e7c0a1b93',
  customerId: '1d4c9f60-9c2e-4a71-b8f5-2d6e7c0a1b93',
  accountType: 'AHORRO',
  rule: 'HIGH_FREQUENCY',
  operationCount: 11,
  threshold: 10,
  windowMinutes: 5,
  windowStart: '2026-10-04T15:55:00.000Z',
  detectedAt: '2026-10-04T16:00:00.000Z',
} as const;

describe('account.anomaly.detected.v1', () => {
  describe('what it is', () => {
    it('is an event Account Service publishes and Notification & Audit consumes', () => {
      expect(accountAnomalyDetectedV1.category).toBe('event');
      expect(accountAnomalyDetectedV1.producer).toBe('account-service');
      expect(accountAnomalyDetectedV1.consumers).toEqual(['notification-audit-service']);
    });

    it('is in the catalogue under the name the repository gives every message', () => {
      expect(catalogByName.get('account.anomaly.detected.v1')).toBe(accountAnomalyDetectedV1);
    });

    it('goes out on the events exchange, and reaches the audit queue without a new binding', () => {
      expect(routingKeyFor('account.anomaly.detected.v1')).toBe('account.anomaly.detected.v1');
      expect(destinationFor(accountAnomalyDetectedV1).exchange).toBe('bank.events');

      // `audit.account` listens to `account.#`; a name outside it would never be audited.
      const audit = QUEUES.find((queue) => queue.name === 'audit.account');
      expect(audit?.bindings.map((binding) => binding.pattern)).toContain('account.#');
    });
  });

  describe('what it accepts', () => {
    it('accepts a complete payload', () => {
      expect(accountAnomalyDetectedV1.schema.safeParse(VALID).success).toBe(true);
    });

    it('accepts it without a customer, which an account may not have in every context', () => {
      const { customerId: _omitted, ...withoutCustomer } = VALID;

      expect(accountAnomalyDetectedV1.schema.safeParse(withoutCustomer).success).toBe(true);
    });

    it('accepts both account types the system has', () => {
      for (const accountType of ['AHORRO', 'MONETARIA']) {
        expect(accountAnomalyDetectedV1.schema.safeParse({ ...VALID, accountType }).success).toBe(
          true,
        );
      }
    });
  });

  describe('what it refuses', () => {
    const refused: readonly (readonly [string, Record<string, unknown>])[] = [
      ['an account that is not a UUID', { accountId: 'cuenta-1' }],
      ['an account type the system does not have', { accountType: 'CORRIENTE' }],
      ['a rule that does not exist', { rule: 'LOW_BALANCE' }],
      ['no operations', { operationCount: 0 }],
      ['a negative count', { operationCount: -3 }],
      ['a fractional count', { operationCount: 10.5 }],
      ['a threshold of zero', { threshold: 0 }],
      ['a window of zero minutes', { windowMinutes: 0 }],
      ['a window that is not a whole number of minutes', { windowMinutes: 2.5 }],
      ['a start that is not a timestamp', { windowStart: 'ayer' }],
      ['a detection time that is not a timestamp', { detectedAt: '2026-10-04' }],
    ];

    it.each(refused)('refuses %s', (_label, override) => {
      expect(accountAnomalyDetectedV1.schema.safeParse({ ...VALID, ...override }).success).toBe(
        false,
      );
    });

    it.each(['accountId', 'accountType', 'rule', 'operationCount', 'threshold', 'windowMinutes'])(
      'refuses a payload without %s',
      (field) => {
        const payload: Record<string, unknown> = { ...VALID };
        delete payload[field];

        expect(accountAnomalyDetectedV1.schema.safeParse(payload).success).toBe(false);
      },
    );
  });

  describe('what it can never carry', () => {
    it('has exactly the fields it documents, and no place for a balance or a person', () => {
      expect(Object.keys(accountAnomalyDetectedV1.schema.shape).sort()).toEqual([
        'accountId',
        'accountType',
        'customerId',
        'detectedAt',
        'operationCount',
        'rule',
        'threshold',
        'windowMinutes',
        'windowStart',
      ]);
    });

    it('drops a field it does not know instead of passing it along', () => {
      const parsed = accountAnomalyDetectedV1.schema.parse({
        ...VALID,
        email: 'maria.lopez@correo.com',
        identityDocument: '2547896320101',
      });

      expect(parsed).not.toHaveProperty('email');
      expect(parsed).not.toHaveProperty('identityDocument');
    });
  });
});
