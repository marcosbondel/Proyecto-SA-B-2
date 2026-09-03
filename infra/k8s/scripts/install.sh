#!/usr/bin/env bash
#
# Release the Bank USAC chart onto the local kind cluster.
#
#   ./infra/k8s/scripts/install.sh                  # discover IPs, then install
#   ./infra/k8s/scripts/install.sh --tag 2703cb03c161
#   ./infra/k8s/scripts/install.sh --dry-run        # render, do not apply
#   ./infra/k8s/scripts/install.sh --print          # print the helm command only
#
# `helm upgrade --install` for this chart needs sixteen values nobody can be
# expected to type: nine `--set secrets.*` that templates/secret.yaml marks
# `required`, and seven `--set <component>.image.tag`. This script assembles
# them — the secrets from infra/docker/.env, so one credential file serves both
# Compose and the cluster, and the tag from `git rev-parse` so the release names
# the commit it is actually running.
#
# It also re-runs discover-external-ips.sh every time, on purpose: Docker
# reassigns container IPs whenever a container is recreated, and a stale address
# in the Endpoints is a silent outage — the pod stays Running and never Ready —
# rather than a rendering error.
#
# Written for bash 3.2, the version macOS ships. No associative arrays.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
CHART="${REPO_ROOT}/infra/k8s/helm/bank-usac"
ENV_FILE="${REPO_ROOT}/infra/docker/.env"
GENERATED="${REPO_ROOT}/infra/k8s/kind/generated-external.values.yaml"
DISCOVER="${REPO_ROOT}/infra/k8s/kind/scripts/discover-external-ips.sh"
RELEASE="bank-usac"
NAMESPACE="bank-usac"

# The target cluster is PINNED, never inherited from whatever context happens to
# be active. This chart's images are local — loaded into a kind node with
# `kind load docker-image` and pullable from nowhere else — and its Secret is
# built from infra/docker/.env, so releasing it into a remote cluster both fails
# (ImagePullBackOff on every pod) and puts local development credentials
# somewhere they were never meant to go. That is not hypothetical: it happened.
KUBE_CONTEXT="${BANK_KUBE_CONTEXT:-kind-bank-usac}"

tag=""
dry_run=false
print_only=false
skip_discover=false
allow_remote=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) tag="${2:?--tag needs a value}"; shift 2 ;;
    --context) KUBE_CONTEXT="${2:?--context needs a value}"; shift 2 ;;
    --allow-remote-context) allow_remote=true; shift ;;
    --dry-run) dry_run=true; shift ;;
    --print) print_only=true; shift ;;
    --skip-discover) skip_discover=true; shift ;;
    -h|--help) sed -n '3,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift ;;
    *) echo "ERROR: unknown flag $1" >&2; exit 2 ;;
  esac
done

if ! kubectl config get-contexts -o name 2>/dev/null | grep -qx "$KUBE_CONTEXT"; then
  echo "ERROR: kube context '${KUBE_CONTEXT}' does not exist." >&2
  echo "  Create the cluster first:  pnpm k8s:cluster" >&2
  echo "  Available contexts:" >&2
  kubectl config get-contexts -o name 2>/dev/null | sed 's/^/    /' >&2
  exit 1
fi

# A context that is not a kind cluster cannot be the intended target of this
# chart. Refuse rather than warn: a warning scrolls past, and the failure mode
# is a namespace full of unpullable pods holding real credentials.
if [[ "$KUBE_CONTEXT" != kind-* && "$allow_remote" != "true" ]]; then
  echo "ERROR: '${KUBE_CONTEXT}' is not a kind context, and this chart only" >&2
  echo "  makes sense against the local kind cluster:" >&2
  echo "    · its images exist only on the kind node (no registry)" >&2
  echo "    · its Secret is built from your local infra/docker/.env" >&2
  echo "    · its databases are Docker containers on bank-usac-local" >&2
  echo >&2
  echo "  Use --context kind-bank-usac, or --allow-remote-context if you" >&2
  echo "  genuinely mean to release into '${KUBE_CONTEXT}'." >&2
  exit 1
fi

[[ -f "$ENV_FILE" ]] || {
  echo "ERROR: ${ENV_FILE} not found." >&2
  echo "  cp infra/docker/.env.example infra/docker/.env  # then fill it in" >&2
  exit 1
}
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# The tag build-images.sh produced. Same derivation, so the two agree.
if [[ -z "$tag" ]]; then
  tag="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]]; then
    echo "WARNING: the working tree has uncommitted changes." >&2
    echo "  '${tag}' names a commit that does not describe what is running." >&2
    echo "  Commit first, or pass --tag explicitly." >&2
  fi
fi

