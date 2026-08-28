import { customerRegisterV1, customerUpdateV1 } from '../../src/events';

/**
 * FR-014: a whitespace-only text field must be refused, not stored blank.
 *
 * A blank `identityDocument` would take the UNIQUE slot and block every later
 * registration, and a blank `fullName` on update would erase the stored name.
 * Trimming before the length check turns "   " into "" and fails `min(1)`, and
 * a padded value is stored trimmed.
 */

const REGISTER = {
  customerId: '7f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
  fullName: 'María López',
  identityDocument: '2547896320101',
  email: 'maria@correo.com',
  dateOfBirth: '1996-04-18',
  address: '12 calle 3-45',
  role: 'CLIENTE',
  credential: 'una-clave-larga',
  photo: null,
};

describe('blank text fields are refused (FR-014)', () => {
  it('rejects a whitespace-only name, document, or address on register', () => {
    for (const field of ['fullName', 'identityDocument', 'address']) {
      const result = customerRegisterV1.schema.safeParse({ ...REGISTER, [field]: '   ' });
      expect(result.success).toBe(false);
    }
  });

  it('stores register text fields trimmed', () => {
    const result = customerRegisterV1.schema.safeParse({ ...REGISTER, fullName: '  María López  ' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.fullName).toBe('María López');
  });

  it('rejects a whitespace-only name or address on update', () => {
    expect(
      customerUpdateV1.schema.safeParse({ customerId: REGISTER.customerId, fullName: '   ' }).success,
    ).toBe(false);
    expect(
      customerUpdateV1.schema.safeParse({ customerId: REGISTER.customerId, address: '  ' }).success,
    ).toBe(false);
  });
});
