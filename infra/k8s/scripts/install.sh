#!/usr/bin/env bash
#
# Release the Bank USAC chart onto the local kind cluster.
#
#   ./infra/k8s/scripts/install.sh                  # discover IPs, then install
#   ./infra/k8s/scripts/install.sh --tag 2703cb03c161
#   ./infra/k8s/scripts/install.sh --dry-run        # render, do not apply
#   ./infra/k8s/scripts/install.sh --print          # print the helm command only
#   ./infra/k8s/scripts/install.sh --values infra/k8s/kind/local.values.yaml
#                                                   # telemetria al Collector del
#                                                   # propio cluster y el banco
#                                                   # pareja simulado encendido
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
# Archivos de valores extra, en orden. Lo que llega por aqui gana sobre el
# `values.yaml` del chart y sobre el generado de las IPs externas, que es
# exactamente lo que hace falta para el camino local: la telemetria apuntando
# al Collector del propio cluster y el banco pareja simulado encendido, sin
# tocar los valores con los que se despliega la nube.
extra_values=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --values|-f)
      [[ -f "${2:?--values needs a file}" ]] || { echo "ERROR: no existe el archivo de valores '$2'." >&2; exit 2; }
      extra_values+=("$2"); shift 2 ;;
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

# Se captura la lista ANTES de buscar en ella, y no se encadena
# `kubectl … | grep -q`. El motivo es una carrera real, no estilo: `grep -q`
# termina en cuanto encuentra la linea y cierra el pipe, `kubectl` muere con
# SIGPIPE (141) y `pipefail` convierte eso en un fallo de la tuberia entera. El
# sintoma era «el contexto no existe» seguido de una lista en la que SI aparece,
# y empeoraba a medida que se acumulaban contextos en el kubeconfig.
contexts="$(kubectl config get-contexts -o name 2>/dev/null || true)"
if ! printf '%s\n' "$contexts" | grep -qx "$KUBE_CONTEXT"; then
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
          notification-audit-service gateway web \
          partner-bank-mock; do
          # `partner-bank-mock` es el doble de prueba de T-57. Se carga si
          # existe y se ignora si no: el chart lo deja apagado, así que un
          # clúster sin esa imagen es el caso normal, no un error.
          kind load docker-image --name "$kind_cluster" "bank-usac/${component}:${tag}" >/dev/null 2>&1
        done
        # Volver a preguntarle al nodo. `node_images` se capturo ANTES de
        # cargar, asi que la comprobacion de mas abajo la haria contra una foto
        # vieja y concluiria que no hay imagenes utilizables — justo despues de
        # haberlas puesto. El sintoma era que la PRIMERA instalacion tras una
        # construccion siempre fallaba y la segunda funcionaba sin explicacion.
        node_images="$(docker exec "$node" crictl images 2>/dev/null || true)"
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

# `--force-conflicts`: Helm 4 aplica del lado del servidor, y un
# `kubectl set image` o `kubectl set env` de una prueba anterior (los escenarios
# de carga cambian el mock asi) deja al gestor `kubectl-set` como dueno del
# campo. El siguiente upgrade fallaba entero con "conflict with kubectl-set
# … .containers[name=app].image" en cinco Deployments. En este cluster local el
# chart es la unica fuente de verdad, asi que gana el chart.
set -- \
  upgrade --install "$RELEASE" "$CHART" \
  --kube-context "$KUBE_CONTEXT" \
  --namespace "$NAMESPACE" --create-namespace \
  --force-conflicts

[[ -f "$GENERATED" ]] && set -- "$@" -f "$GENERATED"

# Despues del generado a proposito: el ultimo `-f` gana en Helm.
for valores in ${extra_values[@]+"${extra_values[@]}"}; do
  set -- "$@" -f "$valores"
done

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

# The Gateway's Service type. The chart defaults to LoadBalancer because that
# is what GKE needs (TD-080), and kind has no load-balancer controller: the
# Service would hang at `<pending>` for the whole session while the browser
# comes in through port-forward.sh regardless. ClusterIP keeps the local
# install, and the evidence captured from it, exactly as it was.
set -- "$@" --set-string "gateway.serviceType=ClusterIP"

# The activation link in the notification service's log. The chart's default is
# "false" since T-60 (the log reaches Loki in the cloud, and a complete link is
# an account-takeover URL), but on kind the log is the only mailbox there is:
# `pnpm k8s:install` without `--values` would otherwise leave nobody able to
# sign up. Only for a kind context; --allow-remote-context gets the chart's own
# default, and `-f local.values.yaml` says the same thing for `local:up`.
# A values file that names the key keeps its say (`--set` would override it).
reveal_decided=false
for valores in ${extra_values[@]+"${extra_values[@]}"}; do
  grep -q 'revealActivationLinks' "$valores" && reveal_decided=true
done
if [[ "$allow_remote" != "true" && "$reveal_decided" != "true" ]]; then
  set -- "$@" --set-string "services.notificationAudit.revealActivationLinks=true"
fi

# The seven image tags. Not optional — see the note above `services:` in values.yaml.
#
# Y el del doble de prueba de T-57, con el MISMO tag. No es simetria: el chart
# lo deja en `:dev` y el nodo solo tiene cargado el tag del commit, asi que sin
# esa linea el pod del mock se queda en ErrImagePull en cuanto alguien lo
# enciende — que es lo que paso la primera vez que se levanto el camino local.
# Con el mock apagado el valor no se usa y no molesta.
set -- "$@" \
  --set-string "services.customer.image.tag=${tag}" \
  --set-string "services.account.image.tag=${tag}" \
  --set-string "services.transaction.image.tag=${tag}" \
  --set-string "services.payment.image.tag=${tag}" \
  --set-string "services.notificationAudit.image.tag=${tag}" \
  --set-string "gateway.image.tag=${tag}" \
  --set-string "web.image.tag=${tag}" \
  --set-string "partnerMock.image.tag=${tag}"

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
