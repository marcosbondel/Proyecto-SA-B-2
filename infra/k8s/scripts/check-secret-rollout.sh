#!/usr/bin/env bash
#
# Comprueba que rotar una credencial **ruede los pods** (TD-089).
#
# Por qué existe. Un pod no vuelve a leer un ConfigMap ni un Secret: los lee una
# vez al arrancar. Si el `podTemplate` no lleva el hash de los dos, dar de alta o
# rotar una credencial no cambia nada en el Deployment, Kubernetes no reemplaza
# ningún pod, y **los procesos siguen con el valor anterior**. El despliegue sale
# verde.
#
# El modo de fallo es lo que lo hace peligroso: no es un error, es un rechazo
# CORRECTO de un valor equivocado. El 2026-10-14, con el token interbancario
# recién añadido al Secret, el Gateway contestaba `401 UNAUTHENTICATED` con un
# `correlationId` y ninguna pista de por qué — porque seguía usando el token
# vacío que había leído al arrancar.
#
# Lo que `helm lint` no puede ver: una anotación que falta es YAML perfectamente
# válido. Y lo que un ojo tampoco: TD-089 afirmaba que «los siete Deployments
# anotan `checksum/config`», y al renderizar resultó que **sólo tres** llevaban
# alguna anotación y **uno solo** la del Secret.
#
# Comprueba las dos mitades:
#
#   1. que los siete componentes lleven los hashes que les corresponden, y
#   2. que el hash del Secret **se mueva de verdad** al cambiar una credencial,
#      que es la propiedad y no la anotación.
#
# La (2) importa porque una anotación puede existir y apuntar a la plantilla
# equivocada, y entonces el hash es estable aunque el secreto cambie. Eso pasa
# todas las pruebas que miran el texto.
set -euo pipefail

chart="${1:-infra/k8s/helm/bank-usac}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

render() {
  helm template bank-usac "$chart" \
    --set secrets.jwtSecret=ci --set secrets.rabbitmq.password=ci \
    --set secrets.objectStorage.accessKey=ci --set secrets.objectStorage.secretKey=ci \
    --set secrets.databases.customer.password="${1:-ci}" \
    --set secrets.databases.account.password=ci \
    --set secrets.databases.transaction.password=ci \
    --set secrets.databases.payment.password=ci \
    --set secrets.databases.notificationAudit.password=ci \
    --set rabbitmq.inCluster=true --set minio.inCluster=true \
    --set external.postgresCustomer.dockerNetwork.host=10.0.0.3 \
    --set external.postgresAccount.dockerNetwork.host=10.0.0.4 \
    --set external.postgresTransaction.dockerNetwork.host=10.0.0.5 \
    --set external.postgresPayment.dockerNetwork.host=10.0.0.6 \
    --set external.postgresNotificationAudit.dockerNetwork.host=10.0.0.7
}

render ci > "$tmp/base.yaml"
render rotada > "$tmp/rotada.yaml"

fallos=0
mal() { echo "  FALLO: $*" >&2; fallos=$((fallos + 1)); }

# Los seis que leen el Secret, y `web`, que no lo lee y por eso sólo lleva el
# hash del ConfigMap: anotarle uno de un Secret que no consume seria ruido que
# rueda su pod por nada.
leen_secreto=(gateway customer-service account-service transaction-service
  payment-service notification-audit-service)

# El hash de un componente, leyendo **un documento a la vez**.
#
# `RS` separa por documento de YAML, que es lo que hace esto correcto: la primera
# version recorria el fichero entero de arriba abajo y, en cuanto encontraba el
# nombre, imprimia la siguiente anotacion que viera — que podia ser de otro
# Deployment. Pasaba las dos mutaciones con las que se comprobo. Un guard que no
# falla cuando debe es peor que no tener guard, porque da por verificado lo que
# no mira.
hash_de() { # fichero, deployment, anotación
  awk -v RS='---' -v d="bank-usac-$2" -v a="$3" '
    # `kind: Deployment` Y el nombre, en el mismo documento. Sin el `kind`
    # coincidian tres —ServiceAccount, Deployment y Service se llaman igual—
    # y salia en el primero, que no tiene anotaciones: la funcion devolvia
    # vacio para todos y el guard fallaba en bloque. Es el error opuesto al de
    # la primera version, y se encontro igual: mutando.
    $0 ~ "\nkind: Deployment\n" && $0 ~ "\n  name: " d "\n" {
      if (match($0, a ": [a-f0-9]+")) {
        linea = substr($0, RSTART, RLENGTH)
        sub(/.*: /, "", linea)
        print linea
      }
      exit
    }
  ' "$1"
}

echo "  Los hashes que cada componente debe llevar:"
for c in "${leen_secreto[@]}"; do
  cfg="$(hash_de "$tmp/base.yaml" "$c" "checksum/config")"
  sec="$(hash_de "$tmp/base.yaml" "$c" "checksum/secret")"

  [[ -n "$cfg" ]] || mal "$c no anota checksum/config: un cambio de ConfigMap no lo rueda"
  [[ -n "$sec" ]] || mal "$c no anota checksum/secret: rotar una credencial no lo rueda"
done
[[ -n "$(hash_de "$tmp/base.yaml" "web" "checksum/config")" ]] ||
  mal "web no anota checksum/config"
echo "  ok  los siete componentes"

echo "  Y que el hash se mueva de verdad al rotar:"
for c in "${leen_secreto[@]}"; do
  antes="$(hash_de "$tmp/base.yaml" "$c" "checksum/secret")"
  despues="$(hash_de "$tmp/rotada.yaml" "$c" "checksum/secret")"

  if [[ -n "$antes" && "$antes" == "$despues" ]]; then
    mal "$c: el checksum/secret NO cambio al rotar una credencial — la anotacion existe y no sirve"
  fi
done
# Y la otra mitad de la propiedad: lo que no cambio, no rueda. Un hash del
# ConfigMap que se moviera al tocar un Secret rodaria los pods por partida doble
# y, peor, haria indistinguibles las dos causas en un `kubectl describe`.
for c in "${leen_secreto[@]}"; do
  antes="$(hash_de "$tmp/base.yaml" "$c" "checksum/config")"
  despues="$(hash_de "$tmp/rotada.yaml" "$c" "checksum/config")"

  if [[ -n "$antes" && "$antes" != "$despues" ]]; then
    mal "$c: el checksum/config cambio al rotar un Secret — los dos hashes miran lo mismo"
  fi
done
echo "  ok  el hash del Secret se mueve y el del ConfigMap no"

if ((fallos > 0)); then
  echo "" >&2
  echo "$fallos problema(s): rotar una credencial no rodaria todos los pods (TD-089)" >&2
  exit 1
fi
echo "  Rotar una credencial rueda los seis pods que la leen."
