# T-57 — El banco pareja simulado y el sistema completo en local: evidencia

Fecha: **2026-10-14**. Rama `feature/T-50`.

Sin nube y sin banco pareja asignado, esto es lo que permite seguir avanzando:
el sistema entero —los siete componentes, el stack de observabilidad y la
contraparte falsa— en un solo clúster kind, con telemetría real atravesándolo.

## 1. Un comando

```
$ pnpm local:up
```

Levanta la infraestructura en Docker (cinco PostgreSQL, RabbitMQ y MinIO, fuera
del clúster, que es la forma del despliegue real), el clúster kind, las ocho
imágenes, el stack de observabilidad en el namespace `observability` y el banco
en `bank-usac` con la telemetría apuntando al Collector interno.

```
$ kubectl get pods -n bank-usac
bank-usac-account-service-759d69fb7c-p4bxj              1/1  Running
bank-usac-customer-service-77c9b7796b-vmtbq             1/1  Running
bank-usac-gateway-785c7b88bb-nbpm6                      1/1  Running
bank-usac-notification-audit-service-649c9467c8-rwjrq   1/1  Running
bank-usac-partner-bank-mock-76c85987cf-w8kdm            1/1  Running
bank-usac-payment-service-54cbfdf958-sxp4f              1/1  Running
bank-usac-transaction-service-846bd4cb6-lh7n4           1/1  Running
bank-usac-web-7ff694ccf9-4zznp                          1/1  Running

$ kubectl get pods -n observability
bank-observability-kube-state-metrics-…   1/1  Running
grafana-…                                 2/2  Running
loki-0                                    2/2  Running
otel-gateway-…                            1/1  Running
otel-log-agent-…                          1/1  Running
prometheus-server-…                       2/2  Running
tempo-0                                   1/1  Running
```

## 2. El depósito interbancario, de punta a punta

El mock envía, el Gateway acepta, Payment decide y el callback vuelve:

```
$ curl -X POST http://bank-usac-partner-bank-mock:3021/transfers \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"accountId":"7f2b1c42-…-000000000001","amount":{"amountMinor":12500,"currency":"GTQ"},
         "interbankTransferId":"local-demo-4"}'

{"interbankTransferId":"local-demo-4","depositId":"e624f523-…","correlationId":"1f754ae3-…"}
HTTP 202

$ curl http://bank-usac-partner-bank-mock:3021/transfers/local-demo-4
{"depositId":"e624f523-…","interbankTransferId":"local-demo-4",
 "originBankCode":"PARTNER_MOCK","destinationBankCode":"BANK_USAC",
 "status":"REJECTED","reason":"ACCOUNT_NOT_FOUND"}
```

`REJECTED / ACCOUNT_NOT_FOUND` es el resultado **correcto**: esa cuenta no
existe en una base recién creada. Lo que la corrida demuestra es el camino: la
entrada autenticada del Gateway, Payment preguntando la elegibilidad a Account
**por el broker**, la decisión persistida y el callback al emisor con un motivo
del conjunto cerrado.

## 3. La telemetría del banco real, en los tres almacenes

```
1. METRICAS en Prometheus
   sum(http_server_request_duration_seconds_count{service_name="gateway"}) -> 37
   count(bank_interbank_deposits_total)                                    -> 1
   sum(messaging_client_consumed_messages_total)                           -> 5

2. SERVICIOS que exportan metricas
   account-service · customer-service · gateway ·
   notification-audit-service · payment-service · transaction-service

3. LOGS en Loki
   service_name: account-service, gateway, notification-audit-service, payment-service, …
   {service_name="gateway"} -> totalEntriesReturned: 1

4. TRAZAS en Tempo
   rootServiceName: account-service · customer-service ·
                    notification-audit-service · payment-service · transaction-service
```

Los **seis** componentes instrumentados exportan métricas con los nombres del
catálogo, los logs son consultables por servicio y las trazas existen con su
servicio raíz. Es la primera vez que las tres señales del banco de verdad
—no sintéticas— se ven juntas en este repositorio.

## 4. Cinco defectos que sólo aparecieron al levantarlo

Ninguno se ve leyendo el código; los cinco salieron de correrlo.

### 4.1 Un `grep` sin coincidencia abortaba el instalador en silencio

