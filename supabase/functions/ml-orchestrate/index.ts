import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Pipeline Orchestrator ──────────────────────────────────────
// Manages the full CAD → preprocess → inference → results pipeline
// Equivalent to NestJS orchestration layer

interface PipelineRequest {
  action: "run_pipeline" | "pipeline_status" | "list_pipelines";
  pipeline_id?: string;
  file_name?: string;
  material?: string;
  process?: string;
  node_count?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body: PipelineRequest = await req.json();

    // ── Run Full Pipeline ────────────────────────────────────────
    if (body.action === "run_pipeline") {
      const pipelineId = crypto.randomUUID();
      const fileName = body.file_name ?? "uploaded_part.step";
      const material = body.material ?? "Al 7075-T6";
      const process = body.process ?? "CNC Milling";
      const nodeCount = body.node_count ?? 30;

      // 1. Create pipeline job
      const { data: job, error: jobErr } = await supabase
        .from("training_jobs")
        .insert({
          name: `Pipeline: ${fileName}`,
          model_type: "gat",
          status: "preprocessing",
          config: { pipeline: true, file_name: fileName, material, process },
          epochs_total: 4, // 4 pipeline stages
        })
        .select()
        .single();

      if (jobErr) throw jobErr;
      const jobId = job.id;

      // Run pipeline stages asynchronously
      runPipeline(supabase, jobId, fileName, material, process, nodeCount);

      return new Response(
        JSON.stringify({
          pipeline_id: jobId,
          status: "started",
          stages: ["upload", "preprocess", "inference", "report"],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Pipeline Status ──────────────────────────────────────────
    if (body.action === "pipeline_status" && body.pipeline_id) {
      const { data, error } = await supabase
        .from("training_jobs")
        .select("*")
        .eq("id", body.pipeline_id)
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── List Pipelines ───────────────────────────────────────────
    if (body.action === "list_pipelines") {
      const { data, error } = await supabase
        .from("training_jobs")
        .select("*")
        .filter("config->>pipeline", "eq", "true")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      return new Response(JSON.stringify({ pipelines: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── Async Pipeline Execution ───────────────────────────────────

async function runPipeline(
  supabase: any,
  jobId: string,
  fileName: string,
  material: string,
  process: string,
  nodeCount: number
) {
  const updateJob = async (updates: Record<string, any>) => {
    await supabase
      .from("training_jobs")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", jobId);
  };

  const logMetric = async (epoch: number, data: Record<string, number | null>) => {
    await supabase.from("training_metrics").insert({
      job_id: jobId,
      epoch,
      ...data,
    });
  };

  try {
    // Stage 1: Upload verification
    await updateJob({ status: "preprocessing", progress: 10, epochs_completed: 0 });
    await logMetric(1, { train_loss: null, val_loss: null, accuracy: null, f1_score: null, learning_rate: null });
    await delay(800);

    // Stage 2: Geometry preprocessing  
    await updateJob({ status: "preprocessing", progress: 35, epochs_completed: 1 });
    await logMetric(2, { train_loss: null, val_loss: null, accuracy: null, f1_score: null, learning_rate: null });
    await delay(1200);

    // Stage 3: GNN inference
    await updateJob({ status: "evaluating", progress: 65, epochs_completed: 2 });

    // Simulate inference
    const complexity = Math.min(1, nodeCount * 0.02);
    const score = Math.max(25, Math.min(98, 92 - complexity * 25 - Math.random() * 8));
    const materialMult = material === "Ti-6Al-4V" ? 3.2 : material === "Inconel 718" ? 4.1 : 1.0;
    const cost = Math.round((300 + nodeCount * 20) * materialMult);
    const riskLevel = score >= 85 ? "low" : score >= 70 ? "medium" : score >= 50 ? "high" : "critical";

    await logMetric(3, {
      train_loss: null,
      val_loss: null,
      accuracy: Math.round(score) / 100,
      f1_score: Math.round(score * 0.95) / 100,
      learning_rate: null,
    });
    await delay(1500);

    // Stage 4: Report generation
    await updateJob({ status: "evaluating", progress: 90, epochs_completed: 3 });
    await delay(600);

    // Complete
    await updateJob({
      status: "completed",
      progress: 100,
      epochs_completed: 4,
      metrics: {
        manufacturability_score: Math.round(score * 10) / 10,
        estimated_cost_usd: cost,
        risk_level: riskLevel,
        material,
        process: process,
        file_name: fileName,
        node_count: nodeCount,
        complexity: Math.round(complexity * 100) / 100,
      },
    });

    // Create model version record
    await supabase.from("model_versions").insert({
      job_id: jobId,
      version: `pipeline-${Date.now()}`,
      model_type: "gat",
      metrics: {
        manufacturability_score: Math.round(score * 10) / 10,
        estimated_cost_usd: cost,
        risk_level: riskLevel,
      },
      is_active: true,
    });
  } catch (err) {
    await updateJob({
      status: "failed",
      error_message: err.message ?? "Pipeline execution failed",
    });
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
