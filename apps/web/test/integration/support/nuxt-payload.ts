/**
 * Pulls `window.__NUXT__.config = {...}` out of a rendered page and returns
 * its **top-level** key names.
 *
 * The blob is not strict JSON — Nuxt serialises it as an executable object
 * literal (unquoted keys), so `JSON.parse` is not an option and `eval`-ing
 * arbitrary server output in a test is not something to do casually. This
 * walks brace depth instead: cheap, and it only needs the top level, which is
 * exactly what "no non-public key" needs to check.
 */
export function topLevelNuxtConfigKeys(html: string): string[] {
  const marker = 'window.__NUXT__.config=';
  const start = html.indexOf(marker);

  if (start === -1) {
    throw new Error('window.__NUXT__.config was not found in the response body');
  }

  const objectStart = start + marker.length;

  if (html[objectStart] !== '{') {
    throw new Error('window.__NUXT__.config is not followed by an object literal');
  }

  let depth = 0;
  let end = objectStart;

  for (let i = objectStart; i < html.length; i += 1) {
    const char = html[i];

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const body = html.slice(objectStart + 1, end);
  const keys: string[] = [];

  // Top-level keys are the ones at depth 0 of the *body* (one level inside the
  // outer braces), each immediately followed by `:`.
  const keyPattern = /(^|[,{])([A-Za-z0-9_$]+):/g;
  let match: RegExpExecArray | null;

  while ((match = keyPattern.exec(body)) !== null) {
    // Depth *at* the key, so the opening brace this match itself consumed (it
    // is `match[1]`, not text that came before the match) has to count too —
    // otherwise the first key of every nested object reads as depth 0.
    const beforeKey = body.slice(0, match.index + match[1].length);
    const opens = (beforeKey.match(/\{/g) ?? []).length;
    const closes = (beforeKey.match(/\}/g) ?? []).length;

    if (opens - closes === 0) {
      keys.push(match[2]);
    }
  }

  return keys;
}
