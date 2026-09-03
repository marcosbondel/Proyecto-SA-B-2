---
name: run-k8s-local
description: Levanta Bank USAC sobre el clúster local de Kubernetes (kind + Helm) tal como se despliega hoy — infraestructura en Docker fuera del clúster, las siete cargas de trabajo dentro, port-forwards abiertos y verificados desde la sesión. A diferencia de la skill `run`, ésta no se detiene ante un fallo de infraestructura: lo diagnostica y lo repara con el remedio conocido (contexto ausente, clúster sin crear o en la red equivocada, contenedores caídos, IPs de Endpoints obsoletas, imágenes que faltan, builder de Docker atascado, port-forwards zombis, release a medio aplicar) y reintenta, insistiendo hasta que la aplicación responde. Úsala cuando pidan correr, levantar o desplegar la aplicación en Kubernetes, o cuando el despliegue en kind esté roto y haya que devolverlo a verde.
---

Levantar el sistema sobre el **clúster local de Kubernetes**: las cinco
PostgreSQL, RabbitMQ y MinIO como contenedores Docker **fuera** del clúster, y
el Gateway, el frontend y los cinco servicios de dominio **dentro**, por un solo
release de Helm. Es la vía que el enunciado exige (§4.2) y la que
[`docs/operations/DEPLOYMENT.md`](../../../docs/operations/DEPLOYMENT.md)
documenta; esta skill la ejecuta entera desde la sesión.

No confundir con la skill `run`, que levanta las aplicaciones en el host con
`pnpm dev:host`. Ésta despliega imágenes construidas sobre kind.

**Esta skill lo hace todo desde la sesión**: no entrega comandos al usuario ni
deja pasos manuales. Deja los port-forwards vivos en segundo plano y un monitor
que vigila la salud de los pods.

## Regla de operación: reparar, no rendirse

El objetivo es **la aplicación respondiendo**. Ante un fallo de infraestructura
no te detengas a pedir permiso: diagnostica, aplica el remedio del catálogo de
abajo, y vuelve a verificar. Insiste.

Tres límites, para que insistir no se vuelva dar vueltas:

- **Dos pasadas por el catálogo como máximo.** Si tras reparar y reintentar dos
  veces el mismo síntoma sigue, para y reporta con la salida real.
- **Repara infraestructura, no código.** Contenedores, contextos, imágenes,
  redes, releases: todo eso es tuyo. Si la causa es un defecto de la
  aplicación —un servicio que arranca y se cae por su propia lógica— repórtalo
  con sus logs en vez de tapar el síntoma reiniciando en bucle.
- **Nada destructivo sin avisar.** `docker builder prune` (libera caché, no
  toca imágenes) y matar port-forwards huérfanos son reparaciones normales, se
  hacen y se mencionan. Borrar o recrear el clúster, tumbar contenedores con
  datos, o `helm uninstall`, se **consultan antes**: pueden costar minutos o
  datos sembrados.

Al final, el reporte dice **qué se reparó por el camino**. Un despliegue que
necesitó tres arreglos y quedó verde es información útil, no un detalle a
esconder.

## Pasos

Todo desde la raíz del repositorio.

1. **Docker.** `docker -v` y luego `docker info`. Si no está instalado o el
   daemon está apagado, esto no se puede reparar desde aquí: detente y pide
   iniciar Docker Desktop. Es el único prerrequisito que no es tuyo.

2. **Herramientas del clúster.** `kind version`, `helm version --short`,
   `kubectl version --client`. Si falta alguna, detente y reporta cuál, con el
   remedio (`brew install kind helm kubernetes-cli`). Las versiones probadas
   están en el runbook; una distinta se menciona pero no bloquea.

3. **Credenciales.** `infra/docker/.env` debe existir; si no,
   `cp infra/docker/.env.example infra/docker/.env` y avísalo. `pnpm k8s:install`
   lee de ahí los nueve secretos que el chart exige.

