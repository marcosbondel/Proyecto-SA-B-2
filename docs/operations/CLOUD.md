# Despliegue en la nube (GCP)

De un proyecto de Google Cloud vacío a un sistema que responde. Es el
procedimiento de la **Fase 2**; su equivalente local —kind, Docker, un solo
comando— es [DEPLOYMENT.md](DEPLOYMENT.md), que sigue siendo el camino corto
para desarrollar y no está sustituido por éste.

La decisión de por qué GCP está en
[ADR-014](../architecture/adr/ADR-014-cloud-provider.md); por qué GitHub Actions,
en [ADR-015](../architecture/adr/ADR-015-ci-cd-platform.md); y por qué esta
topología —GKE para las cargas, cinco VMs para las bases, Cloud Run para el
frontend, un solo chart— en
[ADR-016](../architecture/adr/ADR-016-cloud-infrastructure.md). Lo que hace cada
workflow está en [CI.md](CI.md). Este documento es sólo el orden de los pasos.

## Lo que queda corriendo al final

| Pieza | Dónde | Cómo se actualiza |
| --- | --- | --- |
| Frontend Nuxt | Cloud Run, `bank-usac-web`, público por HTTPS | `cd.yml` al mergear a `main`, si existe la variable `CLOUD_RUN_SERVICE` |
| API Gateway | GKE, namespace `prod`, `Service` de tipo `LoadBalancer` en el puerto 3000, sobre la IP reservada por Terraform | `cd.yml` al mergear a `main` |
| Cinco servicios de dominio | GKE, namespace `prod` | `cd.yml` al mergear a `main` |
| RabbitMQ y MinIO | GKE, uno por namespace, sin volumen (TD-082) | con el resto del release |
| Cinco bases PostgreSQL | Cinco VMs de Compute Engine, subred privada, sin IP pública | `terraform apply` las aprovisiona; después, nada las toca |
| Entorno `dev` | GKE, namespace `dev`, con broker y MinIO propios | `cd.yml` al mergear a `develop`, sólo los componentes que cambiaron |
| Stack de observabilidad | GKE, namespace `observability`: Collector, agente de logs, Prometheus, Tempo, Loki y Grafana. Uno para los dos entornos | `cd.yml` al mergear a `main`, o a mano con `workflow_dispatch` |

**Los dos entornos comparten las cinco bases de datos.** Es una desviación
conocida y aceptada del enunciado, registrada como **TD-070** con su remedio;
léela antes de desplegar a `dev` creyendo que no toca producción.

---

## 0. Prerrequisitos

| Herramienta | Comprobar con |
| --- | --- |
| Google Cloud SDK | `gcloud version` |
| Terraform ≥ 1.5 | `terraform version` |
| kubectl | `kubectl version --client` |
| Helm 3 | `helm version` |

Y un proyecto de GCP con facturación habilitada, sobre el que tengas `owner` o,
como mínimo, permiso para crear redes, VMs, clústeres, repositorios de Artifact
Registry y servicios de Cloud Run.

```bash
export GCP_PROJECT_ID="tu-proyecto"
gcloud auth login
gcloud auth application-default login
gcloud config set project "$GCP_PROJECT_ID"

gcloud services enable \
  compute.googleapis.com container.googleapis.com run.googleapis.com \
  artifactregistry.googleapis.com cloudresourcemanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  storage.googleapis.com
```

---

## 1. La infraestructura, con Terraform

### 1.0 El bucket del estado, una vez por proyecto

El estado de Terraform vive en un bucket de GCS, no en el disco de quien hizo el
último `apply`. Es la diferencia entre que cualquiera del equipo pueda
planificar y que sólo una persona pueda. El bucket es el único recurso que el
módulo principal no puede crear —tendría que existir antes de guardar el estado
que lo crea—, así que lo declara un submódulo de arranque que corre una sola vez
con estado local:

```bash
cd infra/terraform/gcp/bootstrap
terraform init
terraform apply -var project_id="$GCP_PROJECT_ID"
terraform output -raw backend_hcl > ../backend.hcl
```

Queda un bucket `<proyecto>-tfstate` con versionado —lo que permite recuperarse
de un `apply` interrumpido— y acceso público prohibido. `backend.hcl` no se
commitea; la plantilla es `backend.hcl.example`.

