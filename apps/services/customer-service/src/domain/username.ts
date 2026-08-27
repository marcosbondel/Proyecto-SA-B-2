/**
 * The username generation rule, and the reason it is a sequence.
 *
 * The assignment states the username derives from the person's name (§4.1,
 * p. 5) and `docs/domain/entities.md` fixes the rule: normalise, take the given
 * name and the first surname, and on collision append the lowest available
 * numeric suffix starting at `2`.
 *
 * This module produces **candidates**, not an answer. It cannot know which
 * names are taken, and asking it to would put a database query inside a domain
 * rule. The repository walks the sequence inside the same transaction that
 * inserts the customer, so two simultaneous registrations of two people called
 * Juan Pérez cannot both win `juanperez` — the unique index decides, and the
 * loser takes the next candidate. That race is one the assignment calls out
 * explicitly, and it is not defensible to resolve it by reading first and
 * writing second.
 */

/** `customers.username` is `VARCHAR(60)`. */
export const MAX_USERNAME_LENGTH = 60;

/** How many suffixes are tried before the attempt is abandoned. */
export const MAX_USERNAME_CANDIDATES = 100;

/**
 * The base username a full name produces: given name plus first surname.
 *
 * Accents are removed rather than encoded — a username exists to be typed —
 * and everything that is not a letter goes with them. A name that yields
 * nothing at all (punctuation only) falls back to `cliente`, because a
 * registration must not fail on the derivation of a field the person never
 * chose.
 */
export function baseUsernameFor(fullName: string): string {
  const words = fullName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return 'cliente';
  }

  const given = words[0]!;
  /**
   * Three or more words put the surname third: `María Fernanda López García` is
   * one person with two given names far more often than it is somebody whose
   * surname is Fernanda.
   */
  const surname = words.length >= 3 ? words[2] : words[1];

  return `${given}${surname ?? ''}`.slice(0, MAX_USERNAME_LENGTH);
}

/**
 * The candidates to try, in order: `juanperez`, `juanperez2`, `juanperez3`…
 *
 * The suffix is appended after truncating the base, so a very long name still
 * produces a distinct candidate rather than a hundred identical ones.
 */
export function* usernameCandidates(fullName: string): Generator<string> {
  const base = baseUsernameFor(fullName);

  yield base;

  for (let suffix = 2; suffix <= MAX_USERNAME_CANDIDATES; suffix += 1) {
    const digits = String(suffix);
    yield `${base.slice(0, MAX_USERNAME_LENGTH - digits.length)}${digits}`;
  }
}