4. **Infraestructura fuera del clúster.** `pnpm dev:infra`, y sondea
   `docker ps --filter network=bank-usac-local` hasta que las cinco PostgreSQL,
   RabbitMQ y MinIO lean `healthy`. Si alguna aparece `Exited`, arráncala
   (`docker start <nombre>`) antes de seguir — un contenedor detenido a mano en
   una prueba anterior es la causa más frecuente de un pod que nunca llega a
   `Ready`.

5. **El clúster.** `pnpm k8s:cluster` es idempotente: crea el clúster si falta y
   no hace nada si existe. Verifica además que el nodo esté en la red
   compartida, porque es de lo que depende todo lo demás:

   ```bash
   docker inspect bank-usac-control-plane \
     -f '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}'
   ```

   Debe decir `bank-usac-local`. Si no, el clúster se creó sin
   `KIND_EXPERIMENTAL_DOCKER_NETWORK` y ningún pod alcanzará una base; hay que
   recrearlo (`pnpm k8s:cluster -- --recreate`) — **consúltalo antes**, porque
   se pierde lo desplegado.

6. **Imágenes.** `pnpm images:build -- --kind bank-usac` construye las siete y
   las carga en el nodo. Es cacheado: si nada cambió desde el último build,
   tarda poco. Puedes saltarlo si el nodo ya tiene imágenes del commit actual;
   `pnpm k8s:install` lo comprueba por su cuenta y lo dice.

7. **Desplegar.** `pnpm k8s:install`. Redescubre las IPs de los contenedores
   externos, arma los dieciséis valores requeridos, aplica el release y espera
   el rollout de las siete cargas. Lee su salida entera: avisa por sí solo si
   está desplegando un tag anterior a HEAD y si eso implica o no código de
   aplicación distinto.

8. **Port-forwards.** Mata primero cualquier huérfano
   (`pkill -f "kubectl.*port-forward"`), y lanza `pnpm k8s:forward` en segundo
   plano (`run_in_background` — bloquea, no retorna). Abre 3000 al Gateway y
   3010 al frontend. Esos dos puertos no son negociables: el navegador resuelve
   `web.apiBaseUrl` y el Gateway solo acepta `gateway.corsAllowedOrigins`, así
   que reenviar a otros da un error de CORS.

9. **Verificar de verdad.** No declares nada arriba sin esto:

   ```bash
   kubectl get pods -n bank-usac --context kind-bank-usac   # los 7 en 1/1 Running
   curl -sf http://localhost:3000/ready                     # broker connected
   curl -sf -o /dev/null http://localhost:3010              # el frontend sirve
   ```

   Si algún pod está `Running` pero no `Ready`, pregúntale por qué antes de
   suponer: `kubectl exec -n bank-usac deploy/bank-usac-<componente> --
   wget -qO- http://127.0.0.1:<puerto>/ready` nombra la dependencia que falta.

10. **Monitor de salud.** Con todo verde, deja un monitor persistente
    (herramienta `Monitor`, `persistent: true`) que avise **solo cuando cambie**
    el estado, no en cada vuelta:

    ```bash
    prev=""
    while true; do
      bad="$(kubectl get pods -n bank-usac --context kind-bank-usac --no-headers 2>&1 \
        | grep -vE '1/1 +Running' || true)"
      curl -sf -o /dev/null --max-time 4 http://localhost:3000/ready \
        || bad="${bad}"$'\n'"gateway no responde en localhost:3000"
      if [ "$bad" != "$prev" ]; then
        [ -n "$bad" ] && echo "DEGRADADO: $(echo "$bad" | tr '\n' ' ')" \
                      || echo "RECUPERADO: los siete pods Ready y el gateway responde"
        prev="$bad"
      fi
      sleep 30
    done
    ```

    Cuando llegue una notificación: diagnostica con el catálogo, repara si es
    infraestructura, y reporta. Si el usuario detiene el despliegue, detén
    también el monitor (`TaskStop`).

11. **Reporte final.** Enlaces, credenciales, lo que se reparó, y cómo parar.

## Catálogo de fallos y su remedio

Cada uno se ha visto de verdad en este repositorio.

