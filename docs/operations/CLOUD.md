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
| Frontend Nuxt | Cloud Run, `bank-usac-web`, público por HTTPS | **A mano hoy** — TD-081 |
| API Gateway | GKE, namespace `prod`, `Service` de tipo `LoadBalancer` en el puerto 3000 | `cd.yml` al mergear a `main` |
| Cinco servicios de dominio | GKE, namespace `prod` | `cd.yml` al mergear a `main` |
| RabbitMQ y MinIO | GKE, uno por namespace, sin volumen (TD-082) | con el resto del release |
| Cinco bases PostgreSQL | Cinco VMs de Compute Engine, subred privada, sin IP pública | `terraform apply` las aprovisiona; después, nada las toca |
| Entorno `dev` | GKE, namespace `dev`, con broker y MinIO propios | `cd.yml` al mergear a `develop`, sólo los componentes que cambiaron |

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
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
```

---

## 1. La infraestructura, con Terraform

```bash
cd infra/terraform/gcp
cp terraform.tfvars.example terraform.tfvars   # y edítalo: project_id y contraseñas
terraform init
terraform validate
terraform plan
terraform apply
```

Entre seis y diez minutos. Al terminar existen la VPC con sus dos subredes, el
Cloud NAT, las tres reglas de firewall, **las cinco VMs con PostgreSQL ya
instalado y su base creada**, el clúster de GKE con tres nodos y el servicio de
Cloud Run (todavía sirviendo el contenedor `hello` de Google; el frontend real
llega en el paso 6).

Guarda las salidas: son la entrada de los pasos siguientes.

```bash
terraform output database_private_ips        # las cinco IP privadas
terraform output -raw gke_get_credentials_command
terraform output -raw cloud_run_web_url
```

> **Si `terraform init` falla en Linux con un error de checksum**, es que
> `.terraform.lock.hcl` sólo tiene los hashes de la plataforma en la que se
> generó. Se arregla una vez y se commitea:
> `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`.

### Lo que Terraform todavía **no** crea

Tres recursos del sistema en producción se crean fuera del módulo. Están
registrados como deuda porque el enunciado penaliza la infraestructura hecha a
mano (§8.3, p. 13), y hasta que se cierren hay que hacerlos aquí:

**a) El repositorio de imágenes** (TD-079):

```bash
gcloud artifacts repositories create bank-images \
  --repository-format=docker --location=us-central1 \
  --description="Imagenes de Bank USAC"
```

**b) La IP pública del Gateway** (TD-080). El chart renderiza `ClusterIP`, así
que después del primer despliegue hay que exponerlo una vez:

```bash
kubectl patch svc bank-usac-gateway -n prod \
  -p '{"spec":{"type":"LoadBalancer"}}'
kubectl get svc bank-usac-gateway -n prod -w   # espera EXTERNAL-IP
```

Helm no revierte ese cambio en los despliegues siguientes —el campo no cambia
entre la revisión anterior y la nueva, así que su *three-way merge* lo deja
estar— pero **no borres ese Service ni instales el release en un namespace
nuevo sin volver a aplicar el patch**: no hay nada en el repositorio que lo
reconstruya.

**c) La revisión de Cloud Run con el frontend real** (TD-081): paso 6.

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

| Tipo | Nombre | Valor |
| --- | --- | --- |
| Variable | `GCP_PROJECT_ID` | el id del proyecto |
| Variable | `GKE_CLUSTER` | `bank-usac-vpc-gke` |
| Variable | `GKE_ZONE` | `us-central1-a` |
| Variable | `ARTIFACT_REPO` | `bank-images` |
| Variable | `GATEWAY_PUBLIC_URL` | `http://<EXTERNAL-IP del paso 1b>:3000` |
| Variable | `WEB_PUBLIC_URL` | la URL de Cloud Run, para el CORS del Gateway |
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

## 6. El frontend en Cloud Run

Hoy es el paso manual del procedimiento (**TD-081**). La imagen ya existe:
`release.yml` publica `web` junto a las otras seis.

```bash
gcloud run deploy bank-usac-web \
  --region us-central1 \
  --image "us-central1-docker.pkg.dev/$GCP_PROJECT_ID/bank-images/web:v1.0.0" \
  --port 8080 --allow-unauthenticated \
  --set-env-vars "NUXT_PUBLIC_API_BASE_URL=http://<EXTERNAL-IP del Gateway>:3000"
```

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

Desde fuera:

```bash
curl -s http://<EXTERNAL-IP>:3000/health   # {"status":"ok","application":"gateway"}
curl -s http://<EXTERNAL-IP>:3000/ready    # {"status":"ready",...,"broker":"connected"}
curl -s -o /dev/null -w '%{http_code}\n' "$(cd infra/terraform/gcp && terraform output -raw cloud_run_web_url)"
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
cd infra/terraform/gcp && terraform destroy
```

`terraform destroy` no borra lo que no creó: el repositorio de Artifact Registry
del paso 1a y el `LoadBalancer` del paso 1b hay que retirarlos aparte, que es
otra forma de ver por qué TD-079 y TD-080 importan.
