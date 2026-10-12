# syntax=docker/dockerfile:1

# The Nuxt frontend — the only thing a person ever looks at.
#
# Build from the **repository root**, not from this directory:
#
#   docker build -f apps/web/Dockerfile -t bank-usac/web:dev .
#
# The context is the workspace because pnpm resolves this application through
# the lockfile at the root. Unlike the six NestJS images this one imports no
# `@bank/*` package — `apps/web` depends on no service by design (TD-029) — but
# the lockfile is still the root's.

# ---------------------------------------------------------------- build stage
FROM node:24.19.0-alpine AS build

# The versions the repository enforces: `.nvmrc` and `packageManager`. Pinned by
# tag rather than digest — see docs/operations/CONTAINERS.md for the bump
# procedure and for why.
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo

# Manifests before sources, so editing a `.vue` does not re-resolve the whole
# dependency graph. Every workspace manifest is copied, not just this one: pnpm
# validates the lockfile against every importer `pnpm-workspace.yaml` declares,
# and a missing one makes `--frozen-lockfile` fail.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/packages/contracts/package.json ./apps/packages/contracts/
COPY apps/packages/messaging/package.json ./apps/packages/messaging/
COPY apps/packages/observability/package.json ./apps/packages/observability/
COPY apps/packages/tooling/package.json ./apps/packages/tooling/
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/web/package.json ./apps/web/
COPY apps/services/customer-service/package.json ./apps/services/customer-service/
COPY apps/services/account-service/package.json ./apps/services/account-service/
COPY apps/services/transaction-service/package.json ./apps/services/transaction-service/
COPY apps/services/payment-service/package.json ./apps/services/payment-service/
COPY apps/services/notification-audit-service/package.json ./apps/services/notification-audit-service/

# `--ignore-scripts`, then the sources, then `nuxt prepare` by hand.
#
# `web`'s `postinstall` *is* `nuxt prepare`, and it reads `nuxt.config.ts`,
# `app/` and `server/` to generate `.nuxt`. Running it here — before the sources
# exist — either fails or, worse, succeeds against an empty application and
# leaves types nothing matches. So the script is skipped and run below, once
# there is something to prepare.
RUN pnpm install --frozen-lockfile --filter web... --ignore-scripts

COPY apps ./apps

RUN pnpm --filter web exec nuxt prepare
RUN pnpm --filter web build

# ----------------------------------------------------------------- run stage
FROM node:24.19.0-alpine AS runtime

# Values, not secrets. They arrive from the build script so an image can be
# traced back to the commit that produced it, which is the whole point of the
# tagging scheme in docs/operations/CONTAINERS.md.
ARG IMAGE_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown

LABEL org.opencontainers.image.title="bank-usac web" \
      org.opencontainers.image.description="The Nuxt frontend: five feature modules, role-filtered navigation, and the public registration screen." \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.source="https://github.com/marcosbondel/Proyecto-SA-B-2" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.base.name="docker.io/library/node:24.19.0-alpine" \
      gt.usac.bank.component="web" \
      gt.usac.bank.ticket="T-21"

# Never root. This process serves rendered HTML and holds no credential at all;
# there is nothing it needs to write. `node` is uid 1000, already in the base
# image; creating another user would only make the Kubernetes `runAsUser` in
# T-22 disagree with what is here.
USER node
WORKDIR /app

# `.output` and nothing else — no `pnpm deploy` here, and no `node_modules`.
#
# Nitro's node-server preset emits a self-contained bundle: every dependency the
# server needs is already inside `.output/server`. Copying the workspace's
# `node_modules` beside it would add hundreds of megabytes the process never
# opens, and a build toolchain — Vite, the TypeScript compiler, the eslint
# plugin — into an image that only serves pages.
COPY --from=build --chown=node:node /repo/apps/web/.output ./.output

# Baked in because they are not configuration: `NODE_ENV` selects production
# code paths, and the two `NITRO_*` values are how the preset is told to bind a
# container's interface rather than loopback. Bind `0.0.0.0` or nothing outside
# the container can connect — the failure looks like a crashed server and is
# really a listening one nobody can reach.
ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3010

# 3010 rather than Nuxt's default 3000, which the Gateway owns. The five domain
# services own 3001-3005.
EXPOSE 3010

# Liveness. `/ready` additionally checks that the Gateway origin handed to the
# browser is a real absolute origin — but deliberately does **not** check that
# the Gateway answers: an interface that took itself out of rotation during an
# API outage would be unable to render the very screen that explains the outage.
# See `server/utils/gateway-config.ts`.
#
# `127.0.0.1` and not `localhost`: with IPv6 enabled `localhost` can resolve to
# `::1` first, and the server binds `0.0.0.0`. `wget` is busybox's, already in
# the base image.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3010/health || exit 1

# The Nitro entry point, unambiguous, in `exec` form so PID 1 is node itself and
# SIGTERM reaches it rather than a shell.
#
# `NUXT_PUBLIC_API_BASE_URL` is read here at run time, never compiled in, so one
# image serves Compose, kind and a demonstration alike. It is public runtime
# config — the browser receives it — so nothing secret may ever go under that
# prefix.
CMD ["node", ".output/server/index.mjs"]
