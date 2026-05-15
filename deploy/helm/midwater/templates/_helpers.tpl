{{/* vim: set filetype=mustache: */}}

{{- define "midwater.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "midwater.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "midwater.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "midwater.componentName" -}}
{{- printf "%s-%s" (include "midwater.fullname" .root) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "midwater.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "midwater.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: midwater
{{- end -}}

{{- define "midwater.selectorLabels" -}}
app.kubernetes.io/name: {{ include "midwater.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "midwater.image" -}}
{{- $reg := .root.Values.global.imageRegistry -}}
{{- $repo := .img.repository -}}
{{- $tag := default .root.Chart.AppVersion .img.tag -}}
{{- if $reg -}}{{ $reg }}/{{ end -}}{{ $repo }}:{{ $tag }}
{{- end -}}

{{- define "midwater.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "midwater.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
