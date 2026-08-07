---
description: Start a new spec — allocate the number, scaffold the directory, and delegate spec.md to product-mvp.
argument-hint: <what you want to build>
---

Start a new spec for: **$ARGUMENTS**

## 1. Allocate and scaffold

```sh
./scripts/agent-checks/spec-state.sh next-id
```

Pick a short kebab-case slug from the request. Create `specs/<NNN>-<slug>/`,
copy `docs/templates/spec/state.yaml` into it, and fill `id`, `slug`, `title`,
`type`, and `created` (today's date). Leave `phase: specify` and every gate at
`pending` — you do not approve your own work.

Choose `type` deliberately; it decides how much of `spec.md` is required. The
table is in [specs/README.md](../../specs/README.md). If the request is
internal restructuring, it is `refactor`, not `feature` — do not invent a user
story for it.

## 2. Delegate the spec

Invoke the `product-mvp` agent. It starts with an empty context, so the
invocation must carry:

- The user's request, verbatim.
- The spec directory path and the template at `docs/templates/spec/spec.md`.
- The `type` you chose and what that means for required sections.
- Any constraint from this conversation that is not written down anywhere.

`product-mvp` can only write `spec.md` in that directory — the hook enforces it.

## 3. Report back

State the spec path, the acceptance criteria it produced, and — most
importantly — the open questions and assumptions it could not resolve. Those
are what the human is being asked to judge.

Then stop. Do not plan, and do not write code. The next step belongs to a
human:

```
/spec-approve <NNN> spec
```
