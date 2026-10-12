{{/*
Chart name, truncated and trimmed the way `helm create` scaffolds it, so a
long release name never produces an invalid (>63 char) Kubernetes object
name once a component suffix is appended.
*/}}
{{- define "bank-usac.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified release name, e.g. "bank-usac".
*/}}
{{- define "bank-usac.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "bank-usac.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Chart-wide labels, applied to every object this chart owns.
*/}}
{{- define "bank-usac.labels" -}}
helm.sh/chart: {{ include "bank-usac.chart" . }}
{{ include "bank-usac.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "bank-usac.selectorLabels" -}}
app.kubernetes.io/name: {{ include "bank-usac.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Per-component name/labels. Every internal-service and workload template
calls these with (dict "root" $ "component" "<name>") because a named
template only sees the single value it is handed — there is no way to add
a field to the ambient `.` context, so the component name has to travel
alongside the root context explicitly.
*/}}
{{- define "bank-usac.componentFullname" -}}
{{- printf "%s-%s" (include "bank-usac.fullname" .root) .component -}}
{{- end -}}

{{- define "bank-usac.componentLabels" -}}
{{ include "bank-usac.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "bank-usac.componentSelectorLabels" -}}
{{ include "bank-usac.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
The port an external dependency answers on, given the current
`external.mode`. Same in-cluster Service name either way — only the port
changes, because ExternalName (hostFallback) cannot remap one. See the long
comment on `external:` in values.yaml for why this seam exists.
Usage: include "bank-usac.externalPort" (dict "root" $ "key" "rabbitmq")
*/}}
{{- define "bank-usac.externalPort" -}}
{{- $dep := index .root.Values.external .key -}}
{{- if eq .root.Values.external.mode "hostFallback" -}}
{{- $dep.hostFallback.port -}}
{{- else -}}
{{- $dep.dockerNetwork.port -}}
{{- end -}}
{{- end -}}

{{/*
Renders the Service (and, in dockerNetwork mode, the Endpoints) for one
external dependency. Called once per file under templates/external/ with:
  (dict "root" $ "key" "<values.external key>" "dnsName" "<in-cluster name>"
        "portName" "<Service port name>")
dnsName is also what applications put in their connection strings
(templates/secret.yaml) — it must match between the two.
*/}}
{{- define "bank-usac.externalDependency" -}}
{{- $root := .root -}}
{{- $key := .key -}}
{{- $dnsName := .dnsName -}}
{{- $portName := .portName -}}
{{- $dep := index $root.Values.external $key -}}
{{- $port := include "bank-usac.externalPort" (dict "root" $root "key" $key) -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ $dnsName }}
  namespace: {{ $root.Release.Namespace }}
  labels:
    {{- include "bank-usac.componentLabels" (dict "root" $root "component" $key) | nindent 4 }}
  annotations:
    bank-usac.io/external-mode: {{ $root.Values.external.mode }}
spec:
{{- if eq $root.Values.external.mode "hostFallback" }}
  type: ExternalName
  # ExternalName is DNS-only: Kubernetes returns a CNAME for this name and
  # takes no further part in the connection, so `ports` below documents the
  # contract rather than enforcing it — the client must still dial this
  # exact port.
  externalName: host.docker.internal
  ports:
    - name: {{ $portName }}
      port: {{ $port }}
      targetPort: {{ $port }}
{{- else }}
  type: ClusterIP
  ports:
    - name: {{ $portName }}
      port: {{ $port }}
      targetPort: {{ $port }}
{{- end }}
{{- if ne $root.Values.external.mode "hostFallback" }}
---
apiVersion: v1
kind: Endpoints
metadata:
  name: {{ $dnsName }}
  namespace: {{ $root.Release.Namespace }}
  labels:
    {{- include "bank-usac.componentLabels" (dict "root" $root "component" $key) | nindent 4 }}
subsets:
  - addresses:
      - ip: {{ required (printf "external.%s.dockerNetwork.host is required in external.mode=dockerNetwork — run infra/k8s/kind/scripts/discover-external-ips.sh and pass its output with -f" $key) $dep.dockerNetwork.host }}
    ports:
      - name: {{ $portName }}
        port: {{ $port }}
{{- end }}
{{- end -}}

{{/*
La estrategia de actualizacion, compartida por los siete Deployments.

`maxUnavailable: 0` es lo que hace que un rolling update no tenga caida con una
sola replica. La estrategia por defecto de Kubernetes permite retirar el 25% de
los pods antes de tener reemplazo; con `replicas: 1` ese 25% redondea a uno, o
sea el unico que hay: el Service se queda sin endpoints hasta que el nuevo pasa
su readiness. Con `maxUnavailable: 0` y `maxSurge: 1` el orden se invierte —
primero arranca el nuevo, pasa su readiness, y solo entonces muere el viejo.

Cuesta un pod de mas durante la actualizacion, no de forma permanente.
*/}}
{{- define "bank-usac.updateStrategy" -}}
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
{{- end }}

{{/*
El apagado ordenado, que es la otra mitad de "sin caida".

Que el pod nuevo este listo no basta: al viejo le llega SIGTERM en el mismo
instante en que se le quita de los Endpoints, y esas dos cosas ocurren en
paralelo — kube-proxy puede tardar en enterarse. Sin el `preStop`, las
peticiones que ya iban en camino llegan a un proceso que se esta cerrando.

Los cinco segundos no esperan a nada concreto: le dan al plano de datos tiempo
de sobra para dejar de enrutar hacia este pod antes de que el proceso empiece a
cerrarse. El `terminationGracePeriodSeconds` los cubre y deja margen para que
las peticiones en vuelo terminen.
*/}}
{{- define "bank-usac.gracefulShutdown" -}}
terminationGracePeriodSeconds: 30
{{- end }}

{{/*
Telemetry (T-48): the variables `@bank/observability` reads, identical in the
five services and the Gateway.

- `DEPLOYMENT_ENVIRONMENT` and `OTEL_*` come from the ConfigMap, so `dev` and
  `prod` differ by the values of the release, never by a template.
- `SERVICE_VERSION` is the tag of the image this very Deployment runs — taken
  from the same value as `image:` two lines above it, so the version a span or a
  log line reports cannot drift from the code that wrote it.
- `HOSTNAME` is not set: Kubernetes already sets it to the pod name, which is
  what `service.instance.id` needs.

Usage: {{ include "bank-usac.telemetryEnv" (dict "root" $ "tag" .Values.services.payment.image.tag) }}
*/}}
{{- define "bank-usac.telemetryEnv" -}}
{{- $config := printf "%s-config" (include "bank-usac.fullname" .root) -}}
- name: DEPLOYMENT_ENVIRONMENT
  valueFrom:
    configMapKeyRef:
      name: {{ $config }}
      key: DEPLOYMENT_ENVIRONMENT
- name: SERVICE_VERSION
  value: {{ .tag | quote }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  valueFrom:
    configMapKeyRef:
      name: {{ $config }}
      key: OTEL_EXPORTER_OTLP_ENDPOINT
- name: OTEL_SDK_DISABLED
  valueFrom:
    configMapKeyRef:
      name: {{ $config }}
      key: OTEL_SDK_DISABLED
- name: OTEL_METRIC_EXPORT_INTERVAL
  valueFrom:
    configMapKeyRef:
      name: {{ $config }}
      key: OTEL_METRIC_EXPORT_INTERVAL
- name: LOG_LEVEL
  valueFrom:
    configMapKeyRef:
      name: {{ $config }}
      key: LOG_LEVEL
{{- end }}
