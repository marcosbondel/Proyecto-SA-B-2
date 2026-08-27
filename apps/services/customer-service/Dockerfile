# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
# The whole workspace is copied because this service consumes @bank/contracts and
# @bank/messaging from `dist/`, and pnpm resolves them through the lockfile at
# the root. Copying only `apps/services/customer-service` would build against
# nothing.
FROM node:24.19.0-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bank/contracts --filter @bank/messaging build
RUN pnpm --filter customer-service build

# Drops every devDependency, so the image carries no compiler and no test runner.
RUN pnpm --filter customer-service --prod deploy /out

# ----------------------------------------------------------------- run stage
FROM node:24.19.0-alpine AS runtime

# Curl is here for HEALTHCHECK and nothing else. This service makes no outbound
# HTTP call at all — a test asserts it (criterion 6).
RUN apk add --no-cache curl

# Never root. A process that reads its own bundle and talks to a database has no
# business being able to write anywhere else.
USER node
WORKDIR /app

COPY --from=build --chown=node:node /out ./

ENV NODE_ENV=production
EXPOSE 3001

# Liveness only, deliberately. `/ready` fails while PostgreSQL or RabbitMQ is
# unreachable, which is right for taking a replica out of rotation and wrong for
# a restart policy: restarting this process does not bring the database back, it
# just adds a crash loop to an outage.
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3001/health || exit 1

# Migrations run at boot, before the queue is consumed (see `src/main.ts`).
CMD ["node", "dist/main.js"]