# Resolve the tag against what the node actually has.
#
# HEAD is the right default — a release should name the commit it runs — but
# HEAD moves with every commit, including the ones that cannot change an image:
# documentation, evidence, this script. Demanding a four-minute rebuild after a
# docs commit is not correctness, it is friction, and the failure it produces is
# the worst kind: helm accepts the release, the new pods sit in ImagePullBackOff
# (there is no registry — `bank-usac/*` resolves to docker.io and 401s), the old
# replicas cannot terminate, and kubelet's pull backoff then grows past any
# sensible timeout.
#
# So: prefer HEAD, load it if it was built but never loaded, and otherwise fall
# back to the newest tag on the node that is an ancestor of HEAD — saying so
# out loud, and saying whether any application code actually differs. A tag two
# docs commits behind runs byte-identical images; a tag behind a change under
# apps/ does not, and that distinction is the one worth printing.
# Resolution runs even for --print and --dry-run: a printed command that names a
# tag the run would not use is worse than no command at all.
if [[ "$KUBE_CONTEXT" == kind-* ]]; then
  kind_cluster="${KUBE_CONTEXT#kind-}"
  node="${kind_cluster}-control-plane"
  node_images="$(docker exec "$node" crictl images 2>/dev/null || true)"

  if [[ -n "$node_images" ]]; then
    node_has_tag() {
      echo "$node_images" | grep -q "bank-usac/gateway[[:space:]]\+$1[[:space:]]"
    }

    if ! node_has_tag "$tag" && [[ "$dry_run" != "true" && "$print_only" != "true" ]]; then
      # Built locally but never loaded? That is one `kind load` away.
      if docker image inspect "bank-usac/gateway:${tag}" >/dev/null 2>&1; then
        echo "Images for ${tag} are built but not on the node — loading…"
        for component in \
          customer-service account-service transaction-service payment-service \
          notification-audit-service gateway web; do
          kind load docker-image --name "$kind_cluster" "bank-usac/${component}:${tag}" >/dev/null 2>&1
        done
      fi
    fi

    if ! node_has_tag "$tag"; then
      # Newest tag on the node that is a real ancestor of HEAD, by commit date.
      fallback=""
      fallback_date=0
      while read -r candidate; do
        [[ -z "$candidate" || "$candidate" == "dev" ]] && continue
        git -C "$REPO_ROOT" cat-file -e "${candidate}^{commit}" 2>/dev/null || continue
        git -C "$REPO_ROOT" merge-base --is-ancestor "$candidate" HEAD 2>/dev/null || continue
        candidate_date="$(git -C "$REPO_ROOT" log -1 --format=%ct "$candidate" 2>/dev/null || echo 0)"
        if [[ "$candidate_date" -gt "$fallback_date" ]]; then
          fallback="$candidate"; fallback_date="$candidate_date"
        fi
      done <<EOF
$(echo "$node_images" | awk '$1 ~ /bank-usac\/gateway$/ {print $2}')
EOF

      if [[ -z "$fallback" ]]; then
        echo "ERROR: the node '${node}' has no usable bank-usac images." >&2
        echo "  Build and load them:" >&2
        echo "    pnpm images:build -- --kind ${kind_cluster}" >&2
        exit 1
      fi

      behind="$(git -C "$REPO_ROOT" rev-list --count "${fallback}..HEAD" 2>/dev/null || echo '?')"
      echo "NOTE: no images for ${tag} (HEAD); releasing ${fallback} instead." >&2
      echo "      It is ${behind} commit(s) behind HEAD." >&2
      if git -C "$REPO_ROOT" diff --quiet "$fallback" HEAD -- apps/ 2>/dev/null; then
        echo "      No application code differs between them, so the images are" >&2
        echo "      byte-identical to what HEAD would build." >&2
      else
        echo "      WARNING: apps/ HAS changed since ${fallback}:" >&2
        git -C "$REPO_ROOT" diff --stat "$fallback" HEAD -- apps/ 2>/dev/null \
          | sed 's/^/        /' | tail -8 >&2
        echo "      Rebuild to release those changes:" >&2
        echo "        pnpm images:build -- --kind ${kind_cluster}" >&2
      fi
      tag="$fallback"
    fi
  fi
fi

if [[ "$skip_discover" != "true" && "$dry_run" != "true" && "$print_only" != "true" ]]; then
  echo "Discovering the external containers' IPs on bank-usac-local…"
  "$DISCOVER"
fi

set -- \
  upgrade --install "$RELEASE" "$CHART" \
  --kube-context "$KUBE_CONTEXT" \
  --namespace "$NAMESPACE" --create-namespace

[[ -f "$GENERATED" ]] && set -- "$@" -f "$GENERATED"

