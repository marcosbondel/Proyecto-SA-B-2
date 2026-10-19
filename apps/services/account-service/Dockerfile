# syntax=docker/dockerfile:1

# Account Service — accounts, balances and the Saga's three movements.
#
# Build from the **repository root**, not from this directory:
#
#   docker build -f apps/services/account-service/Dockerfile -t bank-usac/account-service:dev .
#
# The context is the workspace because this application consumes
# `@bank/contracts` and `@bank/messaging` from their `dist/`, and pnpm resolves
# both through the lockfile at the root. A context of `apps/services/account-service` would build
# against nothing.

# ---------------------------------------------------------------- build stage
FROM node:24.19.0-alpine AS build

# The versions the repository enforces: `.nvmrc` and `packageManager`. Pinned by
# tag rather than digest — see docs/operations/CONTAINERS.md for the bump
# procedure and for why.
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo

# Manifests before sources, so editing a `.ts` does not re-resolve the whole
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

# `<name>...` is "this package and everything it depends on", so the frontend's
# Nuxt toolchain is never downloaded into a backend image.
RUN pnpm install --frozen-lockfile --filter account-service...

COPY apps ./apps

RUN pnpm --filter @bank/contracts --filter @bank/messaging --filter @bank/observability build
RUN pnpm --filter account-service build

# Drops every devDependency, so the image carries no compiler and no test runner.
#
# The flag is required, not decorative. From pnpm 10 `deploy` refuses a
# workspace that has not set `inject-workspace-packages`, and `--legacy` — the
# other way out — is worse than useless here: it writes `@bank/contracts` into
# `/out/node_modules` as a *symlink back into `/repo`*, which the runtime stage
# does not have, so the image builds and then dies on its first require.
#
# Setting it per invocation rather than in `pnpm-workspace.yaml` is deliberate.
# Repository-wide it would make every consumer of `@bank/contracts` hold a copy
# instead of a link, and `pnpm dev` would stop propagating a contract edit to
# the services watching it — local development changed to satisfy a container
# build.
RUN pnpm --config.inject-workspace-packages=true \
    --filter account-service --prod deploy /out

# ----------------------------------------------------------------- run stage
FROM node:24.19.0-alpine AS runtime

# Values, not secrets. They arrive from the build script so an image can be
# traced back to the commit that produced it, which is the whole point of the
# tagging scheme in docs/operations/CONTAINERS.md.
ARG IMAGE_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown

LABEL org.opencontainers.image.title="bank-usac account-service" \
      org.opencontainers.image.description="Accounts, balances as NUMERIC(14,2), the Saga's debit, credit and compensation, and the automatic deactivation job." \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.source="https://github.com/marcosbondel/Proyecto-SA-B-2" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.base.name="docker.io/library/node:24.19.0-alpine" \
      gt.usac.bank.component="account-service" \
      gt.usac.bank.ticket="T-21"

# No HTTP client is installed. This service makes no outbound HTTP call to a
# sibling at all — a test asserts it (criterion 7). The health check below uses
# busybox `wget`, which the base image already carries.

# Never root. A process that reads its own bundle and talks to a
# database has no business being able to write anywhere else. `node` is uid 1000, already in the base image;
# creating another user would only make the Kubernetes `runAsUser` in T-22
# disagree with what is here.
USER node
WORKDIR /app

COPY --from=build --chown=node:node /out ./

# The only variable baked in, and it is not configuration: it selects the
# production code paths in Node and Nest. Everything this application actually
# needs to be told arrives at run time, which is what lets one image serve
# Compose, kind and a demonstration alike.
ENV NODE_ENV=production
EXPOSE 3002

# Liveness only, deliberately. `/ready` also reports PostgreSQL, RabbitMQ and
# whether the queues are attached, which is right for taking a replica out of
# rotation and wrong for a restart policy: restarting this process does not
# bring the database back, it just adds a crash loop to an outage. Since T-21
# `src/main.ts` opens the port *before* it reaches either dependency, precisely
# so this probe can answer during one.
#
# `127.0.0.1` and not `localhost`: with IPv6 enabled `localhost` can resolve to
# `::1` first, and the server binds `0.0.0.0`. `wget` is busybox's, already in
# the base image — installing curl for this would be a package and a CVE surface
# bought for one line.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/health || exit 1

# Unambiguous, and `exec` form so PID 1 is node itself: the SIGTERM handler in
# `src/main.ts` only ever runs if the signal is not swallowed by a shell.
# Migrations run at boot, behind the open port, before the queue is consumed,
# and the deactivation scheduler starts after the broker.
CMD ["node", "dist/main.js"]
