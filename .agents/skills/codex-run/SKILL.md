---
name: codex-run
description: Start a project locally from Codex by discovering the repository's own run command, preparing dependencies and local infrastructure, launching the app in a persistent session, verifying that it responds, and reporting actionable startup failures. Use when the user asks Codex to run, start, launch, serve, preview, or demo an app locally and no more specific project run skill applies.
---

# Codex Run

Bring a project up locally for development or demo use, without turning the
task back into manual commands for the user. This is the generic fallback: if a
repository has a more specific run skill or documented command, follow that
source of truth first and use this skill for the surrounding discipline.

## Operating Rules

- Work from the repository root unless the documentation explicitly says
  otherwise.
- Prefer project documentation and scripts over guesses. Read the nearest
  `AGENTS.md`, `README.md`, package manifests, compose files, Makefiles, and
  app-specific run docs that are relevant to startup.
- Execute the setup and startup steps yourself. Do not finish by merely telling
  the user which commands to run.
- Do not overwrite existing `.env` files, databases, caches, or generated state
  unless the user explicitly asked for that destructive reset. If an example env
  file exists and the real file is missing, copy it only when the repository
  presents it as a safe local default.
- Stop on unrecoverable prerequisites and report the command output that proves
  the issue. Include what is missing, what was expected, and the smallest next
  fix.
- If a required dependency install or runtime command fails because of sandbox,
  file-system, Docker, or network restrictions, retry with the appropriate Codex
  escalation instead of inventing a workaround.
- Keep long-running application processes attached to the Codex session so their
  output can be inspected later.

## Workflow

1. **Find the startup contract.** Identify the project type and intended local
   entry point from docs and manifests. Common signals include `package.json`
   scripts, `pnpm-workspace.yaml`, `turbo.json`, `Makefile`, `justfile`,
   `docker-compose.yml`, `compose.yaml`, `pyproject.toml`, `Cargo.toml`,
   `go.mod`, framework config files, and app README files.

2. **Choose the least surprising command.** Prefer commands named by the docs:
   `dev`, `start`, `serve`, `preview`, `up`, `compose up`, `make dev`, or the
   repository-specific equivalent. For monorepos, prefer the documented whole
   stack command when the user asked to run the app, and a filtered command only
   when they asked for a subset.

3. **Check prerequisites.** Verify the runtime and package manager versions
   declared by the repo, such as `.nvmrc`, `packageManager`, `engines`,
   `.python-version`, `.ruby-version`, `rust-toolchain`, or similar files. If
   local infrastructure is required, verify Docker or the required service
   before startup.

4. **Prepare dependencies and environment.** Install dependencies only when
   missing or clearly stale. Generate local env files from repository-provided
   examples or scripts when those are documented as development defaults. Report
   any secrets or credentials that the user must provide manually.

5. **Start required infrastructure.** If the app depends on containers or local
   services, start them first using the project's documented command. Wait for
   health checks, ready logs, or successful connection probes before launching
   dependent applications.

6. **Launch the app.** Run the chosen startup command as a long-running Codex
   command. Use a TTY only when the tool genuinely requires one; otherwise keep
   logs plain so they are searchable. If the command exits, treat that as a
   startup failure unless the command is documented as a one-shot preparatory
   step.

7. **Verify behavior before claiming success.** Use the app's documented health
   endpoint, bound port, CLI status command, or logs. For a web UI, at minimum
   verify the HTTP response; when browser tooling is available and the UI is the
   product surface, open it and check that the page renders without obvious
   startup errors.

8. **Inspect logs for real failures.** Search recent output for startup errors
   such as failed migrations, missing env vars, port conflicts, refused
   connections, compilation failures, unhandled exceptions, or fatal framework
   messages. Validate context around a match before reporting it as real.

9. **Final report.** When startup is verified, give the local URL or access
   command, the process/session status, what was started, and how the user can
   ask you to inspect logs or stop it. If something failed, include the exact
   failing command and the relevant output lines.

## Detection Hints

- JavaScript or TypeScript: honor the declared package manager. With pnpm, npm,
  yarn, bun, Turborepo, Nx, Vite, Next, Nuxt, or Astro, use the scripts already
  in `package.json` rather than invoking framework binaries directly.
- Docker-first repos: prefer the documented compose command. Check daemon
  availability before running commands that depend on it.
- Python web apps: look for `README.md`, `pyproject.toml`, `requirements.txt`,
  `manage.py`, `uv`, `poetry`, `flask`, `fastapi`, or `django` conventions.
  Create virtual environments only when the repo docs or local pattern calls for
  it.
- Backend services: verify health/readiness endpoints or a successful listening
  log. Do not assume a process is usable just because the command is still
  running.

## Stop Conditions

Stop and report instead of continuing when:

- A required runtime, package manager, Docker daemon, database, or external
  service is unavailable.
- The repository requires secrets that are not present and has no local safe
  defaults.
- A port conflict belongs to an unknown process and the user has not authorized
  killing it.
- Install, build, migration, or startup logs show a real blocking error.
- The app never responds within the documented startup window, or within a
  reasonable default of about 90 seconds for ordinary local web apps.
