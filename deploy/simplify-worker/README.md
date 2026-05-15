# Simplify Worker — Kubernetes deployment

Long-running, horizontally-scalable companion to
`supabase/functions/simplify-api`. The edge function remains the
zero-cold-start path for browser callers; this worker handles
high-volume / batch traffic where you want predictable resource limits
and Prometheus-driven autoscaling.

## Layout

```
deploy/simplify-worker/
├── Dockerfile          # Distroless-style Deno image, runs as non-root
├── server.ts           # HTTP service + /healthz /readyz /metrics
└── k8s/
    ├── configmap.yaml  # PORT, MAX_CONCURRENCY, MAX_TRIANGLES, LOG_LEVEL
    ├── deployment.yaml # Resource requests/limits, probes, security context
    ├── service.yaml    # ClusterIP service + PodDisruptionBudget
    └── hpa.yaml        # CPU + memory + custom-metric autoscaling, ResourceQuota
```

## Build & push

```bash
docker build -t ghcr.io/midwater/simplify-worker:$(git rev-parse --short HEAD) deploy/simplify-worker
docker push  ghcr.io/midwater/simplify-worker:$(git rev-parse --short HEAD)
```

Update the `image:` reference in `k8s/deployment.yaml` (or template it via
Kustomize / Helm in your delivery pipeline).

## Apply

```bash
kubectl apply -f deploy/simplify-worker/k8s/
```

## Endpoints

| Path           | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `POST /v1/lods`       | Generate LOD pyramid                          |
| `POST /v1/graph`      | Coarse mesh / graph stub                      |
| `POST /v1/inference`  | Inference-ready coarse payload                |
| `GET  /healthz`       | Liveness — always 200 while process is alive  |
| `GET  /readyz`        | Readiness — 503 when at `MAX_CONCURRENCY`     |
| `GET  /metrics`       | Prometheus exposition for HPA / dashboards    |

## Autoscaling signals

The HPA scales on three metrics (whichever fires first):

1. **CPU utilization ≥ 70 %** — covers QEM-heavy workloads.
2. **Memory utilization ≥ 80 %** — guards against large-mesh OOM.
3. **`simplify_inflight_requests` ≥ 6 per pod** — custom metric scraped
   from `/metrics`, covers I/O-bound bursts where CPU stays low.

The custom-metric path requires `prometheus-adapter` (or equivalent)
wired into `external.metrics.k8s.io`. If you do not have it, drop the
third metric block — CPU + memory alone are sufficient for most tiers.

## Resource envelope

| Tier | requests          | limits            |
| ---- | ----------------- | ----------------- |
| pod  | 500m CPU / 512 Mi | 2 CPU / 2 Gi      |
| ns   | 30 CPU  / 30 Gi   | 60 CPU / 60 Gi    |

`ResourceQuota` ensures the HPA cannot exhaust the namespace; the
`PodDisruptionBudget` keeps at least one pod available during voluntary
disruptions (node drains, rolling restarts).

## Local smoke test

```bash
deno run --allow-net --allow-env deploy/simplify-worker/server.ts
curl localhost:8080/healthz
curl localhost:8080/metrics
```
