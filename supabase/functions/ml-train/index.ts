import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, job_id } = await req.json();

    if (action === "start" && job_id) {
      // Update job to training status
      await supabase
        .from("training_jobs")
        .update({
          status: "training",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id);

      // Simulate training epochs (in production, call FastAPI backend)
      simulateTraining(supabase, job_id);

      return new Response(
        JSON.stringify({ success: true, job_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "status" && job_id) {
      const { data, error } = await supabase
        .from("training_jobs")
        .select("*")
        .eq("id", job_id)
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use 'start' or 'status'." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Simulated training loop — replace with FastAPI call in production
async function simulateTraining(supabase: any, jobId: string) {
  const totalEpochs = 50;
  let trainLoss = 2.5;
  let valLoss = 2.8;
  let accuracy = 0.45;
  let lr = 0.001;

  for (let epoch = 1; epoch <= totalEpochs; epoch++) {
    // Check for cancellation
    const { data: job } = await supabase
      .from("training_jobs")
      .select("status")
      .eq("id", jobId)
      .single();

    if (job?.status === "cancelled") return;

    // Simulate metrics convergence
    trainLoss *= 0.92 + Math.random() * 0.05;
    valLoss *= 0.93 + Math.random() * 0.06;
    accuracy = Math.min(0.98, accuracy + (Math.random() * 0.015));
    const f1 = accuracy * (0.95 + Math.random() * 0.05);
    lr *= 0.995;

    // Insert epoch metrics
    await supabase.from("training_metrics").insert({
      job_id: jobId,
      epoch,
      train_loss: Math.round(trainLoss * 10000) / 10000,
      val_loss: Math.round(valLoss * 10000) / 10000,
      accuracy: Math.round(accuracy * 10000) / 10000,
      f1_score: Math.round(f1 * 10000) / 10000,
      learning_rate: lr,
    });

    // Update job progress
    const progress = Math.round((epoch / totalEpochs) * 100);
    await supabase
      .from("training_jobs")
      .update({
        progress,
        epochs_completed: epoch,
        epochs_total: totalEpochs,
        metrics: {
          best_val_loss: Math.round(valLoss * 10000) / 10000,
          best_accuracy: Math.round(accuracy * 10000) / 10000,
          best_f1: Math.round(f1 * 10000) / 10000,
          final_train_loss: Math.round(trainLoss * 10000) / 10000,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Simulate epoch duration (300ms per epoch)
    await new Promise((r) => setTimeout(r, 300));
  }

  // Mark completed
  await supabase
    .from("training_jobs")
    .update({
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  // Create model version
  const { data: finalJob } = await supabase
    .from("training_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  await supabase.from("model_versions").insert({
    job_id: jobId,
    version: `v${Date.now()}`,
    model_type: finalJob?.model_type ?? "gat",
    metrics: finalJob?.metrics ?? {},
    is_active: true,
  });
}
