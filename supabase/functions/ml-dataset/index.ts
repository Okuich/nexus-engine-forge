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
    const url = new URL(req.url);
    const body = await req.json();
    const action = body.action;

    if (action === "upload") {
      const { name, samples } = body;
      if (!name || !samples?.length) {
        return new Response(
          JSON.stringify({ error: "name and samples[] required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // In production: store to Supabase Storage or S3
      const datasetId = crypto.randomUUID();
      return new Response(
        JSON.stringify({
          dataset_id: datasetId,
          name,
          sample_count: samples.length,
          status: "uploaded",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "preprocess") {
      const { dataset_id, normalize = true, augment = false, train_split = 0.8 } = body;
      if (!dataset_id) {
        return new Response(
          JSON.stringify({ error: "dataset_id required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // In production: trigger preprocessing pipeline
      return new Response(
        JSON.stringify({
          dataset_id,
          status: "preprocessed",
          config: { normalize, augment, train_split },
          splits: {
            train: Math.round(100 * train_split),
            val: Math.round(100 * (1 - train_split) / 2),
            test: Math.round(100 * (1 - train_split) / 2),
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use 'upload' or 'preprocess'." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
