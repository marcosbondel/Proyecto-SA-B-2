# Despliegue en Kubernetes (local, kind)

Cómo llevar Bank USAC a un clúster **local** de Kubernetes, desde una máquina
limpia, y cómo comprobar que quedó bien.

> **¿Buscas el despliegue en la nube?** Está en [CLOUD.md](CLOUD.md): GKE, las
> cinco VMs de Compute Engine, Cloud Run y el pipeline que despliega. Este
> documento es el clúster local con kind, que sigue siendo el camino corto para
> desarrollar y probar, y no está sustituido por aquél — los dos instalan **el
> mismo chart**, y lo único que cambia es a qué apuntan `postgres-customer`,
> `rabbitmq` y `minio`.

Este documento es el procedimiento. La decisión que le da forma —por qué kind,
por qué un chart de Helm y no manifiestos sueltos, y por qué las bases de datos
viven fuera— está en
[ADR-007](../architecture/adr/ADR-007-local-orchestration.md); el inventario de
las siete imágenes está en [CONTAINERS.md](CONTAINERS.md); y la distribución
física la dibuja el
[diagrama de despliegue](../architecture/diagrams/05-uml-despliegue.puml).

## Qué se despliega, y qué no

**Dentro del clúster** van los siete componentes que el equipo escribe: el API
Gateway, el frontend Nuxt y los cinco microservicios de dominio. Cada uno es un
Deployment más un Service `ClusterIP`.

**Fuera del clúster** corren las cinco bases PostgreSQL, RabbitMQ y MinIO, como
contenedores Docker. No es una simplificación: el enunciado lo exige
(§4.2, *"bases de datos externas al cluster"*) y la constitución del proyecto lo
recoge como principio III. Los pods las alcanzan por Services sin selector
respaldados por Endpoints que apuntan a la IP real de cada contenedor en la red
Docker compartida `bank-usac-local`.

```
Host de desarrollo
├── Docker Engine
│   ├── postgres-customer · postgres-account · postgres-transaction
│   ├── postgres-payment  · postgres-notification-audit
│   ├── rabbitmq · minio
│   └── kind (nodo control-plane)  ← todos en la red bank-usac-local
└── Clúster kind, namespace bank-usac
    └── gateway · web · customer · account · transaction · payment · notification-audit
```

## Prerrequisitos

| Herramienta | Versión probada | Comprobar con |
| --- | --- | --- |
| Docker | Desktop, en ejecución | `docker info` |
| kind | v0.33.0 | `kind version` |
| helm | v4.2.4 | `helm version --short` |
| kubectl | v1.34.1 | `kubectl version --client` |
| Node | 24.19.0 (`.nvmrc`) | `node --version` |
| pnpm | 11.21.0 | `pnpm --version` |

Y un `infra/docker/.env` con credenciales:

```bash
cp infra/docker/.env.example infra/docker/.env   # y complétalo
```

Ese archivo es la única fuente de credenciales. `pnpm k8s:install` lee de ahí
las nueve contraseñas que el chart marca como `required`, de modo que Compose y
el clúster usan las mismas y no pueden desincronizarse.

## Puesta en marcha

Cuatro comandos desde la raíz del repositorio:

```bash
pnpm dev:infra                          # 1. las dependencias, fuera del clúster
pnpm k8s:cluster                        # 2. crear el clúster kind
pnpm images:build -- --kind bank-usac   # 3. construir y cargar las siete imágenes
pnpm k8s:install                        # 4. desplegar
```

Qué hace cada uno, y por qué está donde está:

1. **`pnpm dev:infra`** levanta PostgreSQL ×5, RabbitMQ y MinIO en la red
   `bank-usac-local`. Va primero porque el paso 4 necesita descubrir sus IPs.
2. **`pnpm k8s:cluster`** crea el clúster **sobre esa misma red**. Ese es el
   único detalle delicado del procedimiento: kind no tiene ningún campo en
   `cluster.yaml` para unirse a una red existente, así que se expresa con una
   variable de entorno en el comando de creación
   (`KIND_EXPERIMENTAL_DOCKER_NETWORK=bank-usac-local`), y **tiene que estar
   antes de crear el clúster** — kind fija la red de sus nodos en ese momento y
   no sabe moverlos después. El script la pone por ti; si alguna vez creaste el
   clúster a mano sin ella, hay que borrarlo y rehacerlo
   (`pnpm k8s:cluster -- --recreate`), no basta con `docker network connect`.
