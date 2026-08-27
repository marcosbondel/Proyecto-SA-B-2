/**
 * What may be written down, and what may not.
 *
 * This service hears **every event in the system**. That is what makes it
 * useful and it is also what makes it the single most dangerous database in the
 * bank: five services keep personal and financial data apart on purpose
 * (§8.2, 2.3), and a trail that stored every payload verbatim would quietly
 * reassemble all of it in one place that every administrator can read.
 *
 * So the raw payload is never stored. What is stored — and what
 * `audit.query.replied.v1` later carries — is this redaction, computed here,
 * once, before the insert. Redacting at read time instead would mean the
 * unredacted copy exists on disk, and the copy on disk is the one that ends up
 * in a backup.
 *
 * **The rule is a deny-list by field name and it is deliberately blunt.** A
 * name-based rule occasionally hides something harmless; the alternative, an
 * allow-list per contract, is fifty-five lists that have to be updated in
 * lockstep with the catalogue and will not be. When the two failure modes are
 * "the trail is less informative" and "the trail leaked a DPI", blunt is right.
 */

/**
 * Field names whose **value** never reaches the trail.
 *
 * Amounts are on this list, which is a decision rather than an obligation: the
 * money is visible to anyone entitled to see it on the transfer screen itself,
 * so hiding it here costs a reader little and keeps this database from becoming
 * a ledger of what everyone in the bank moved.
 */
const SENSITIVE =
  /credential|password|token|secret|digest|hash|email|document|dpi|fullname|firstname|lastname|surname|address|phone|birth|amount|balance|recipient|photo|objectkey|username/i;

/** What replaces a hidden value. */
const MARKER = '[redactado]';

/**
 * How deep the redaction walks before it stops looking.
 *
 * A depth cap rather than trust: nothing in the catalogue nests four levels
 * deep, so a payload that does is either a mistake or something trying not to
 * be read. Whatever is below the cap is replaced wholesale, never copied
 * unexamined — the one thing this function must never do is pass a value
 * through without having looked at the name above it.
 */
const MAX_DEPTH = 4;

/** How many entries of an array survive. The rest are counted, not copied. */
const MAX_ITEMS = 20;

/**
 * The payload with every sensitive value replaced by a marker.
 *
 * A marker rather than a deletion, because a missing key and a hidden key are
 * different facts: deleting it would tell a reader the producer never sent the
 * field, and "the producer sent no document id" is a very different thing from
 * "we are not showing you the document id".
 *
 * Returns an empty object when there is nothing left worth showing, and the
 * caller decides whether that is worth carrying.
 */
export function redactPayload(payload: unknown): Record<string, unknown> {
  const redacted = redactValue(payload, 0);

  return isPlainObject(redacted) ? redacted : {};
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) {
    return MARKER;
  }

  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ITEMS).map((item) => redactValue(item, depth + 1));

    return value.length > MAX_ITEMS ? [...kept, `[${String(value.length - MAX_ITEMS)} más]`] : kept;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SENSITIVE.test(key) ? MARKER : redactValue(nested, depth + 1),
      ]),
    );
  }

  /*
   * A scalar reached without its name having matched. Strings are capped so a
   * free-text field nobody anticipated cannot turn one audit row into a
   * document; everything else is written as it is.
   */
  return typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a field name would be hidden. Exported so the tests can be explicit. */
export function isSensitiveField(name: string): boolean {
  return SENSITIVE.test(name);
}

export const REDACTION_MARKER = MARKER;