### 1.1 El resto del sistema

```bash
cd infra/terraform/gcp
cp terraform.tfvars.example terraform.tfvars   # y edítalo: project_id y contraseñas
terraform init -backend-config=backend.hcl
terraform validate
terraform plan
terraform apply
```

Entre seis y diez minutos. Al terminar existen la VPC con sus dos subredes, el
Cloud NAT, las tres reglas de firewall, **las cinco VMs con PostgreSQL ya
instalado y su base creada**, el clúster de GKE con tres nodos, el repositorio
de Artifact Registry al que publica el pipeline, **la IP pública reservada del
Gateway** y el servicio de Cloud Run (todavía sirviendo el contenedor `hello` de
Google; el frontend real llega con el primer despliegue a `main`).

Guarda las salidas: son la entrada de los pasos siguientes.

```bash
terraform output github_repository_variables  # todas las variables del paso 3, ya con sus valores
terraform output database_private_ips         # las cinco IP privadas
terraform output -raw gke_get_credentials_command
terraform output -raw gateway_public_ip
terraform output -raw cloud_run_web_url
```

`github_repository_variables` existe para que el paso 3 sea copiar y pegar en
vez de recomponer siete valores de memoria — que es exactamente cómo
`ARTIFACT_REPO` y la IP del Gateway acabaron siendo infraestructura hecha a mano
(TD-079 y TD-080).

> **Si `terraform init` falla en Linux con un error de checksum**, es que
> `.terraform.lock.hcl` sólo tiene los hashes de la plataforma en la que se
> generó. Se arregla una vez y se commitea:
> `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`.

### Lo que Terraform **ya** crea, y antes no

Hasta el 2026-10-13 tres recursos del sistema en producción se creaban fuera del
módulo, con comandos que vivían en este documento: el repositorio de imágenes
(TD-079), la entrada pública del Gateway (TD-080) y la revisión de Cloud Run con
el frontend real (TD-081). El enunciado penaliza la infraestructura hecha a mano
—§8.3, p. 13 de la Fase II, y §4.2 de la Fase III repite la regla para el stack
de observabilidad— y las tres deudas están **cerradas**:

- **El repositorio de imágenes** lo declara `artifact_registry.tf`, con una
  política de limpieza que conserva todas las etiquetas `v*` y caduca las
  `dev-*` a los siete días. Si el repositorio ya existe en el proyecto,
  `terraform import google_artifact_registry_repository.images projects/$GCP_PROJECT_ID/locations/us-central1/repositories/bank-images`
  lo adopta sin recrearlo.
- **La IP pública del Gateway** la reserva `gateway_address.tf`, y el chart pone
  el `Service` en `LoadBalancer` por defecto con `gateway.loadBalancerIP`
  tomado de la variable `GATEWAY_STATIC_IP`. La reserva vive en el proyecto, no
  en el clúster: ya se puede borrar el Service, reinstalar el release o recrear
  el namespace sin perder la dirección. Eso es lo que permite escribir una URL
  estable en el acuerdo de integración con el banco pareja.
- **El frontend de Cloud Run** lo actualiza `cd.yml` en cada merge a `main`,
  siempre que exista la variable `CLOUD_RUN_SERVICE`.

Queda **una** desviación conocida, y no es un recurso: `dev` y `prod` comparten
las cinco bases de datos (**TD-070**).

### Lo que esto cuesta

El enunciado de la Fase 3 pide dimensionar para no agotar los créditos (§4.2,
Consideraciones de costo). Con los valores por defecto de `terraform.tfvars`:

| Recurso | Dimensión | Nota |
| --- | --- | --- |
| GKE, un pool zonal | 3 × `e2-standard-2` (6 vCPU, 24 GiB) | Las siete cargas piden 50 m de CPU cada una; el stack de observabilidad de T-49 (Collector, Prometheus, Tempo, Loki, Grafana, kube-state-metrics) cabe en torno a 1,3 vCPU y 4 GiB, así que **no hace falta subir el tipo de máquina** — sí vigilar el pico del HPA durante las pruebas de carga de T-51 |
| Cinco VMs de PostgreSQL | 5 × `e2-medium`, sin IP pública | Una por servicio, por el aislamiento de datos de la Fase 1 |
| Cloud Run | `min_instance_count = 0` | No cuesta nada mientras nadie abra el portal |
| IP reservada del Gateway | 1 dirección regional | Se cobra igual reservada que en uso; por eso `dev` usa una efímera |
| Artifact Registry | 7 imágenes por versión | La política de limpieza evita acumular una copia del sistema por commit |

