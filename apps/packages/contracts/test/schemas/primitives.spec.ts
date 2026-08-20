import {
  accountType,
  amountMinor,
  currencyCode,
  idempotencyKey,
  isoTimestamp,
  messageTypeName,
  money,
  producer,
  role,
  sha256Hex,
  uuidV4,
  versionOf,
} from '../../src/schemas/primitives';

/**
 * One accepted value and one rejected value per primitive. The rejected case is
 * the one that matters: a schema that accepts everything is not a schema.
 */
describe('primitives', () => {
  describe('uuidV4', () => {
    it('accepts a version 4 identifier', () => {
      expect(uuidV4.safeParse('0f4b1d3a-9c2e-4a71-b8f5-2d6e7c0a1b93').success).toBe(true);
    });

    it('rejects something that merely looks like one', () => {
      expect(uuidV4.safeParse('0f4b1d3a-9c2e-4a71-b8f5').success).toBe(false);
    });
  });

  describe('isoTimestamp', () => {
    it('accepts a UTC timestamp', () => {
      expect(isoTimestamp.safeParse('2026-08-19T14:32:07.482Z').success).toBe(true);
    });

    it('rejects a timestamp with no zone, which is ambiguous across a process boundary', () => {
      expect(isoTimestamp.safeParse('2026-08-19T14:32:07').success).toBe(false);
    });
  });

  describe('amountMinor', () => {
    it('accepts an integer number of cents', () => {
      expect(amountMinor.safeParse(150_00).success).toBe(true);
    });

    it('rejects a fractional amount, because money is never a float here', () => {
      expect(amountMinor.safeParse(150.55).success).toBe(false);
    });
  });

  describe('currencyCode', () => {
    it('accepts an uppercase ISO-4217 code', () => {
      expect(currencyCode.safeParse('GTQ').success).toBe(true);
    });

    it('rejects a lowercase code', () => {
      expect(currencyCode.safeParse('gtq').success).toBe(false);
    });
  });

  describe('money', () => {
    it('accepts an amount with its currency', () => {
      expect(money.safeParse({ amountMinor: 5_000, currency: 'GTQ' }).success).toBe(true);
    });

    it('rejects an amount with no currency', () => {
      expect(money.safeParse({ amountMinor: 5_000 }).success).toBe(false);
    });
  });

  describe('role', () => {
    it('accepts one of the three roles the assignment defines', () => {
      expect(role.safeParse('CAJERO_RECEPTOR').success).toBe(true);
    });

    it('rejects a role the assignment does not define', () => {
      expect(role.safeParse('AUDITOR').success).toBe(false);
    });
  });

  describe('accountType', () => {
    it('accepts MONETARIA and AHORRO', () => {
      expect(accountType.safeParse('MONETARIA').success).toBe(true);
      expect(accountType.safeParse('AHORRO').success).toBe(true);
    });

    it('rejects a third account type', () => {
      expect(accountType.safeParse('CORRIENTE').success).toBe(false);
    });
  });

  describe('producer', () => {
    it('accepts a known application', () => {
      expect(producer.safeParse('account-service').success).toBe(true);
    });

    it('rejects an unknown producer, which is either misconfiguration or an intruder', () => {
      expect(producer.safeParse('reporting-service').success).toBe(false);
    });
  });

  describe('idempotencyKey', () => {
    it('accepts a bounded client key', () => {
      expect(idempotencyKey.safeParse('transfer-2026-08-19-4471').success).toBe(true);
    });

    it('rejects an empty key, which would make every message "the same intention"', () => {
      expect(idempotencyKey.safeParse('').success).toBe(false);
    });
  });

  describe('messageTypeName', () => {
    it('accepts a name carrying its version suffix', () => {
      expect(messageTypeName.safeParse('account.debit.requested.v1').success).toBe(true);
    });

    it('rejects a name with no version, which could not be routed by version', () => {
      expect(messageTypeName.safeParse('account.debit.requested').success).toBe(false);
    });
  });

  describe('sha256Hex', () => {
    it('accepts 64 lowercase hexadecimal characters', () => {
      expect(sha256Hex.safeParse('a'.repeat(64)).success).toBe(true);
    });

    it('rejects an uppercase digest, so comparison never depends on case', () => {
      expect(sha256Hex.safeParse('A'.repeat(64)).success).toBe(false);
    });
  });

  describe('versionOf', () => {
    it('reads the version out of a message name', () => {
      expect(versionOf('account.debited.v2')).toBe(2);
    });

    it('returns null when there is no suffix to read', () => {
      expect(versionOf('account.debited')).toBeNull();
    });
  });
});
