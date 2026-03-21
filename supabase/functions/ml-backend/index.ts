/**
 * Midwater ML Backend Proxy — Edge Function
 *
 * Proxies requests from the frontend to the Python FastAPI ML backend.
 * Handles authentication, request validation, and error normalization.
 *
 * Environment:
 *   ML_BACKEND_URL — Base URL of the Python backend (e.g. https://ml.midwater.ai)
 *
 * The Python backend is expected to expose:
 *   POST /health
 *   POST /predict
 *   POST /predict/batch
 *   POST /train
 *   GET  /train/{job_id}/status
 *   GET  /train/{job_id}/metrics
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_BACKEND_URL = Deno.env.get("ML_BACKEND_URL") ?? "http://localhost:8000";

// ─── Helpers ─────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500) {
  console.error(`[ml-backend] ERROR: ${message}`);
  return json({ error: message }, status);
}

async function proxyToBackend(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<{ data: unknown; status: number }> {
  const url = `${ML_BACKEND_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  console.log(`[ml-backend] ${method} ${url}`);

  try {
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      throw new Error(
        `Backend returned ${resp.status}: ${JSON.stringify(data)}`,
      );
    }

    return { data, status: resp.status };
  } catch (err) {
    clearTimeout(timer);

    if (err.name === "AbortError") {
      throw new Error(`Backend request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

// ─── Simulated Backend (for development without Python backend) ──

async function simulatedPredict(submission: any) {
  const nodeCount = submission.nodeFeatures?.length ?? 20;
  const complexity = Math.min(1, nodeCount * 0.02);
  const materialMult =
    submission.material === "Ti-6Al-4V" ? 3.2
    : submission.material === "Inconel 718" ? 4.1
    : 1.0;

  const score = Math.max(25, Math.min(98, 92 - complexity * 25 - Math.random() * 8));
  const cost = Math.round((300 + nodeCount * 20) * materialMult);

  return {
    geometryId: submission.geometryId,
    manufacturabilityScore: Math.round(score * 10) / 10,
    estimatedCostUsd: cost,
    riskLevel: score >= 85 ? "low" : score >= 70 ? "medium" : score >= 50 ? "high" : "critical",
    riskRegions: complexity > 0.5
      ? [{ faceIndex: 0, severity: "medium", description: "Thin wall region detected" }]
      : [],
    recommendations: [
      complexity > 0.3 ? "Consider simplifying geometry to reduce machining time" : "Geometry is well-suited for selected process",
      materialMult > 2 ? "Consider alternative alloy to reduce material cost" : null,
    ].filter(Boolean),
    latencyMs: Math.round(50 + Math.random() * 100),
    modelVersion: "sim-v1.0.0",
  };
}

async function simulatedTrain(supabase: any, request: any) {
  const { data: job, error } = await supabase
    .from("training_jobs")
    .insert({
      name: request.name,
      model_type: request.modelType ?? "gat",
      dataset_id: request.datasetId ?? null,
      config: request.config ?? {},
      epochs_total: request.config?.epochs ?? 100,
      status: "queued",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { jobId: job.id };
}

async function simulatedStatus(supabase: any, jobId: string) {
  const { data, error } = await supabase
    .from("training_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error) throw new Error(error.message);

  return {
    jobId: data.id,
    status: data.status,
    progress: data.progress,
    epochsCompleted: data.epochs_completed,
    epochsTotal: data.epochs_total,
    metrics: {
      trainLoss: data.metrics?.final_train_loss ?? null,
      valLoss: data.metrics?.best_val_loss ?? null,
      accuracy: data.metrics?.best_accuracy ?? null,
      f1Score: data.metrics?.best_f1 ?? null,
    },
    error: data.error_message ?? undefined,
    startedAt: data.started_at ?? undefined,
    completedAt: data.completed_at ?? undefined,
  };
}

async function simulatedMetrics(supabase: any, jobId: string) {
  const { data, error } = await supabase
    .from("training_metrics")
    .select("*")
    .eq("job_id", jobId)
    .order("epoch", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ─── Main Handler ────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { action } = body;
    const useSimulation = !Deno.env.get("ML_BACKEND_URL");

    console.log(`[ml-backend] action=${action} simulated=${useSimulation}`);

    switch (action) {
      // ── Health Check ───────────────────────────────────────
      case "health": {
        if (useSimulation) {
          return json({
            status: "healthy",
            version: "sim-v1.0.0",
            gpuAvailable: false,
            modelLoaded: true,
            uptimeSeconds: 3600,
          });
        }
        const { data } = await proxyToBackend("GET", "/health");
        return json(data);
      }

      // ── Prediction ─────────────────────────────────────────
      case "predict": {
        const { submission } = body;
        if (!submission?.nodeFeatures) {
          return errorResponse("Missing submission.nodeFeatures", 400);
        }

        if (useSimulation) {
          const result = await simulatedPredict(submission);
          return json(result);
        }

        const { data } = await proxyToBackend("POST", "/predict", submission);
        return json(data);
      }

      // ── Batch Prediction ───────────────────────────────────
      case "predict_batch": {
        const { submissions } = body;
        if (!Array.isArray(submissions) || submissions.length === 0) {
          return errorResponse("Missing or empty submissions array", 400);
        }

        if (useSimulation) {
          const start = Date.now();
          const results = await Promise.all(submissions.map(simulatedPredict));
          return json({ results, latencyMs: Date.now() - start });
        }

        const { data } = await proxyToBackend("POST", "/predict/batch", { submissions });
        return json(data);
      }

      // ── Start Training ─────────────────────────────────────
      case "train": {
        const { request } = body;
        if (!request?.name) {
          return errorResponse("Missing request.name", 400);
        }

        if (useSimulation) {
          const result = await simulatedTrain(supabase, request);
          return json(result);
        }

        const { data } = await proxyToBackend("POST", "/train", request);
        return json(data);
      }

      // ── Training Status ────────────────────────────────────
      case "training_status": {
        const { jobId } = body;
        if (!jobId) return errorResponse("Missing jobId", 400);

        if (useSimulation) {
          const result = await simulatedStatus(supabase, jobId);
          return json(result);
        }

        const { data } = await proxyToBackend("GET", `/train/${jobId}/status`);
        return json(data);
      }

      // ── Job Metrics ────────────────────────────────────────
      case "job_metrics": {
        const { jobId } = body;
        if (!jobId) return errorResponse("Missing jobId", 400);

        if (useSimulation) {
          const result = await simulatedMetrics(supabase, jobId);
          return json(result);
        }

        const { data } = await proxyToBackend("GET", `/train/${jobId}/metrics`);
        return json(data);
      }

      default:
        return errorResponse(
          `Unknown action: ${action}. Valid: health, predict, predict_batch, train, training_status, job_metrics`,
          400,
        );
    }
  } catch (err) {
    return errorResponse(err.message ?? "Internal error");
  }
});