3. **`pnpm images:build -- --kind bank-usac`** construye las siete imágenes,
   las etiqueta con el commit que llevan dentro y las carga en el nodo con
   `kind load docker-image`. No hay registro: las imágenes nunca salen de la
   máquina.
4. **`pnpm k8s:install`** vuelve a descubrir las IPs de los contenedores
   externos, arma los dieciséis valores que el chart exige (nueve secretos y
   siete etiquetas de imagen) y ejecuta `helm upgrade --install`. Después espera
   a que los siete Deployments queden disponibles.

> **Las IPs se redescubren en cada instalación a propósito.** Docker las
> reasigna cuando un contenedor se recrea, y una dirección vieja en los
> Endpoints no da un error de renderizado: da un pod que se queda `Running` y
> nunca llega a `Ready`. Es un fallo silencioso, y por eso el paso 4 no confía
> en el archivo generado la vez anterior.

Para ver el `helm upgrade --install` real que se ejecuta por debajo:

```bash
./infra/k8s/scripts/install.sh --print
```

## Verificación

```bash
pnpm k8s:status
```

Los siete pods deben decir `1/1 Running`:

```
NAME                                    READY   STATUS    RESTARTS   AGE
bank-usac-account-service-…             1/1     Running   0          2m
bank-usac-customer-service-…            1/1     Running   0          2m
bank-usac-gateway-…                     1/1     Running   0          2m
bank-usac-notification-audit-service-…  1/1     Running   0          2m
bank-usac-payment-service-…             1/1     Running   0          2m
bank-usac-transaction-service-…         1/1     Running   0          2m
bank-usac-web-…                         1/1     Running   0          2m
```

Y las dependencias deben estar **fuera**, lo que se comprueba con `docker ps` y
no con `kubectl get pods` — que es exactamente el punto:

```bash
docker ps --filter network=bank-usac-local
```

Para dejar constancia de todo lo anterior en un archivo:

```bash
pnpm k8s:evidence
```

Escribe `specs/008-audit-remediation/evidence/cluster-state.log` con la salida
real de cada comando, incluida la respuesta de `/ready` de los siete
componentes. Solo lee; no crea, escala ni reinicia nada, así que es seguro
ejecutarlo minutos antes de una demostración.

## Acceso

El clúster es de un solo nodo, sin controlador de Ingress y sin balanceador, así
que la puerta es `kubectl port-forward` — la vía que el propio enunciado
describe:

```bash
pnpm k8s:forward     # 3000 → gateway, 3010 → web
```

Luego <http://localhost:3010>.

> **Los dos puertos no son arbitrarios.** El navegador resuelve por su cuenta
> `web.apiBaseUrl` (`http://localhost:3000`), y el Gateway solo acepta el origen
> `gateway.corsAllowedOrigins` (`http://localhost:3010`). Si reenvías cualquiera
> de los dos a otro puerto sin cambiar también esos dos valores del chart, el
> resultado es un error de CORS en el navegador, no una caída en el clúster.

## Ejecutar la Saga completa sobre el clúster

Las imágenes desplegadas son los mismos artefactos que corren bajo Compose, así
que el guion del flujo sirve para ambos. Lo único que cambia es dónde está el
Gateway y cómo se lee el log del servicio de notificaciones:

```bash
pnpm k8s:forward &

BANK_LOGS_CMD="kubectl logs -n bank-usac deploy/bank-usac-notification-audit-service --tail 400" \
  ./infra/docker/scripts/flow-images.sh
```

Registra un cliente, lo activa por el enlace real, abre dos cuentas, fondea una
por la ruta de depósito del cajero y luego ejecuta la Saga en sus tres formas:
una transferencia que **COMPLETA**, un pago rechazado que **COMPENSA** al primer
intento, y uno que agota la escalera de reintentos y **COMPENSA** igual. Lee el
saldo antes y después de cada una, así que la compensación queda afirmada como
un hecho sobre el dinero y no como un estado que alguien escribió.

Desde T-44 ejecuta además una cuarta forma de compensación, la que alcanza un operador:
el administrador sube a 100 % la tasa de fallo del proveedor simulado por
`PUT /api/payments/simulation` (un `CLIENTE` recibe 403), la transferencia hecha mientras
tanto termina `COMPENSATED` con el saldo intacto, y la simulación se restaura y se
comprueba con una transferencia que **COMPLETA**. Usa al administrador sembrado, así que
también necesita `SEED_DEMO_DATA=true`.

## Escalado