`install-observability.sh` leía el token del webhook con
`token="$(grep … | tail -1 | cut …)"`. Sin coincidencia, `grep` devuelve 1,
`pipefail` lo propaga y `set -e` **aborta el script** — justo después de haber
creado el namespace, con código de salida aparentemente normal. La primera
corrida no instaló nada y no dijo por qué.

### 4.2 `cmd | kubectl apply` es una carrera, no una tubería

`k create … --dry-run -o yaml | k apply -f -`: si `apply` termina antes de que
el primer `kubectl` acabe de escribir, el primero muere con **SIGPIPE** y
`pipefail` convierte eso en un fallo. Ahora se genera primero y se aplica
después.

### 4.3 Lo mismo en la comprobación de contexto, y ahí era intermitente

`kubectl config get-contexts -o name | grep -qx "$CONTEXT"`: `grep -q` termina
al encontrar la línea y cierra el pipe → SIGPIPE en `kubectl` → fallo. El
síntoma era **«el contexto no existe» seguido de una lista en la que sí
aparece**, y empeoraba a medida que se acumulaban contextos en el kubeconfig.
Estaba en `install.sh` desde T-22; se arregló en los dos scripts.

### 4.4 `install.sh` comprobaba el nodo contra una foto vieja

Tras `kind load`, volvía a preguntar `node_has_tag` usando la variable
capturada **antes** de cargar, concluía que no había imágenes utilizables y
fallaba. El síntoma era que la **primera** instalación tras una construcción
siempre fallaba y la segunda funcionaba sin explicación.

### 4.5 Un pod no vuelve a leer un Secret — y el chart no lo hashea (TD-089)

Con el token interbancario recién añadido, el mock reenviaba el depósito y el
**Gateway** respondía `401 UNAUTHENTICATED` con un `correlationId` y ninguna
pista: seguía corriendo con el token vacío que leyó al arrancar. Los siete
Deployments anotan `checksum/config` (el ConfigMap) y **ninguno** el del
Secret.

Se arregló para el mock (`checksum/secret` en su Deployment, con el comentario
que explica por qué) y se registró **TD-089** para los siete, porque hacerlo
allí cambia el comportamiento de rollout en producción —un cambio de contraseña
rodaría el banco entero— y eso es una decisión, no un parche. Afecta igual a la
rotación de credenciales en la nube: el despliegue sale verde y el servicio
sigue usando la anterior.

## 5. Y una sorpresa del chart de Loki

Con `persistence.enabled: false` —lo razonable en un clúster desechable— Loki
no arranca: su chart no cae a un `emptyDir` como hacen Tempo y Prometheus, no
monta nada, y la raíz del contenedor es de sólo lectura:
`mkdir /var/loki: read-only file system`, en bucle. Las sobrescrituras locales
le dan 2 GiB y `--down` borra el PVC, que es lo que `helm uninstall` no hace
nunca.

Añadir ese volumen a un StatefulSet ya creado **no se puede**:
`spec.volumeClaimTemplates: field is immutable`. Hay que borrar el StatefulSet
y dejar que el chart lo recree.

## 6. Por qué esto no romperá el despliegue en la nube

Tres barreras, no una promesa:

1. **Los valores por defecto del chart no cambian**: `partnerMock.enabled=false`,
   `observability.otlpEndpoint` vacío, y `interbank.callbackUrl` **no** se
   deriva de ninguna bandera — un URL que cambia de significado según otro flag
   es como un release acaba llamando al banco equivocado.
2. **Las sobrescrituras locales viven en archivos aparte**
   (`infra/k8s/kind/local.values.yaml` y `observability.values.yaml`), que la
   nube no lee: `cd.yml` despliega el mismo chart con los valores del chart.
3. **Los dos instaladores se niegan** a trabajar contra un contexto que no sea
   `kind-*`. El del stack lo dice con todas las letras: instalaría producción
   con dos horas de retención, sin volúmenes y con una contraseña de juguete.

## 7. Lo que el camino local no prueba

- **El HPA**: kind no trae `metrics-server`, así que las series de
  `kube_horizontalpodautoscaler_*` existen y no se mueven.
- **El error budget de siete días**: la retención local es de dos horas. Fingir
  lo contrario sería peor que decirlo.
- **La IP pública y el certificado** del Gateway.

Eso es T-54, y sigue siendo el camino crítico.
