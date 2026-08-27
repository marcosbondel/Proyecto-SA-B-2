import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { ActivationTokenFactory, PasswordHasher } from '../../application/ports';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * scrypt from Node's own crypto, rather than bcrypt or argon2.
 *
 * Both alternatives are native addons that compile on install; scrypt is in the
 * standard library, is memory-hard, and is what the Node documentation
 * recommends for passwords. For a service whose threat model is a stolen
 * database dump, the difference between the three is far smaller than the
 * difference between any of them and a fast hash.
 *
 * The parameters are stored **inside** the encoded hash, so raising the cost
 * later does not invalidate existing passwords: an old hash still says how it
 * was computed.
 */
const PARAMETERS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export class ScryptPasswordHasher implements PasswordHasher {
  public async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const derived = await scryptAsync(plaintext, salt, KEY_LENGTH, PARAMETERS);

    return [
      'scrypt',
      String(PARAMETERS.N),
      String(PARAMETERS.r),
      String(PARAMETERS.p),
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  /**
   * Constant-time, and constant-*work* for a hash it cannot parse.
   *
   * The decoy path exists because this method is called with a fake hash when
   * the email is unknown (see `AuthenticateCustomerUseCase`). Returning early
   * there would make "no such account" measurably faster than "wrong password",
   * which is an enumeration oracle with a stopwatch for a key.
   */
  public async verify(plaintext: string, hash: string): Promise<boolean> {
    const parsed = parse(hash);

    if (parsed === null) {
      await scryptAsync(plaintext, randomBytes(SALT_LENGTH), KEY_LENGTH, PARAMETERS);
      return false;
    }

    const derived = await scryptAsync(plaintext, parsed.salt, parsed.expected.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
    });

    return derived.length === parsed.expected.length && timingSafeEqual(derived, parsed.expected);
  }
}

interface ParsedHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly expected: Buffer;
}

function parse(hash: string): ParsedHash | null {
  const parts = hash.split('$');

  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return null;
  }

  const [, n, r, p, salt, expected] = parts;
  const parameters = [Number(n), Number(r), Number(p)];

  if (parameters.some((value) => !Number.isInteger(value) || value <= 0)) {
    return null;
  }

  return {
    N: parameters[0]!,
    r: parameters[1]!,
    p: parameters[2]!,
    salt: Buffer.from(salt!, 'base64'),
    expected: Buffer.from(expected!, 'base64'),
  };
}

/**
 * The activation token: 256 bits of randomness, stored only as a digest.
 *
 * A plain SHA-256 is right here where it would be wrong for a password. The
 * token is already high-entropy random, so there is nothing to brute-force and
 * nothing a work factor would protect; what matters is that a dump of
 * `email_activation_tokens` cannot be turned back into a working link.
 */
export class RandomActivationTokenFactory implements ActivationTokenFactory {
  public issue(): { readonly token: string; readonly tokenHash: string } {
    // A UUID prefix makes a token recognisable in a URL without weakening it.
    const token = `${randomUUID()}${randomBytes(32).toString('hex')}`;

    return { token, tokenHash: this.digest(token) };
  }

  public digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
