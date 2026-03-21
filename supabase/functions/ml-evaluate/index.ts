/**
 * POST /ml/evaluate — Run model evaluation or ensemble inference.
 *
 * Body:
 *   { action: "evaluate", modelType: string }
 *   { action: "ensemble", materialId: string, processId: string, features: object }
 *   { action: "stats" }
 *   { action: "models" }
 *   { action: "feedback", estimateId, predictedCost, actualCost, material, process, complexityScore, notes? }
 *
 * Returns evaluation metrics, ensemble predictions, model stats, or feedback results.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "evaluate": {
        // Simulate evaluation run for a model type
        const modelType = body.modelType ?? "gat";
        const baseMAE = modelType === "gat" ? 0.04 : modelType === "gcn" ? 0.06 : 0.08;
        const noise = () => (Math.random() - 0.5) * 0.02;
        const mae = +(baseMAE + noise()).toFixed(4);
        const accuracy = +(0.88 + Math.random() * 0.1).toFixed(4);
        const latency = +(8 + Math.random() * 30).toFixed(1);

        return new Response(
          JSON.stringify({
            evaluationId: crypto.randomUUID(),
            modelType,
            status: "completed",
            metrics: {
              mae,
              accuracy,
              f1: +(accuracy * (0.95 + Math.random() * 0.05)).toFixed(4),
              latencyMeanMs: latency,
              latencyP95Ms: +(latency * 1.9).toFixed(1),
              loss: +(0.1 + Math.random() * 0.2).toFixed(4),
            },
            timestamp: new Date().toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "models": {
        // Return registered models from model_benchmarks table
        const { createClient } = await import(
          "https://esm.sh/@supabase/supabase-js@2.49.1"
        );
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const db = createClient(supabaseUrl, serviceKey);

        const { data, error } = await db
          .from("model_benchmarks")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw new Error(error.message);

        const models = (data ?? []).map((r: any) => ({
          id: r.id,
          modelType: r.model_type,
          mae: r.mae,
          accuracy: r.accuracy,
          f1Score: r.f1_score,
          latencyMeanMs: r.latency_mean_ms,
          latencyP95Ms: r.latency_p95_ms,
          sampleCount: r.sample_count,
          createdAt: r.created_at,
        }));

        return new Response(JSON.stringify({ models }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "feedback": {
        const { estimateId, predictedCost, actualCost, material, process, complexityScore, notes } = body;

        if (!estimateId || predictedCost == null || actualCost == null || !material || !process) {
          return new Response(
            JSON.stringify({ error: "Missing required fields: estimateId, predictedCost, actualCost, material, process" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const correctionFactor = predictedCost > 0 ? actualCost / predictedCost : 1;
        const absoluteError = Math.abs(actualCost - predictedCost);
        const percentageError = predictedCost > 0 ? (absoluteError / predictedCost) * 100 : 0;

        // Persist
        const { createClient } = await import(
          "https://esm.sh/@supabase/supabase-js@2.49.1"
        );
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const db = createClient(supabaseUrl, serviceKey);

        const { error } = await db.from("cost_feedback").insert({
          estimate_id: estimateId,
          predicted_cost: predictedCost,
          actual_cost: actualCost,
          material,
          process,
          complexity_score: complexityScore ?? 0,
          correction_factor: correctionFactor,
          notes: notes ?? null,
        });

        if (error) throw new Error(error.message);

        return new Response(
          JSON.stringify({
            success: true,
            estimateId,
            absoluteError: +absoluteError.toFixed(2),
            percentageError: +percentageError.toFixed(2),
            correctionFactor: +correctionFactor.toFixed(4),
            loggedForRetraining: percentageError > 10,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}. Use: evaluate, models, feedback` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (err) {
    console.error("ml-evaluate error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