# The nine required secrets, mapped from the Compose credentials.
set -- "$@" \
  --set-string "secrets.jwtSecret=${JWT_SECRET:-dev-only-secret-not-for-any-deployed-environment}" \
  --set-string "secrets.rabbitmq.user=${RABBITMQ_APP_USER:?RABBITMQ_APP_USER missing from .env}" \
  --set-string "secrets.rabbitmq.password=${RABBITMQ_APP_PASSWORD:?RABBITMQ_APP_PASSWORD missing from .env}" \
  --set-string "secrets.objectStorage.accessKey=${MINIO_APP_USER:?MINIO_APP_USER missing from .env}" \
  --set-string "secrets.objectStorage.secretKey=${MINIO_APP_PASSWORD:?MINIO_APP_PASSWORD missing from .env}" \
  --set-string "secrets.objectStorage.bucket=${MINIO_BUCKET:-bank-usac}" \
  --set-string "secrets.databases.customer.password=${CUSTOMER_POSTGRES_PASSWORD:?CUSTOMER_POSTGRES_PASSWORD missing from .env}" \
  --set-string "secrets.databases.account.password=${ACCOUNT_POSTGRES_PASSWORD:?ACCOUNT_POSTGRES_PASSWORD missing from .env}" \
  --set-string "secrets.databases.transaction.password=${TRANSACTION_POSTGRES_PASSWORD:?TRANSACTION_POSTGRES_PASSWORD missing from .env}" \
  --set-string "secrets.databases.payment.password=${PAYMENT_POSTGRES_PASSWORD:?PAYMENT_POSTGRES_PASSWORD missing from .env}" \
  --set-string "secrets.databases.notificationAudit.password=${NOTIFICATION_AUDIT_POSTGRES_PASSWORD:?NOTIFICATION_AUDIT_POSTGRES_PASSWORD missing from .env}"

# Database names and roles come from the same file rather than the chart's
# defaults. Commit 57dd88d fixed those defaults after they pointed every pod at
# the wrong role; taking them from .env means the two cannot drift again.
set -- "$@" \
  --set-string "databases.customer.name=${CUSTOMER_POSTGRES_DB:-customer}" \
  --set-string "databases.customer.user=${CUSTOMER_POSTGRES_USER:-customer_app}" \
  --set-string "databases.account.name=${ACCOUNT_POSTGRES_DB:-account}" \
  --set-string "databases.account.user=${ACCOUNT_POSTGRES_USER:-account_app}" \
  --set-string "databases.transaction.name=${TRANSACTION_POSTGRES_DB:-transaction}" \
  --set-string "databases.transaction.user=${TRANSACTION_POSTGRES_USER:-transaction_app}" \
  --set-string "databases.payment.name=${PAYMENT_POSTGRES_DB:-payment}" \
  --set-string "databases.payment.user=${PAYMENT_POSTGRES_USER:-payment_app}" \
  --set-string "databases.notificationAudit.name=${NOTIFICATION_AUDIT_POSTGRES_DB:-notification_audit}" \
  --set-string "databases.notificationAudit.user=${NOTIFICATION_AUDIT_POSTGRES_USER:-notification_audit_app}"

# The seven image tags. Not optional — see the note above `services:` in values.yaml.
set -- "$@" \
  --set-string "services.customer.image.tag=${tag}" \
  --set-string "services.account.image.tag=${tag}" \
  --set-string "services.transaction.image.tag=${tag}" \
  --set-string "services.payment.image.tag=${tag}" \
  --set-string "services.notificationAudit.image.tag=${tag}" \
  --set-string "gateway.image.tag=${tag}" \
  --set-string "web.image.tag=${tag}"

[[ "$dry_run" == "true" ]] && set -- "$@" --dry-run

if [[ "$print_only" == "true" ]]; then
  echo "helm $*"
  exit 0
fi

echo "Releasing ${RELEASE} into ${KUBE_CONTEXT}, namespace ${NAMESPACE}, at tag ${tag}…"
helm "$@"

if [[ "$dry_run" != "true" ]]; then
  echo
  # `kubectl wait --for=condition=available` is the wrong check on an upgrade:
  # during a rolling update the OLD replicas still satisfy availability, so it
  # returns "condition met" while the new pods are still starting — and the
  # summary below then shows a mix of both. `rollout status` waits for the new
  # ReplicaSet specifically, which is what "the release is live" actually means.
  echo "Waiting for all seven workloads to roll out (up to 3 minutes each)…"
  rollout_failed=false
  for component in \
    customer-service account-service transaction-service payment-service \
    notification-audit-service gateway web; do
    kubectl rollout status --context "$KUBE_CONTEXT" -n "$NAMESPACE" \
      "deploy/${RELEASE}-${component}" --timeout=180s || rollout_failed=true
  done
  if [[ "$rollout_failed" == "true" ]]; then
    echo >&2
    echo "Not everything rolled out. The usual causes, in order of likelihood:" >&2
    echo "  · an image the node does not have — rebuild and reload:" >&2
    echo "      pnpm images:build -- --kind bank-usac" >&2
    echo "  · a stale external IP in the Endpoints — rediscover and reinstall:" >&2
    echo "      pnpm k8s:ips && pnpm k8s:install" >&2
    echo "Diagnose with:" >&2
    echo "  kubectl --context ${KUBE_CONTEXT} get pods -n ${NAMESPACE}" >&2
    echo "  kubectl --context ${KUBE_CONTEXT} describe pod -n ${NAMESPACE} <pod>" >&2
    echo "See docs/operations/DEPLOYMENT.md, 'Cuando algo falla'." >&2
    exit 1
  fi
  echo
  kubectl get pods --context "$KUBE_CONTEXT" -n "$NAMESPACE" -o wide
fi