| Síntoma | Causa | Remedio |
| --- | --- | --- |
| `couldn't get current server API group list` (×6) y `Error from server (NotFound)` | No hay `current-context`. Borrar un clúster —`kind delete cluster`, o el `gcloud` de otro proyecto— se lleva el suyo. | `kubectl config use-context kind-bank-usac`. Los `pnpm k8s:*` fijan el suyo y no se ven afectados. |
| El release aparece en un clúster que no es el tuyo | Un script leyó el contexto ambiental. | Ya no debería pasar: los scripts están fijados a `kind-bank-usac` y rechazan un contexto no-kind. Si ocurre, es un script sin fijar: arréglalo. |
| Pods en `ImagePullBackOff` / `ErrImageNeverPull` | No hay registro; el nodo no tiene esa etiqueta. | `pnpm images:build -- --kind bank-usac`. Los pods se recuperan solos cuando la imagen aparece, aunque el backoff de kubelet puede tardar varios minutos. |
| `helm upgrade` colgado en `rollout status`; `1 old replicas are pending termination` | Los pods nuevos no arrancan (casi siempre imágenes), así que los viejos no pueden terminar. | Igual que arriba. `pnpm k8s:install` lo detecta antes de tocar el clúster. |
| Build falla con `DeadlineExceeded: context deadline exceeded` | Buildkit ahogado por caché acumulada. | `docker builder prune -f` y reintenta una vez. Libera capas intermedias; no toca imágenes, contenedores ni volúmenes. |
| `build-images.sh` rehúsa: *working tree has uncommitted changes* | El tag sale del commit; un árbol sucio no describe lo que corre. | Commitea, o usa `--allow-dirty` (etiqueta `-dirty`) diciéndolo en el reporte. |
| Pod `Running` pero nunca `Ready` | Una dependencia no responde: IP de Endpoints obsoleta, o el contenedor detenido. | Primero `docker ps -a` — si la base está `Exited`, `docker start`. Si corre, las IPs cambiaron al recrearse: `pnpm k8s:ips && pnpm k8s:install`. |
| Ningún pod alcanza ninguna base, aunque los contenedores estén sanos | El clúster no está en `bank-usac-local`. | `pnpm k8s:cluster -- --recreate` — **consúltalo antes**. `docker network connect` no sirve: kind deriva su red al crearse. |
| `Unable to listen on port 3000: address already in use` | Port-forwards huérfanos de un intento anterior. | `pkill -f "kubectl.*port-forward"` y relanza `pnpm k8s:forward`. |
| El navegador da error de CORS | Los puertos reenviados no son 3000/3010. | Usa `pnpm k8s:forward`, que los fija. |
| El release quedó `pending-upgrade` o `failed` | Un `helm` interrumpido a media aplicación. | `helm rollback bank-usac --kube-context kind-bank-usac -n bank-usac` a la última revisión sana, y vuelve a desplegar. |
| Un servicio arranca y se cae solo, repetidamente | Defecto de aplicación, no de infraestructura. | **No lo repares reiniciando.** Reporta con `kubectl logs --previous` y el motivo de terminación. |

## Notas

- El procedimiento completo, con prerrequisitos y desmontaje, está en
  [`docs/operations/DEPLOYMENT.md`](../../../docs/operations/DEPLOYMENT.md).
- Para capturar el estado del clúster como evidencia: `pnpm k8s:evidence` —
  solo lee, y escribe en `specs/008-audit-remediation/evidence/`.
- Para ejercitar la Saga completa contra el clúster (tres formas, saldos antes
  y después):

  ```bash
  BANK_LOGS_CMD="kubectl logs --context kind-bank-usac -n bank-usac \
    deploy/bank-usac-notification-audit-service --tail 400" \
    ./infra/docker/scripts/flow-images.sh
  ```

- Para parar: `pnpm k8s:down` quita el release y deja el clúster;
  `pnpm k8s:cluster:down` borra el clúster; `pnpm dev:infra:down` para las
  dependencias externas. Los port-forwards y el monitor mueren con la sesión.
- `external.mode=hostFallback` está declarado pero **nunca se ha ejercitado**
  (TD-058). Si la red compartida falla, no lo ofrezcas como salida probada.
