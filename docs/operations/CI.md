# Continuous Integration

The pipeline that runs the verification every contributor is expected to run
locally, automatically, on every push to a `feature/*` branch and on every
pull request into `develop`. Built by **T-32**. Defined in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## What triggers it

| Event | Branches | Runs |
| --- | --- | --- |
| `push` | `feature/**` | The `verify` job |
| `pull_request` | target `develop` | The `verify` job |
| `workflow_dispatch` | any | The `verify` job, manually |

A push to `main`, `develop` itself, or any other branch does not trigger the
workflow — those are integration or release branches, not where a contributor
lands unreviewed commits. `concurrency` cancels an in-flight run for the same
ref when a new push arrives, so a rapid sequence of fixups does not queue
redundant runs.

## The `verify` job

One job, `ubuntu-latest`, one step per stage, run in the order below. GitHub
Actions stops the job at the first step that exits non-zero — every stage is
blocking, which is what the ticket's "detener el pipeline ante cualquier
fallo" requires.

| Step | Command | What it verifies | A failure means |
| --- | --- | --- | --- |
| No tracked `.env` files | `git ls-files` guard | No secret-bearing file was committed | A credential or config file was added by mistake; remove it and use `.env.example` instead |
| Install | `pnpm install --frozen-lockfile` | The lockfile matches every `package.json`; the workspace installs from a clean checkout | `pnpm-lock.yaml` is stale — regenerate it locally and commit it |
| Build | `pnpm build` | The seven applications and the shared packages compile, `@bank/contracts` before `@bank/messaging` before anything that imports them | A TypeScript or bundler error |
| Lint | `pnpm lint` | Style **and** the architectural isolation rules in `apps/packages/tooling/eslint.base.mjs` (no cross-service import, no framework import in `domain`, no `infrastructure` import in `application`) | A style violation or an architecture boundary was crossed |
| Typecheck | `pnpm typecheck` | `tsc --noEmit` across every workspace | A type error `lint` did not already catch |
| Test | `pnpm test` | The unit suites for every application and package | A unit test regressed |
| Contract tests | `pnpm test:contract` | `@bank/contracts`'s own Jest suite | A shared contract broke |

Build runs before lint/typecheck/test on purpose: all three already depend on
`^build` through Turborepo, so a compilation error is reported by the step
named "Build" instead of surfacing inside whichever verification step happens
to trigger the rebuild first.

Node and pnpm versions are read from `.nvmrc` and the `packageManager` field
in the root `package.json` — nothing in the workflow pins a version
separately, so bumping either file is the only change a toolchain upgrade
needs.

## Why `pnpm format:check` is not a step

It fails today against files this ticket has no reason to touch: the Helm
templates under `infra/k8s/helm/bank-usac/templates/` use Go template syntax
(`{{- $component := ... }}`) that is not valid YAML, so Prettier's YAML parser
rejects them, plus a handful of pre-existing warnings elsewhere in the
workspace. Wiring a failing check into a required pipeline would make every
push red for a reason unrelated to the change being verified. Whoever
resolves those files can add the step back; until then, `pnpm format:check`
stays a local, non-blocking habit.

## What a green run does **not** prove

Every service's `test/repository.integration.spec.ts` is gated
`describe.skip` when `DATABASE_URL` is unset, and
`apps/packages/messaging/test/broker.integration.spec.ts` is gated the same
way on `RABBITMQ_URL`. This pipeline sets neither, by design (see Scope
below), so a green `verify` run:

- Never exercises the row lock a concurrent debit relies on, the optimistic
  `version` that rejects a stale write, or the `CHECK (balance >= 0)`
  constraint.
- Never exercises deduplication by `(idempotency_key, type)` or by the
  envelope's `messageId`.
- Never exercises the outbox surviving a crash between commit and publish.

Those are exactly the idempotency and failure-handling claims this project is
judged on — see the same warning in [`AGENTS.md`](../../AGENTS.md#commands).
This gap is tracked as TD-069 in [`docs/TECH_DEBT.md`](../TECH_DEBT.md).

## Scope: what this pipeline deliberately does not run

- `pnpm test:e2e` / `pnpm test:e2e:happypath` — need the full Docker stack and
  a browser; they belong to a slower, separate pipeline.
- `pnpm images:build` / `images:smoke` / `images:flow` — need Docker and
  produce the seven runtime images; that is continuous **deployment**
  territory (T-33), not verification of a pull request.
- Anything that needs PostgreSQL, RabbitMQ or MinIO as a live dependency.

## Secrets

The workflow references no `secrets.*` value anywhere, so there is nothing
that can leak into a log line. If a future step genuinely needs one:

- Add it as a repository secret (Settings → Secrets and variables → Actions),
  never as a literal in the YAML.
- Pass it as `env:` on the one step that needs it — not at job or workflow
  level, so no other step inherits it by accident.
- Never `echo` it, and never pass it as a command-line argument (arguments are
  visible in the runner's process list and in some log renderings).

## Reproducing it locally

The same commands, from a clean checkout, in the same order:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
```

To also exercise the suites the pipeline skips, follow the "Check the ports
before trusting them" section of [`AGENTS.md`](../../AGENTS.md#commands) —
`pnpm dev:infra` plus a `DATABASE_URL`/`RABBITMQ_URL` per service.