`replicaCount` y `resources` se pueden fijar globalmente o por componente:

```bash
./infra/k8s/scripts/install.sh --print          # ver el comando base
helm upgrade bank-usac … --set gateway.replicaCount=3
```

Qué se puede escalar y qué no:

| Componente | ¿Más de una réplica? |
| --- | --- |
| `gateway`, `web` | Sí. El Gateway nombra su cola de respuestas con el nombre del pod (downward API), así que dos réplicas no colisionan. |
| `customer`, `transaction`, `payment`, `notification-audit` | Sí. Consumen colas durables compartidas; el broker reparte el trabajo entre réplicas, que es lo buscado. |
| `account` | **Todavía no.** Además de atender mensajes corre el trabajo periódico de desactivación de cuentas inactivas, y nada elige un único ejecutor: N réplicas harían la pasada N veces. |

No hay HPA ni metrics-server: el escalado es manual y declarado. Un clúster kind
de un nodo no da margen para autoescalar de forma significativa, y un HPA que no
puede medir es peor que ninguno.

## Cuando algo falla

**`ImagePullBackOff` o `ErrImageNeverPull`.** El pod nunca llegó a arrancar: no
hay nada en el nodo que satisfaga ese nombre de imagen. Las imágenes son
locales, no vienen de ningún registro.

```bash
pnpm images:build -- --kind bank-usac && pnpm k8s:install
```

**Un pod se queda `Running` pero nunca `Ready`.** Este es el caso normal cuando
una dependencia externa no responde, y está diseñado así: el puerto abre antes
que las migraciones y el broker, de modo que una base de datos ausente da un
`/ready` en 503 —que dice cuál falta— en vez de un `CrashLoopBackOff` que no
dice nada. Pregúntale al pod:

```bash
kubectl exec -n bank-usac deploy/bank-usac-customer-service \
  -- wget -qO- http://127.0.0.1:3001/ready
```

La causa más frecuente es una IP obsoleta en los Endpoints, porque algún
contenedor se recreó. Se arregla redescubriendo y reinstalando:

```bash
pnpm k8s:ips && pnpm k8s:install
```

**Los pods no alcanzan las bases aunque los contenedores estén sanos.** Casi
siempre el clúster se creó sin la red compartida. Compruébalo:

```bash
docker inspect bank-usac-control-plane \
  -f '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }}{{ end }}'
```

Si no dice `bank-usac-local`, hay que rehacerlo: `pnpm k8s:cluster -- --recreate`.
Como alternativa documentada existe `external.mode=hostFallback`, que usa
`host.docker.internal` contra los puertos publicados por Compose (5433-5437,
5673, 9002) en vez de la red compartida.

**Error de CORS en el navegador.** Los puertos reenviados no coinciden con
`web.apiBaseUrl` / `gateway.corsAllowedOrigins`. Usa `pnpm k8s:forward`.

**`kubectl` responde `couldn't get current server API group list`.** No es el
clúster: es que `kubectl` no tiene ninguno al que preguntar. Borrar un clúster
—con `kind delete cluster`, o el `gcloud` de otro proyecto— se lleva su contexto,
y si era el activo no deja ninguno en su lugar. Los comandos `pnpm k8s:*` fijan
el suyo y no se ven afectados; los `kubectl` a mano sí. Se arregla con:

```bash
kubectl config use-context kind-bank-usac
```

**Un `helm upgrade` que se queda colgado en `rollout status`.** Casi siempre son
imágenes que el nodo no tiene: los pods nuevos quedan en `ImagePullBackOff`, los
viejos no pueden terminar, y el backoff de kubelet crece hasta pasar cualquier
timeout razonable. `pnpm k8s:install` lo comprueba antes de tocar el clúster, así
que si llegaste aquí es porque se lanzó `helm` a mano. Reconstruye y vuelve a
lanzar con el script.

## Desmontaje

```bash
pnpm k8s:down            # quitar el release, dejar el clúster
pnpm k8s:cluster:down    # borrar el clúster kind
pnpm dev:infra:down      # parar las dependencias externas
```

## Ver también

- [ADR-007](../architecture/adr/ADR-007-local-orchestration.md) — por qué kind y Helm.
- [CONTAINERS.md](CONTAINERS.md) — las siete imágenes y sus variables.
- [infra/k8s/README.md](../../infra/k8s/README.md) — la estructura del chart.
- [architecture/deployment.md](../architecture/deployment.md) — el diagrama y su lectura.
