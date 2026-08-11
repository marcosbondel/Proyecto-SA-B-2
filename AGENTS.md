# Agent Guide

Short map for AI agents working in this repository. Durable knowledge lives in
`docs/` — keep this file short and link to deeper docs instead of expanding it.

## Repo Status

`apps/web/` holds a Nuxt 4 application (pnpm, `@nuxt/ui`) scaffolded from the
starter template — it is the only application code so far. `ARCHITECTURE.md` is
still a placeholder: the module boundaries and the rest of the stack have not
been decided or recorded yet.

## Commands

Run from `apps/web/`:

```bash
pnpm install
pnpm dev        # nuxt dev
pnpm build      # nuxt build
pnpm generate   # nuxt generate
pnpm preview    # nuxt preview
```

There is **no test or lint script defined yet** — `package.json` has none, so do
not claim a suite passed. `@nuxt/eslint` is a dependency but has no wired
script. Adding either means adding it to `apps/web/package.json` and recording
it here in the same change.

## Workflow

Spec-driven work runs on **[Spec Kit](https://github.com/github/spec-kit)**
(`speckit`), not on anything in this repository. The previous home-grown
`/spec-*` command set, its state machine, and its enforcement hooks were removed
in favour of it.

Spec Kit is **not initialized yet** — until someone runs its init, there are no
spec commands available and no `specs/` directory. Do not reference `/spec-new`,
`/spec-approve`, `scripts/agent-checks/`, `state.yaml`, or `docs/SPEC_WORKFLOW.md`:
none of them exist any more.

- When Spec Kit is initialized, its own commands and templates define the phase
  order and the artifact layout. This file should then link to them rather than
  restate them.
- The roles in `.agents/roles/` are independent of any spec tool. They take a
  task and its acceptance criteria as input, wherever those come from.
- Nothing is enforced by a hook any more. The gates that used to block
  unspecced code are gone, so the discipline is now a convention: get the spec
  and the plan agreed before writing production code.
- When a skill's advice conflicts with `AGENTS.md`, `ARCHITECTURE.md`, or
  `docs/`, the repository wins.
- Update stale docs in the same change that makes them stale.

## Layout Notes

- `.agents/skills/<name>/` is the real skill content (pinned by
  `skills-lock.json`); `.claude/skills/` is relative symlinks into it. Fresh
  clones need no install step. Edit the `.agents/` side only.
- `.agents/roles/<name>.md` holds the real role definitions; `.claude/agents/`
  is symlinks into them.
- Role restrictions are now only what the frontmatter declares:
  - `design`, `reviewer`, and `security` have no write tools at all
    (`disallowedTools`), so they cannot fix what they find.
  - Every other role is unrestricted. `product-mvp`, `planner`, and `qa` used to
    be limited to one artifact each by a hook; that limit is documented
    behaviour now, not an enforced one.
  - `infra-aws` used to be blocked from running mutating cloud commands by a
    hook. **That block is gone** — it must not run `terraform apply`,
    `aws ... create/delete/update`, or any other mutating command, and hands
    them to a human instead.

## Maintenance Conventions

- Adding a role: write `.agents/roles/<name>.md`, symlink it with
  `ln -s ../../.agents/roles/<name>.md .claude/agents/<name>.md`, and add a row
  to the roster in `docs/AI_PROJECT_AGENTS.md`.
- Adding a skill:
  `npx skills add <owner/repo> --skill <name> -a universal -a claude-code -y`.
  Repeat `--skill` for several skills — a comma-separated list is silently
  ignored while reporting success. Record additions in
  `docs/AI_PROJECT_SKILLS.md`. Repair a drifted tree with
  `npx skills experimental_install`.

## Boundaries

- Do not treat this file as a project encyclopedia; put durable knowledge in
  `docs/`.
- Do not bypass established architecture without updating the relevant docs.
