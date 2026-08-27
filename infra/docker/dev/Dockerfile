# syntax=docker/dockerfile:1

# The development toolchain, and nothing else.
#
# Deliberately empty of application code. The workspace arrives as a bind mount
# at run time, so editing a file never invalidates a layer and this image only
# has to be rebuilt when Node or pnpm move. That is the opposite of
# `apps/*/Dockerfile`, which bakes a built artefact for deployment; the two
# answer different questions and are not variants of each other.
#
# Dependencies are not installed here either. They are installed into named
# volumes by the `deps` service, because the host's `node_modules` were
# resolved for macOS and a Linux container cannot reuse them.
FROM node:24.19.0-alpine

# The versions the repository enforces: `.nvmrc` and `packageManager`.
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /repo

# Every service in docker-compose.dev.yml names its own command. A container
# started without one is a mistake, and printing the version makes it obvious
# rather than leaving a container that exits silently.
CMD ["node", "--version"]