Retención de telemetría: **7 días**, la que fija T-49, por la misma razón.

**Dos cuotas de la región mandan sobre el diseño** (medidas en el proyecto el
2026-10-13; `gcloud compute regions describe us-central1`):

| Cuota | Límite | Lo que consume el sistema | Margen |
| --- | --- | --- | --- |
| `INSTANCES` | 8 | cinco VMs de PostgreSQL + tres nodos de GKE = **8** | **cero** |
| `IN_USE_ADDRESSES` | 4 | Cloud NAT, el Gateway de `prod` y el de `dev` = 3 | 1 |
| `CPUS` | 32 | 6 (nodos) + 10 (VMs) = 16 | 16 |

De ahí dos reglas para el stack de observabilidad:

1. **Cabe en los tres nodos que ya hay o no cabe.** No se puede añadir un cuarto
   nodo sin pedir un aumento de cuota, así que el stack se dimensiona con
   requests explícitas y se verifica con `kubectl describe node`.
2. **No se expone por un `LoadBalancer` propio.** Grafana se alcanza por
   `kubectl port-forward`, no por una cuarta IP pública: queda una sola libre y
   es el margen de seguridad de la entrada del banco.

`E2_CPUS` aparece con límite 8 en la salida de `gcloud` y **no se aplica**: E2
comparte el pool `CPUS` con N1 y no tiene cuota propia
([Allocation quotas](https://docs.cloud.google.com/compute/resource-usage)). Se
anota aquí porque la métrica engaña al leerla.

---

## 2. La identidad con la que el pipeline despliega

GitHub Actions se autentica con **Workload Identity Federation**, no con una
llave descargada. En la organización de Google Workspace de la USAC no es una
preferencia: `constraints/iam.disableServiceAccountKeyCreation` hace que
`gcloud iam service-accounts keys create` falle.

Los comandos exactos —crear la cuenta de servicio, el pool, el proveedor OIDC
con su `attribute-condition` fijando el repositorio, y el binding— están en
[CI.md § Authentication](CI.md#authentication-workload-identity-federation-or-a-key)
y no se repiten aquí para que no puedan divergir. Imprimen los dos valores que
hacen falta en el paso 3.

---

## 3. Las variables y los secretos del repositorio

En *Settings → Secrets and variables → Actions*. `cd.yml` empieza con un job
`preflight` que **falla nombrando lo que falte**, así que si te saltas alguno lo
sabrás en el primer intento y no a mitad de un despliegue.

Las siete primeras las imprime `terraform output github_repository_variables`
con sus valores reales; la tabla es para saber qué significa cada una.

| Tipo | Nombre | Valor |
| --- | --- | --- |
| Variable | `GCP_PROJECT_ID` | el id del proyecto |
| Variable | `GKE_CLUSTER` | `bank-usac-vpc-gke` |
| Variable | `GKE_ZONE` | `us-central1-a` |
| Variable | `ARTIFACT_REPO` | `bank-images` |
| Variable | `GATEWAY_PUBLIC_URL` | `http://<gateway_public_ip>:3000` |
| Variable | `GATEWAY_STATIC_IP` | `terraform output -raw gateway_public_ip`. **Sólo producción**: fija la dirección del `Service` para que sobreviva a un reinstalado (TD-080). Sin ella el balanceador toma una efímera y el acuerdo con el banco pareja se queda apuntando a una IP que ya no es |
| Variable | `CLOUD_RUN_SERVICE` | `bank-usac-web`. Sin ella, `cd.yml` despliega el backend y **deja el portal público en la versión anterior** sin decirlo (TD-081) |
| Variable | `WEB_PUBLIC_URL` | la URL de Cloud Run, para el CORS del Gateway |
| Variable | `OTEL_EXPORTER_OTLP_ENDPOINT` | opcional — el Collector de T-49. Sin ella los pods instrumentan y no exportan |
| Variable | `WIF_PROVIDER` | del paso 2 |
| Variable | `WIF_SERVICE_ACCOUNT` | del paso 2 |
| Variable | `DEV_DATABASE_SUFFIX` | vacío hoy; ver TD-070 |
| Secret | `HELM_SECRETS` | los nueve valores que el chart marca `required`, **más las dos banderas `inCluster`**, uno por línea |
| Secret | `INFRA_ADDRESSES` | las cinco IP privadas de las bases de datos, una por línea |

Los dos son multilínea a propósito: catorce secretos de GitHub para un solo
consumidor es el mismo problema repartido en catorce sitios. `helm-deploy.sh`
convierte cada línea en un `--set-string`, y **falla si cualquiera de los dos
llega vacío** — el chart marca esos valores como `required` y el error de Helm
sería mucho menos claro.

```
secrets.jwtSecret=<una cadena larga y aleatoria>
secrets.rabbitmq.password=<...>
secrets.objectStorage.accessKey=<...>
secrets.objectStorage.secretKey=<...>
secrets.databases.customer.password=<...>
secrets.databases.account.password=<...>
secrets.databases.transaction.password=<...>
secrets.databases.payment.password=<...>
secrets.databases.notificationAudit.password=<...>
rabbitmq.inCluster=true
minio.inCluster=true
```

Las cinco contraseñas de base de datos son **las mismas** que pusiste en
`terraform.tfvars`: son las que el `startup-script` le dio a cada rol.

Las dos últimas líneas no son secretos y están ahí por comodidad, no por
diseño: son las que hacen que cada namespace levante su propio RabbitMQ y su
propio MinIO en vez de esperar a uno externo. `cd.yml` repite
`IN_CLUSTER_BROKER: 'true'` en el job de `dev` para dejarlo escrito en el
workflow, porque de otro modo el hecho sólo se conoce leyendo un secreto.
**Si las quitas de `HELM_SECRETS`, producción se queda sin broker.**

`INFRA_ADDRESSES` lleva las cinco IP privadas de
`terraform output database_private_ips`:

```
external.postgresCustomer.dockerNetwork.host=10.40.0.x
external.postgresAccount.dockerNetwork.host=10.40.0.x
external.postgresTransaction.dockerNetwork.host=10.40.0.x
external.postgresPayment.dockerNetwork.host=10.40.0.x
external.postgresNotificationAudit.dockerNetwork.host=10.40.0.x
```

No lleva RabbitMQ ni MinIO: al correr dentro del namespace, sus `Service` reales
dan el nombre DNS y el chart no renderiza los `Endpoints` externos para ellos.

> El modo se sigue llamando `dockerNetwork` porque es el nombre que le puso la
> Fase 1, y siempre significó lo mismo: *un `Service` sin selector respaldado por
> un `Endpoints` explícito*. La IP privada de una VM es exactamente eso. Las
> cadenas de conexión nunca llevan una IP: los pods hablan con
> `postgres-customer`, `rabbitmq` y `minio` por DNS interno, y lo que cambia
> entre kind y GKE es a qué apunta ese nombre.

---

## 4. La primera versión publicada

Producción **no construye imágenes**: despliega las que publicó la fase de
entrega. Así que antes del primer despliegue a producción tiene que existir un
tag.

```bash
git tag v1.0.0
git push origin v1.0.0
```

`release.yml` genera la versión formal, construye las siete imágenes en paralelo
y las publica en `us-central1-docker.pkg.dev/$GCP_PROJECT_ID/bank-images/<componente>:v1.0.0`.
Ninguna se etiqueta `latest`: `helm-deploy.sh` lo rechaza explícitamente.

---

## 5. El despliegue

A partir de aquí no hay comandos. El pipeline despliega:

| Acción | Qué ocurre |
| --- | --- |
| merge a `develop` | `changes.yml` decide qué cambió, se construyen **sólo esos** componentes con etiqueta `dev-<sha>` y se despliegan en el namespace `dev` |
| merge a `main` | se resuelve el tag `v*` más reciente y se hace `helm upgrade` en `prod` con esas imágenes, con rolling update y sonda de disponibilidad |

Si el `helm upgrade` no alcanza `Ready`, `helm-deploy.sh` vuelca el diagnóstico
—pods, eventos, logs, CPU del nodo— y ejecuta `helm rollback`. Si era la primera
instalación, no hay revisión anterior a la que volver y retira el release a
medias en lugar de dejar restos.

Para desplegar a mano desde tu máquina en una emergencia, el script es el mismo
que usa el pipeline:

```bash
NAMESPACE=prod RELEASE_NAME=bank-usac IMAGE_TAG=v1.0.0 \
IMAGE_REGISTRY=us-central1-docker.pkg.dev/$GCP_PROJECT_ID/bank-images \
GATEWAY_PUBLIC_URL=http://<ip>:3000 \
HELM_SECRETS="$(cat /ruta/segura/helm-secrets.txt)" \
INFRA_ADDRESSES="$(cat /ruta/segura/infra-addresses.txt)" \
bash .github/scripts/helm-deploy.sh
```

---

## 5.1 Validar el stack sin gastar un centavo

Antes de encender la nube para depurar, hay un camino gratis que cubre casi
todo lo que puede romperse:

```bash
pnpm obs:kind          # crea un kind desechable, despliega el stack y lo verifica
pnpm obs:kind:down     # lo borra
```

`infra/scripts/cloud/obs-kind.sh` levanta un clúster kind propio
(`bank-obs-test`, separado del `bank-usac` del flujo local), despliega el chart,
y **no necesita el banco**: un pod de busybox que escribe el formato exacto de
`@bank/observability` en stdout y una traza OTLP enviada con `curl` bastan para
probar la correlación. Después comprueba nueve cosas y falla si alguna no se
cumple:

| # | Qué comprueba | Por qué importa |
| --- | --- | --- |
| 1 | Tempo tiene la traza | sin esto no hay trazas distribuidas (§8.3, 50 %) |
| 2 | Loki indexa **sólo** `k8s_namespace_name` y `service_name` | es la afirmación de cardinalidad de ADR-018, medida y no supuesta |
| 3 | Filtrar por `traceId` encuentra la línea | prueba que `transform/parse_bank_json` abrió el JSON |
| 4 | `correlationId` es consultable | el flujo de negocio de la Fase 1 |
| 5 | La línea que **no** es JSON se guardó igual | un log ilegible sigue siendo evidencia |
| 6 | Prometheus raspa al Collector | sin ese objetivo ninguna métrica llega a un panel |
| 7 | Grafana cargó los tres datasources y los `derivedFields` | el salto log → traza |
| 8 | Prometheus tiene `bank_transfer_finished_total` y `bank_transfer_duration_seconds_bucket` | que la serie **se llame** como la nombra cada consulta de [`telemetry-catalog.md`](../sre/telemetry-catalog.md); raspar al Collector no basta |
| 9 | Las etiquetas son `service_name` y `environment`, y `k8s_pod_name` **no** lo es | la cardinalidad de las métricas, medida en la serie y no supuesta en el YAML |

Corrido el 2026-10-14 sobre kind: **9 de 9**.

Las comprobaciones 8 y 9 son de T-58 y existen por un defecto real: el
exportador estaba con `add_metric_suffixes: false`, así que las series se
llamaban `bank_transfer_finished` y **ninguna** de las consultas escritas en
`docs/sre/` —todas con `_total` y `_seconds`— devolvía nada. Las siete
comprobaciones anteriores pasaban: ninguna preguntaba por el nombre de una
serie. La misma corrida encontró que las comprobaciones 3, 4 y 5 llevaban un día
rotas, desde que `service.name` pasó a salir del propio log (`57e99fc`) y
quedaron preguntando por el nombre del `Deployment`; el stream se llama
`transaction-service`, que es lo que la línea dice ser.

A la nube sólo hace falta subir lo que kind no puede mostrar: la IP estática con
el `LoadBalancer`, el HPA bajo carga real y las capturas de evidencia.

**Un detalle que cuesta media hora si no se sabe:** `kubectl port-forward` al
Collector **no funciona**. Sus receptores escuchan en la IP del pod, no en
`localhost`, y un port-forward entra por `localhost` — da `connection refused`.
Para enviarle algo a mano hay que hacerlo desde dentro del clúster, al nombre
del Service.

---

## 5.2 Encender y apagar la nube para una sesión corta

Tres scripts, y el que importa es el tercero:

```bash
pnpm cloud:up      # bootstrap + apply + variables + imágenes + despliegue
pnpm cloud:cost    # qué queda facturando, en cualquier momento
pnpm cloud:down -- --purge-state --purge-images    # apagar
```

Los tres aceptan `--dry-run` (`cloud:up` y `cloud:down`), que imprime el plan
sin tocar nada.

**Cuesta del orden de 0,50 USD/hora** mientras exista: tres nodos
`e2-standard-2`, cinco VMs `e2-medium`, Cloud NAT, dos reglas de reenvío y unos
200 GB de disco. Una sesión de una hora, ~0,60 USD.

**El orden del apagado es el script, no `terraform destroy`.** Tres clases de
recurso se quedan atrás aunque el destroy diga «Destroy complete», y ninguna
está en el estado de Terraform:

1. **Los discos de `loki` y `tempo`.** Son `volumeClaimTemplates` de un
   StatefulSet y **Helm no los borra nunca**, ni con `helm uninstall`. Si además
   se destruye el clúster antes de borrarlos, quedan huérfanos: 20 GiB
   facturando sin que nada en el proyecto los nombre.
2. **Las reglas de reenvío** de los `Service` de tipo `LoadBalancer`. Las crea
   GKE desde el Service, no Terraform, así que destruir el clúster sin
   desinstalar el release antes las deja vivas.
3. **Una IP estática reservada sin usar cuesta más que en uso.**

Por eso `cloud-down.sh` desinstala los releases con el clúster vivo, borra esos
PVC a mano, espera a que las reglas de reenvío desaparezcan de verdad, y sólo
entonces destruye. El estado se borra **al final**: mientras exista
infraestructura existe el estado que sabe destruirla, así que si el script falla
a mitad se puede reintentar.

`cost-check.sh` es el que convierte «creo que lo apagué» en un hecho: enumera
por API —no por el estado de Terraform— todo lo facturable y sale con error si
queda algo. **Y distingue dueño:** este proyecto de GCP está compartido con
otros cursos (la primera corrida encontró un repositorio `p5-images` que no es
de aquí), así que todo lo de Bank USAC se reconoce por nombre y lo demás se
lista aparte y nunca se toca.

Con `--purge-state --purge-images` el residual es **cero absoluto**, a cambio de
que el siguiente encendido rehaga el bucket de estado y republique las siete
imágenes. Sin esas banderas quedan centavos al mes y el arranque es más rápido.

---

## 5.3 El stack de observabilidad, desde el pipeline

Lo despliega el mismo pipeline, en un release y un namespace propios
(`bank-observability` en `observability`). No hay comandos: un merge a `main`
ejecuta el job **«Stack de observabilidad»** de `cd.yml`. Para iterar sin merge,
*Actions → CD → Run workflow → `deploy_observability`*.

Hace falta **un secreto más** que los del paso 3, y dos opcionales de T-50:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| Secret | `GRAFANA_ADMIN_PASSWORD` | la contraseña de `admin`. Mínimo 16 caracteres; el job falla diciéndolo si falta o es más corta, en vez de instalar un Grafana con la contraseña pública que trae el chart |
| Secret de K8s | `grafana-alert-webhook` (clave `token`) | el `ALERT_WEBHOOK_TOKEN` del Gateway, para que las alertas lleguen a la bitácora de auditoría (T-45). **Opcional**: sin él Grafana arranca igual y la alerta se ve en su consola, pero el Gateway la rechaza con `401`. Debe ser el **mismo valor** que `ALERT_WEBHOOK_TOKEN` en `HELM_SECRETS` |
| Variable + Secret | `GRAFANA_URL` y `GRAFANA_TOKEN` | para que `cd.yml` anote la *release* en Grafana. **Opcionales**: sin ellos el paso se omite con su motivo en el resumen, y los dashboards siguen marcando los despliegues por consulta |

**No se despliega desde `develop` a propósito.** El stack es uno para los dos
entornos —`dev` y `prod` mandan su telemetría al mismo Collector y se miran en el
mismo Grafana, separados por `deployment.environment`— así que un push a
`develop` cambiaría el monitoreo de producción. Es la misma clase de problema que
TD-070, pero ésta se evita sin coste. El por qué de cada pieza está en
[ADR-018](../architecture/adr/ADR-018-observability-stack.md).

Las aplicaciones no necesitan ninguna variable nueva: `cd.yml` pone
`OTEL_EXPORTER_OTLP_ENDPOINT` por defecto en
`http://otel-gateway.observability.svc.cluster.local:4318`. La variable de
repositorio del mismo nombre sigue existiendo y sólo hace falta para apuntar a
otro Collector.

**Y con el stack viajan las reglas, las alertas y los dashboards (T-50)**, en el
mismo release y sin un paso aparte:

| Qué | Dónde vive | Cuántos |
| --- | --- | --- |
| Reglas de grabación de los SLI | `values.yaml` → `prometheus.serverFiles.recording_rules.yml` | 30 |
| Alertas, contact points y política | `values.yaml` → `grafana.alerting` | 7 alertas, 2 contact points |
| Dashboards | `dashboards/*.json` → ConfigMaps con `grafana_dashboard: "1"` | 9 |
| Runbooks | [`runbooks/`](runbooks/README.md), enlazados desde cada alerta | 5 |

Nada de eso se crea a mano en la interfaz, y lo que se cree a mano se pierde en
el siguiente `helm upgrade` — que es la mitad del criterio 2.6 de la rúbrica.
Antes de subir un cambio: `pnpm obs:check:dashboards` (falla si un panel cita un
SLI que nadie graba) y `pnpm obs:kind` (la única forma de ver que una consulta
devuelve algo).

**Grafana no tiene IP pública.** Queda una sola libre en la cuota y es el margen
de la entrada del banco (ver la tabla de cuotas del paso 1):

```bash
pnpm obs:forward      # kubectl port-forward -n observability svc/grafana 3002:80
# http://localhost:3002 — usuario `admin`
```

Y las dos comprobaciones que distinguen un stack que mide de uno que sólo está
verde:

```bash
# 1. Prometheus raspa al Collector. Sin este objetivo, ninguna métrica de las
#    aplicaciones llega a ningún panel.
kubectl port-forward -n observability svc/prometheus-server 9090:80 &
curl -s 'http://localhost:9090/api/v1/targets?state=active' | grep -o '"job":"otel-gateway"'

# 2. Llegan logs del banco ya parseados: `service_name` sólo existe como
#    etiqueta si el procesador `transform/parse_bank_json` abrió el JSON.
kubectl port-forward -n observability svc/loki 3100:3100 &
curl -s 'http://localhost:3100/loki/api/v1/labels'
```

Antes de tocar el chart, `pnpm obs:check` comprueba que los subcharts
versionados en `charts/` concuerden con `Chart.yaml` y `Chart.lock`. Van
commiteados (372 KB) para que el despliegue no dependa de que los repositorios
de Grafana, Prometheus y OpenTelemetry respondan, así que **no** se ejecuta
`helm dependency build` en ningún workflow: ese comando refresca el índice por
red y devolvería la dependencia que se quiso quitar. Si cambias una versión en
`Chart.yaml`, corre `helm dependency update` y commitea `charts/` y `Chart.lock`
juntos — `pnpm obs:check` y CI fallan si se separan.

---

## 6. El frontend en Cloud Run

Ya no es un paso: lo hace el pipeline. `terraform apply` crea el servicio
sirviendo el contenedor `hello` de Google, y el paso *«Actualizar el frontend
publico (Cloud Run)»* de `cd.yml` lo apunta a la versión publicada en cada merge
a `main`, comprobando después que la revisión servida sea esa. La imagen ya
existe: `release.yml` publica `web` junto a las otras seis.

Dos condiciones, y las dos fallan en silencio si faltan:

- La variable `CLOUD_RUN_SERVICE` tiene que existir. Sin ella el paso no corre y
  el portal se queda en la revisión anterior con el despliegue en verde.
- La cuenta de servicio del pipeline necesita `roles/run.developer`. Si le
  falta, el job **falla** diciéndolo —no lo esconde— y Kubernetes sí queda en la
  versión nueva.

`cloud_run.tf` lleva `ignore_changes` sobre la imagen del contenedor por esto
mismo: Terraform crea el servicio, el pipeline decide qué versión sirve, y un
`terraform apply` posterior no puede devolver el portal al contenedor `hello`.

**Por qué una variable `http://` no rompe el navegador.** La página se sirve por
HTTPS y el Gateway responde por HTTP, así que una llamada directa desde el
cliente sería *mixed content* y el navegador la bloquearía. No ocurre porque
`useGatewayApi` detecta ese caso y usa una ruta relativa, y
`server/routes/api/[...slug].ts` —un proxy de mismo origen en Nitro— reenvía la
petición desde el servidor, donde HTTP es legítimo. Es la razón por la que el
frontend funciona sin certificado en el Gateway.

---

## 7. Comprobar que quedó bien

```bash
$(cd infra/terraform/gcp && terraform output -raw gke_get_credentials_command)

kubectl get pods,hpa -n prod
kubectl get pods,hpa -n dev
```

Nueve Deployments a `1/1` por namespace y siete HPA con objetivo `80%`. Un HPA
recién creado muestra `cpu: <unknown>/80%` durante el primer minuto, mientras se
recolecta la primera métrica; si sigue en `<unknown>` pasados unos minutos, eso
sí es un problema y el autoescalado no va a ocurrir.

Desde fuera. La dirección no se busca: es la que reservó Terraform, y el
`EXTERNAL-IP` del Service tiene que ser exactamente ésa —si no lo es, el
despliegue tomó una efímera y falta `GATEWAY_STATIC_IP`:

```bash
IP="$(cd infra/terraform/gcp && terraform output -raw gateway_public_ip)"
kubectl get svc bank-usac-gateway -n prod -o jsonpath='{.status.loadBalancer.ingress[0].ip}'

curl -s "http://$IP:3000/health"   # {"status":"ok","application":"gateway"}
curl -s "http://$IP:3000/ready"    # {"status":"ready",...,"broker":"connected"}
curl -s -o /dev/null -w '%{http_code}\n' "$(cd infra/terraform/gcp && terraform output -raw cloud_run_web_url)"
```

Y que la IP sobrevive, que es lo que TD-080 cerró y lo que el acuerdo con el
banco pareja da por supuesto:

```bash
kubectl delete svc bank-usac-gateway -n prod
# el siguiente despliegue —o un `helm upgrade`— lo recrea sobre la MISMA IP
```

Y la comprobación que realmente importa, porque atraviesa el proxy, el Gateway y
el broker de una vez:

```bash
curl -s -X POST "<URL de Cloud Run>/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"noexiste@example.com","password":"contrasena-larga"}'
```

Una respuesta con `correlationId` significa que la petición llegó hasta el
Gateway y volvió. Un error de red significa que el proxy no encuentra su
destino: revisa `NUXT_PUBLIC_API_BASE_URL` en Cloud Run.

`kubectl rollout status deployment -n prod` y `helm history bank-usac -n prod`
son las dos órdenes que valen para cualquier duda posterior sobre qué está
desplegado.

---

## 8. Apagarlo

El clúster y las cinco VMs cuestan crédito mientras existan.

```bash
# Liberar sólo el entorno de desarrollo (idempotente, no necesita gcloud):
#   Actions → CD → Run workflow → retire_dev, desde una rama que no sea develop ni main.

# Todo:
helm uninstall bank-usac --namespace prod
helm uninstall bank-usac --namespace dev
cd infra/terraform/gcp && terraform destroy
```

`terraform destroy` ya sí retira todo lo que el sistema necesita, incluidos el
repositorio de Artifact Registry y la IP reservada del Gateway: ésa es la mitad
práctica de haber cerrado TD-079 y TD-080. Dos cosas sobreviven a propósito:

- **El bucket de estado** (`bootstrap/`). Tiene `force_destroy = false`, así que
  Terraform se niega a borrarlo mientras guarde objetos. Es lo correcto: es el
  registro de lo que existió.
- **Los `Service` de tipo `LoadBalancer`** que Helm creó. Borra el release
  *antes* del `destroy` —las dos primeras líneas— o GKE deja balanceadores
  huérfanos que siguen costando y que Terraform no conoce.
