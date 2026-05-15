# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Simplification worker — Deno-based long-running service
#
# Mirrors the logic from `supabase/functions/simplify-api` but runs as a
# horizontally-scalable Kubernetes Deployment. Health, readiness, and
# Prometheus-style metrics endpoints are exposed for HPA + service-mesh probes.
# ─────────────────────────────────────────────────────────────────────────────
FROM denoland/deno:alpine-1.46.3 AS base
WORKDIR /app

# Non-root user for K8s `runAsNonRoot: true`
RUN addgroup -S worker && adduser -S worker -G worker

# Cache deps separately so source edits don't re-pull npm specifiers
COPY server.ts ./server.ts
RUN deno cache --no-lock server.ts

# Drop privileges
USER worker

# Tunables (overridable via Deployment env)
ENV PORT=8080 \
    MAX_CONCURRENCY=8 \
    MAX_TRIANGLES=200000 \
    LOG_LEVEL=info

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["deno", "run", "--allow-net", "--allow-env", "--no-lock", "server.ts"]
