# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
# The whole workspace is copied because the gateway consumes @bank/contracts and
# @bank/messaging from `dist/`, and pnpm resolves them through the lockfile at
# the root. Copying only `apps/gateway` would build against nothing.
FROM node:24.19.0-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bank/contracts --filter @bank/messaging build
RUN pnpm --filter gateway build

# Drops every devDependency, so the image carries no compiler and no test runner.
RUN pnpm --filter gateway --prod deploy /out

# ----------------------------------------------------------------- run stage
FROM node:24.19.0-alpine AS runtime

# Curl is here for HEALTHCHECK and nothing else; the gateway itself makes no
# outbound HTTP call, which the test suite asserts (criterion 4).
RUN apk add --no-cache curl

# Never root. A process that only needs to read its own bundle has no business
# being able to write anywhere else.
USER node
WORKDIR /app

COPY --from=build --chown=node:node /out ./

ENV NODE_ENV=production
EXPOSE 3000

# Liveness only. Readiness is `/ready`, and it fails while the broker is down —
# correct for a load balancer, wrong for a restart policy: restarting the
# gateway does not bring RabbitMQ back.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

# No DATABASE_URL, and no way to add one: the gateway has no database
# (constitution II and V). Its only credentials are the broker's and the object
# store's, and both arrive from the environment at run time.
CMD ["node", "dist/main.js"]
