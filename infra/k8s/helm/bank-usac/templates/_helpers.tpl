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
