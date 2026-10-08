{{/* Chart name, truncated to the 63-char DNS label limit. */}}
{{- define "llmhub.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "llmhub.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "llmhub.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "llmhub.labels" -}}
helm.sh/chart: {{ include "llmhub.chart" . }}
{{ include "llmhub.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "llmhub.selectorLabels" -}}
app.kubernetes.io/name: {{ include "llmhub.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Labels for one component: include "llmhub.componentLabels" (dict "ctx" $ "component" "backend") */}}
{{- define "llmhub.componentLabels" -}}
{{ include "llmhub.labels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "llmhub.componentSelectorLabels" -}}
{{ include "llmhub.selectorLabels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "llmhub.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "llmhub.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* image: include "llmhub.image" (dict "image" .Values.backend.image "ctx" $) */}}
{{- define "llmhub.image" -}}
{{- printf "%s:%s" .image.repository (default .ctx.Chart.AppVersion .image.tag) }}
{{- end }}

{{/* Origin the browser uses: publicUrl, else the ingress host, else localhost. */}}
{{- define "llmhub.publicUrl" -}}
{{- if .Values.publicUrl }}
{{- .Values.publicUrl | trimSuffix "/" }}
{{- else if .Values.ingress.enabled }}
{{- printf "%s://%s" (ternary "https" "http" (gt (len .Values.ingress.tls) 0)) .Values.ingress.host }}
{{- else }}
{{- printf "http://localhost:%v" .Values.frontend.service.port }}
{{- end }}
{{- end }}

{{- define "llmhub.secretName" -}}
{{- default (printf "%s-app" (include "llmhub.fullname" .)) .Values.secrets.existingSecret }}
{{- end }}

{{/* ------------------------------------------------------------ database */}}

{{- define "llmhub.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "llmhub.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "llmhub.db.host" -}}
{{- if .Values.postgresql.enabled }}{{ include "llmhub.postgresql.fullname" . }}{{ else }}{{ required "externalDatabase.host is required when postgresql.enabled=false" .Values.externalDatabase.host }}{{ end }}
{{- end }}

{{- define "llmhub.db.port" -}}
{{- if .Values.postgresql.enabled }}5432{{ else }}{{ .Values.externalDatabase.port }}{{ end }}
{{- end }}

{{- define "llmhub.db.name" -}}
{{- if .Values.postgresql.enabled }}{{ .Values.postgresql.database }}{{ else }}{{ .Values.externalDatabase.database }}{{ end }}
{{- end }}

{{- define "llmhub.db.user" -}}
{{- if .Values.postgresql.enabled }}{{ .Values.postgresql.username }}{{ else }}{{ .Values.externalDatabase.username }}{{ end }}
{{- end }}

{{- define "llmhub.db.secretName" -}}
{{- if .Values.postgresql.enabled }}
{{- default (include "llmhub.postgresql.fullname" .) .Values.postgresql.existingSecret }}
{{- else }}
{{- default (printf "%s-externaldb" (include "llmhub.fullname" .)) .Values.externalDatabase.existingSecret }}
{{- end }}
{{- end }}

{{- define "llmhub.db.passwordKey" -}}
{{- if .Values.postgresql.enabled }}{{ .Values.postgresql.passwordKey }}{{ else }}{{ .Values.externalDatabase.passwordKey }}{{ end }}
{{- end }}

{{/*
Env vars that yield the connection URL as $(LLMHUB_DATABASE_URL). Kubernetes
expands $(VAR) from earlier entries, so the password never appears in a
ConfigMap. Containers then map it to the name they expect.
*/}}
{{- define "llmhub.db.env" -}}
- name: LLMHUB_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "llmhub.db.secretName" . }}
      key: {{ include "llmhub.db.passwordKey" . }}
- name: LLMHUB_DATABASE_URL
  value: {{ printf "postgresql://%s:$(LLMHUB_DB_PASSWORD)@%s:%s/%s%s" (include "llmhub.db.user" .) (include "llmhub.db.host" .) (include "llmhub.db.port" .) (include "llmhub.db.name" .) (ternary (printf "?%s" .Values.externalDatabase.params) "" (and (not .Values.postgresql.enabled) (ne .Values.externalDatabase.params ""))) | quote }}
{{- end }}

{{/* Init container that blocks until PostgreSQL accepts connections. */}}
{{- define "llmhub.waitForDb" -}}
- name: wait-for-db
  image: {{ include "llmhub.image" (dict "image" .Values.postgresql.image "ctx" .) }}
  imagePullPolicy: {{ .Values.postgresql.image.pullPolicy }}
  command:
    - sh
    - -c
    - until pg_isready -h {{ include "llmhub.db.host" . }} -p {{ include "llmhub.db.port" . }} -U {{ include "llmhub.db.user" . }}; do sleep 2; done
{{- end }}

{{/* Render a map as env entries, skipping empty values. */}}
{{- define "llmhub.envFromMap" -}}
{{- range $k, $v := . }}
{{- if ne (toString $v) "" }}
- name: {{ $k }}
  value: {{ toString $v | quote }}
{{- end }}
{{- end }}
{{- end }}

{{/* Env entry from the app Secret; optional so unset keys are skipped. */}}
{{- define "llmhub.secretEnv" -}}
- name: {{ .name }}
  valueFrom:
    secretKeyRef:
      name: {{ include "llmhub.secretName" .ctx }}
      key: {{ .name }}
      optional: true
{{- end }}
