# Agent Guide

Short map for AI agents working in this repository. Durable knowledge lives in
`docs/` — keep this file short and link to deeper docs instead of expanding it.

## Repo Status

A pnpm workspace with everything under `apps/`: the Gateway and the Nuxt
frontend at the top level, the five domain services under `apps/services/`, and
`@bank/contracts`, `@bank/messaging` and `@bank/tooling` under
`apps/packages/`. All seven applications install, build, lint and test from a
clean checkout.

What exists is scaffolding: health checks, boot-time environment validation,
the shared message envelope and the RabbitMQ adapter. The `domain` and
`application` layers are deliberately empty — no banking rule is implemented.
`ARCHITECTURE.md` records the target architecture; local infrastructure (T-06)
and deployment (T-16) are not built yet.

## Project Documentation

Consult these documents before making decisions or describing the repository:

- [README.md](README.md): project identity, team, layout, and development entry points.
- [ARCHITECTURE.md](ARCHITECTURE.md): system boundaries, stack, constraints, and dependency rules.
- [docs/DESIGN.md](docs/DESIGN.md): **must be read before creating or modifying any interface, page, component, style, or interface text**. This link is permanent and must not be removed by a documentation change without an explicit team decision.
- [docs/domain/](docs/domain/README.md): **the domain model as a functional contract** — which service owns which data, which invariants it protects, and which commands and events it handles. Read it before implementing any service, designing an event, or adding a business rule.
- [docs/architecture/adr/](docs/architecture/adr/README.md): **the technology and architecture decisions**, each with the alternatives that were rejected and why. Read it before introducing or changing a technology, or before writing a spec that depends on the stack. These decisions are design constraints — changing one requires a new ADR that supersedes the old, not an edit.
- [docs/OWNERSHIP.md](docs/OWNERSHIP.md): primary owner before changing a component.
- [docs/METHODOLOGY.md](docs/METHODOLOGY.md): milestones, status transitions, evidence, and blockers.
- [docs/PRODUCT_SENSE.md](docs/PRODUCT_SENSE.md): users and banking workflows before product-facing changes.
- [docs/FRONTEND.md](docs/FRONTEND.md): verified frontend stack and conventions before frontend work.
- [docs/SECURITY.md](docs/SECURITY.md): data classes and security boundaries before handling sensitive data.
- [docs/RELIABILITY.md](docs/RELIABILITY.md): SRE requirements before service or infrastructure design.
- [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md): current quality assessment at milestone reviews.
- [docs/TECH_DEBT.md](docs/TECH_DEBT.md): open debt before adding or closing follow-up work.
- [docs/DOC_INVENTORY.md](docs/DOC_INVENTORY.md): document class and ownership before editing Markdown.
- [docs/AI_PROJECT_AGENTS.md](docs/AI_PROJECT_AGENTS.md): role capabilities and restrictions before delegating work.
- [docs/AI_PROJECT_SKILLS.md](docs/AI_PROJECT_SKILLS.md): installed skills and stack-specific skill policy.
- [docs/design-docs/index.md](docs/design-docs/index.md): durable design records before recording a new decision.
- [docs/design-docs/core-beliefs.md](docs/design-docs/core-beliefs.md): repository operating beliefs before changing agent practice.
- [docs/references/README.md](docs/references/README.md): how to add or consult external references.
- [apps/web/README.md](apps/web/README.md): Nuxt starter-level application commands when working inside the web app.
- [.specify/memory/constitution.md](.specify/memory/constitution.md): mandatory architecture principles before writing a spec or plan.

## Commands

Run from the **repository root**, not from an application directory. The
repository is a pnpm workspace: Node 24.19.0 (`.nvmrc`) and pnpm 11.21.0
(`packageManager`) are enforced, and `engines.node` refuses anything older.

```bash
pnpm install        # whole workspace, one lockfile
pnpm build          # shared packages, then the seven applications
pnpm lint           # includes the executable isolation rules
pnpm test           # unit tests for every application and package
pnpm test:contract  # contract tests over @bank/contracts
pnpm format         # prettier
pnpm dev            # every application in watch mode
```

Per application: `pnpm --filter <name> <command>`, where `<name>` is `gateway`,
`web`, `customer-service`, `account-service`, `transaction-service`,
`payment-service` or `notification-audit-service`.

`pnpm build` must run before testing a single application in a fresh clone: the
shared packages are consumed from `dist/`. `pnpm --filter <app>... build` (three
dots) builds an application together with its dependencies.

`apps/web` now has `lint` (`eslint .`, via the already-installed `@nuxt/eslint`)
and `test` (`node --test`, one smoke test) — added by T-04 so `pnpm lint` and
`pnpm test` cover all seven applications. It has **no component-level test
framework**; that needs a Nuxt-native runner and is recorded as TD-010. Do not
claim component coverage.

**Lint enforces architecture, not just style.** A service importing another
service, a `domain` file importing a framework, or an `application` file
importing `infrastructure` fails `pnpm lint`. The rules live in
`apps/packages/tooling/eslint.base.mjs`. See the README for the full list.

## Workflow

Spec-driven work runs on **[Spec Kit](https://github.com/github/spec-kit)**
(`speckit`, v0.12.2), installed under `.specify/`. The previous home-grown
`/spec-*` command set, its state machine, and its enforcement hooks were removed
in favour of it — `/spec-new`, `/spec-approve`, `scripts/agent-checks/`,
`state.yaml`, and `docs/SPEC_WORKFLOW.md` no longer exist.

Two integrations are installed, both driving the same ten workflows:

| Tool | Invocation | Reads |
| --- | --- | --- |
| Claude Code | `/speckit-<name>` (hyphen) | `.claude/skills/speckit-*/` |
| opencode | `/speckit.<name>` (dot) | `.opencode/commands/speckit.*.md` |

The workflows are `constitution`, `specify`, `clarify`, `plan`, `tasks`,
`analyze`, `checklist`, `implement`, `converge`, `taskstoissues`. Phase order and
artifact layout come from Spec Kit's own templates in `.specify/templates/`; this
file does not restate them.

- Every ticket gets its own branch: before starting work on ticket `T-XX`,
  create `feature/T-XX` from the latest `origin/develop`
  (`git fetch origin && git switch -c feature/T-XX origin/develop`) and keep
  every commit for that ticket on it.
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
- **The Spec Kit workflows follow the same rule.** Spec Kit installs per-tool
  copies; they were collapsed into one canonical body each:

  ```
  .agents/skills/speckit-<name>/SKILL.md        ← the only real file
    ├── .claude/skills/speckit-<name>           → symlink to the directory
    └── .opencode/commands/speckit.<name>.md    → symlink to the SKILL.md
  ```

  The canonical body is Spec Kit's Claude output, which is a superset: it carries
  the instruction to rewrite dotted command names to hyphens, so it reads
  correctly from either tool. The `handoffs:` frontmatter that only opencode
  emits was merged in, so nothing was lost by sharing the file.

  **Cost of this:** `specify integration status` now reports 15 managed files as
  modified, and `specify integration upgrade --force` would overwrite the
  symlinks with regular per-tool copies. After any Spec Kit upgrade, re-collapse
  them or the two tools drift apart. Also note both integrations are installed
  with `--force`, since `opencode` is not declared multi-install safe — the
  `unsafe-multi-install` error in `integration status` is expected, not a
  regression.
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
