# Midwater Helm chart

Packages the Midwater web app + simplification worker for Kubernetes.

## Install

```bash
helm install midwater ./deploy/helm/midwater \
  --namespace midwater --create-namespace \
  --set web.image.tag=1.4.2 \
  --set worker.image.tag=1.4.2
```

## Key values

| Path | Default | Notes |
| --- | --- | --- |
| `web.image.repository` | `midwater/web` | Override per registry |
| `web.resources` | 100m/128Mi → 500m/512Mi | Per pod |
| `web.autoscaling.hpa.{min,max}Replicas` | 2 / 10 | HPA bounds |
| `web.autoscaling.hpa.targetCPUUtilizationPercentage` | 65 | CPU target |
| `web.autoscaling.hpa.metrics` | RPS Pods metric | Append any HPA v2 metric |
| `worker.autoscaling.hpa.metrics` | `simplify_jobs_queued` external | Queue-driven |
| `metricsAdapter.prometheusAdapter.enabled` | `false` | Renders Prometheus-Adapter ConfigMap |
| `metricsAdapter.keda.enabled` | `false` | Renders KEDA `ScaledObject` (overrides worker HPA) |
| `serviceMonitor.enabled` | `false` | Prometheus Operator scrape config |

## Autoscaling metrics

Two interchangeable backends for custom / external metrics:

1. **prometheus-adapter** — exposes Prometheus series as
   `custom.metrics.k8s.io` / `external.metrics.k8s.io`. The chart renders a
   ConfigMap; mount it via your existing `prometheus-adapter` release.
2. **KEDA** — preferred for queue-driven workers (scale-to-min on idle, fast
   scale-out on spikes). When enabled, the worker HPA is replaced by a
   `ScaledObject`.

Both are off by default so the chart installs cleanly on a vanilla cluster.

## Lint / template

```bash
helm lint  ./deploy/helm/midwater
helm template midwater ./deploy/helm/midwater | kubectl apply --dry-run=client -f -
```
