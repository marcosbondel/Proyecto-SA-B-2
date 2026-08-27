# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
# The whole workspace is copied because this service consumes @bank/contracts and
# @bank/messaging from `dist/`, and pnpm resolves them through the lockfile at
# the root. Copying only `apps/services/transaction-service` would build against
# nothing.
FROM node:24.19.0-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bank/contracts --filter @bank/messaging build
RUN pnpm --filter transaction-service build

# Drops every devDependency, so the image carries no compiler and no test runner.
RUN pnpm --filter transaction-service --prod deploy /out

# ----------------------------------------------------------------- run stage
FROM node:24.19.0-alpine AS runtime

# Curl is here for HEALTHCHECK and nothing else. This service makes no outbound
# HTTP call at all: it orchestrates a Saga entirely by publishing commands and
# consuming events, which is what "choreography" means and what criterion 8 of
# T-18 asks to be true. A test asserts it.
RUN apk add --no-cache curl

# Never root. A process that reads its own bundle and talks to a database has no
# business being able to write anywhere else.
USER node
WORKDIR /app

COPY --from=build --chown=node:node /out ./

ENV NODE_ENV=production
EXPOSE 3003

# Liveness only, deliberately. `/ready` fails while PostgreSQL or RabbitMQ is
# unreachable, which is right for taking a replica out of rotation and wrong for
# a restart policy: restarting this process does not bring the database back, it
# just adds a crash loop to an outage — and for this service a crash loop means
# Sagas that stop advancing after the debit has already happened.
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3003/health || exit 1

# Migrations run at boot, before either queue is consumed (see `src/main.ts`).
CMD ["node", "dist/main.js"]
