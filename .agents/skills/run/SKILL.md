---
name: run
description: Launch the full Bank USAC stack locally with the Turborepo TUI — infrastructure in Docker (pnpm dev:infra) and the seven applications on the host in watch mode (pnpm dev:host). Use when asked to run, start, or bring up the app for local use or a demo. Does the prep (install, infra up and healthy, per-app .env, demo seed) and hands the final `pnpm dev:host` to the user, because the Turborepo TUI only renders in an interactive terminal.
---

Bring the whole system up for local use, the `dev:host` way — infrastructure in
Docker and the applications on the host, so the developer gets the **Turborepo
terminal UI** (`turbo run dev`), a debugger they can attach, and one process per
application. The alternative, `pnpm dev`, runs everything in Docker Compose and
has **no** Turbo TUI; this skill is the host path on purpose.

The one thing this skill cannot do for the user is the last step: the Turborepo
TUI needs an interactive TTY, and a command run through a tool does not have one
— it falls back to plain streamed logs. So do all the preparation, then hand
`pnpm dev:host` to the user to run in their own terminal.

## Steps

Run everything from the repository root.

1. **Docker is running.** `docker info` succeeds, or stop and tell the user to
   start Docker Desktop — nothing below works without it.

2. **No conflicting app stack.** If `docker ps` shows `gateway` or `web`
   containers (the all-Docker `pnpm dev` stack), they hold ports 3000/3001–3005
   and 3010 that `dev:host` needs. Run `pnpm dev:down` first — it stops the
   application containers but keeps the infrastructure, which step 4 then
   adopts.

3. **Toolchain and install.** Check `node -v` is 24.19.0 and `pnpm -v` is
   11.21.0 (the repo pins both; `nvm use` and `corepack enable` set them in an
   interactive shell). Run `pnpm install` if `node_modules` is absent or the
   lockfile changed.

4. **Infrastructure, then wait for healthy.** `infra/docker/.env` must exist —
   if not, `cp infra/docker/.env.example infra/docker/.env` and tell the user to
   fill the credentials (the dev-only defaults already in it boot a local
   stack). Then:

   ```bash
   pnpm dev:infra
   ```

   Poll `docker compose -f infra/docker/docker-compose.yml ps` until the five
   PostgreSQL instances, RabbitMQ and MinIO all read `healthy`. Do not proceed
   while any is still starting — the applications would fail their first
   connections into the retry ladder.

5. **Per-application `.env` files.** `dev:host` reads `apps/<name>/.env`, which
   do not exist by default and, if missing, fail each service's environment
   validation at boot. Generate them (idempotent — existing files are left
   alone):

   ```bash
   bash infra/docker/scripts/write-host-env.sh
   ```

6. **Hand off the Turbo TUI.** Do **not** run `pnpm dev:host` through a tool —
   it would render as streamed logs, not the TUI the user asked for. Instead
   tell the user to run it in their terminal, offering the in-session shortcut:

   > Everything is ready. Run **`pnpm dev:host`** in your terminal for the
   > Turborepo UI (or type `! pnpm dev:host` here to run it in this session).

   Then report what they will get:
   - **Frontend:** <http://localhost:3010> · **Gateway:** <http://localhost:3000>
   - **Seeded test users** (password `BankUsac#2026`): `admin@bankusac.gt`,
     `cajero@bankusac.gt`, `cliente@bankusac.gt` (the client has two accounts,
     one funded).
   - In the TUI: `↑`/`↓` select a task, `/` searches, `u`/`d` scroll the log,
     `Ctrl-C` stops every task.
   - `dev:host` does **not** start the databases or broker — step 4 did. Stop
     the applications with `Ctrl-C`, then `pnpm dev:infra:down` for the rest.

## Notes

- To run the applications in Docker too (no host toolchain, no per-app `.env`,
  but no Turbo TUI), the command is `pnpm dev` — a different trade-off, covered
  in the README's *Running It Locally*.
- A subset is `turbo run dev --filter=<app>` (e.g. `--filter=gateway`), which
  brings that application's dependencies with it.
- Real activation emails instead of the simulated log line: set
  `NOTIFICATION_CHANNEL=resend` per `docs/operations/EMAIL_RESEND.md`.
