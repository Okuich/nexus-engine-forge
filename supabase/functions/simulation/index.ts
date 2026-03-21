import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { action, config, geometryStats, jobId, tenantId } = await req.json();

    switch (action) {
      case "submit": {
        // Create a simulation job record
        const { data: job, error } = await supabase
          .from("training_jobs")
          .insert({
            name: `Simulation: ${config.type} analysis`,
            model_type: `sim-${config.type}`,
            status: "queued",
            config: {
              simulation: true,
              simulationType: config.type,
              ...config,
              geometryStats,
            },
            tenant_id: tenantId || null,
          })
          .select()
          .single();

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, job }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "status": {
        const { data, error } = await supabase
          .from("training_jobs")
          .select("*")
          .eq("id", jobId)
          .single();

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, job: data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "list": {
        const { data, error } = await supabase
          .from("training_jobs")
          .select("*")
          .like("model_type", "sim-%")
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, jobs: data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
