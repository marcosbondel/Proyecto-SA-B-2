#!/usr/bin/env bash
# The seven components of the system, and where each one's Dockerfile lives.
#
# Sourced by build-images.sh and smoke-images.sh so the two can never disagree
# about what "every component" means — the failure that leaves one image unbuilt
# and its smoke test silently skipped.
#
# Order is boot order, not alphabetical: the broker-facing services first, the
# Gateway after them, the frontend last. It is the order a demonstration is
# watched in.

# name | dockerfile | port
BANK_COMPONENTS=(
  "customer-service|apps/services/customer-service/Dockerfile|3001"
  "account-service|apps/services/account-service/Dockerfile|3002"
  "transaction-service|apps/services/transaction-service/Dockerfile|3003"
  "payment-service|apps/services/payment-service/Dockerfile|3004"
  "notification-audit-service|apps/services/notification-audit-service/Dockerfile|3005"
  "gateway|apps/gateway/Dockerfile|3000"
  "web|apps/web/Dockerfile|3010"
)

# The registry prefix. Local by decision, not by omission: the assignment's
# cluster is a local kind (§6, paso 11), so an image reaches it with
# `kind load docker-image` and never needs a registry, credentials or a push.
# The same string is what T-22 puts in `image.repository` per service in
# values.yaml.
BANK_IMAGE_PREFIX="${BANK_IMAGE_PREFIX:-bank-usac}"

# Splits one row of BANK_COMPONENTS into the three variables below it.
bank_component_fields() {
  local row="$1"
  local rest
  BANK_COMPONENT_NAME="${row%%|*}"
  rest="${row#*|}"
  BANK_COMPONENT_DOCKERFILE="${rest%%|*}"
  BANK_COMPONENT_PORT="${rest##*|}"
}

# The tag every image carries, and the one T-22 references.
#
# The short commit, because it is the only string that answers "which code is in
# this image" without trusting anybody to have bumped a number. A dirty tree has
# no such answer, so it is refused rather than labelled with a commit it does
# not match — pass --allow-dirty to say you know.
bank_image_tag() {
  local allow_dirty="${1:-false}"

  if [[ -n "$(git status --porcelain 2>/dev/null)" && "$allow_dirty" != "true" ]]; then
    echo "ERROR: the working tree has uncommitted changes." >&2
    echo "       An image tagged with a commit it does not contain is worse than" >&2
    echo "       an untagged one. Commit, or pass --allow-dirty." >&2
    return 1
  fi

  git rev-parse --short=12 HEAD
}
