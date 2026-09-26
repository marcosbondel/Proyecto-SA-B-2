---
name: e2e-suite-entrypoint-breaks-on-spaced-path
description: node test/e2e/suites/*.e2e.mjs silently no-ops in this checkout because of the space in the repo path — fix the entry-point check per-file, don't assume a suite "just works" from its exit code.
metadata:
  type: project
---

Every `test/e2e/suites/*.e2e.mjs` suite (as of the `auth-session.e2e.mjs`
template) guards its standalone entry point with:

```js
if (import.meta.url === `file://${process.argv[1]}`) { ... run() ... }
```

This checkout's absolute path contains a space
(`.../segundo semestre/SA/lab/Proyecto-SA-B-2`). `import.meta.url` percent-encodes
it (`%20`); `file://${process.argv[1]}` does not. The two strings are never
equal, so the `if` is always false — `run()` is never called, nothing is
printed, no report file is written, and `node test/e2e/suites/X.e2e.mjs` exits
**0** having done nothing. It looks like a clean, instant pass if you only
check the exit code — it is not.

**Why:** verified directly — same command against `auth-session.e2e.mjs` (the
template every other suite copies) reproduces the identical silent no-op.
This is a pre-existing, repo-wide defect in the template, not something one
suite introduced.

**How to apply:** before trusting `node test/e2e/suites/*.e2e.mjs`'s exit code
or claiming "0 output = nothing to report", actually check for console output
and for the report file (`docs/qa/pyramid-e2e.json`) being written/updated. A
suite you own can fix its own entry check with a path-based comparison instead
of a URL-string one:
```js
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) { ... }
```
This is safe to do inside a suite file you own without touching the shared
template (`auth-session.e2e.mjs`) or any other suite — each suite's entry
check is local to itself. This is the same space-in-path family of bug as the
one that breaks `pnpm dev:host` restarts (`apps/web/.nuxt` needs deleting
first) — the repo's spaced path is a recurring source of tooling breakage,
worth checking for first whenever a script "does nothing" with no error.
