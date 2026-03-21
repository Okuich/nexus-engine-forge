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
    // Authenticate
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader ?? "" } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { action, ...payload } = await req.json();

    // Service-role client for admin operations
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    switch (action) {
      // ── Create RFQ ──
      case "create_rfq": {
        const { data, error } = await supabase
          .from("rfqs")
          .insert({
            title: payload.title,
            description: payload.description ?? null,
            part_name: payload.partName,
            material: payload.material,
            process: payload.process,
            quantity: payload.quantity ?? 1,
            complexity_score: payload.complexityScore ?? 0.5,
            surface_classes: payload.surfaceClasses ?? [],
            required_certifications: payload.requiredCertifications ?? [],
            max_lead_time_days: payload.maxLeadTimeDays ?? null,
            region: payload.region ?? null,
            target_cost_usd: payload.targetCostUsd ?? null,
            geometry_stats: payload.geometryStats ?? {},
            deadline: payload.deadline ?? null,
            created_by: user.id,
            status: "open",
          })
          .select()
          .single();

        if (error) throw error;
        return jsonResponse({ success: true, rfq: data });
      }

      // ── List RFQs ──
      case "list_rfqs": {
        let query = supabase
          .from("rfqs")
          .select("*")
          .order("created_at", { ascending: false });

        if (payload.status) query = query.eq("status", payload.status);
        if (payload.material) query = query.eq("material", payload.material);
        if (payload.limit) query = query.limit(payload.limit);

        const { data, error } = await query;
        if (error) throw error;
        return jsonResponse({ success: true, rfqs: data });
      }

      // ── Get RFQ with quotes ──
      case "get_rfq": {
        const { data: rfq, error: rfqErr } = await supabase
          .from("rfqs")
          .select("*")
          .eq("id", payload.rfqId)
          .single();

        if (rfqErr) throw rfqErr;

        const { data: quotes } = await supabase
          .from("rfq_quotes")
          .select("*")
          .eq("rfq_id", payload.rfqId)
          .order("rank", { ascending: true, nullsFirst: false });

        return jsonResponse({ success: true, rfq, quotes: quotes ?? [] });
      }

      // ── Match suppliers ──
      case "match_suppliers": {
        const { data: rfq, error: rfqErr } = await supabase
          .from("rfqs")
          .select("*")
          .eq("id", payload.rfqId)
          .single();

        if (rfqErr) throw rfqErr;

        const { data: suppliers } = await adminClient
          .from("supplier_profiles")
          .select("*")
          .eq("active", true);

        // Simple matching logic
        const matched = (suppliers ?? []).filter((s: Record<string, unknown>) => {
          const materials = s.materials as string[];
          const processes = s.processes as string[];
          const maxComp = Number(s.max_complexity);
          if (!materials.includes(rfq.material)) return false;
          if (!processes.includes(rfq.process)) return false;
          if (Number(rfq.complexity_score) > maxComp) return false;
          return true;
        });

        return jsonResponse({
          success: true,
          rfqId: payload.rfqId,
          matched: matched.map((s: Record<string, unknown>) => ({
            supplierId: s.id,
            companyName: s.company_name,
            qualityRating: Number(s.quality_rating),
            leadTimeDays: s.lead_time_days,
            region: s.region,
            certifications: s.certifications,
          })),
          totalMatched: matched.length,
          totalSuppliers: (suppliers ?? []).length,
        });
      }

      // ── Submit quote ──
      case "submit_quote": {
        // Verify supplier profile
        const { data: profile, error: profErr } = await supabase
          .from("supplier_profiles")
          .select("id")
          .eq("user_id", user.id)
          .single();

        if (profErr || !profile) {
          return jsonResponse({ error: "No supplier profile found. Register as a supplier first." }, 400);
        }

        // Get RFQ for quantity
        const { data: rfq } = await supabase
          .from("rfqs")
          .select("quantity, status")
          .eq("id", payload.rfqId)
          .single();

        if (!rfq || rfq.status !== "open") {
          return jsonResponse({ error: "RFQ is not open for quotes" }, 400);
        }

        const totalPrice = payload.unitPriceUsd * (rfq.quantity ?? 1);

        const { data, error } = await supabase
          .from("rfq_quotes")
          .insert({
            rfq_id: payload.rfqId,
            supplier_id: profile.id,
            unit_price_usd: payload.unitPriceUsd,
            total_price_usd: totalPrice,
            lead_time_days: payload.leadTimeDays,
            notes: payload.notes ?? null,
            adjustments: payload.adjustments ?? [],
            confidence: payload.confidence ?? 0.8,
            status: "submitted",
          })
          .select()
          .single();

        if (error) throw error;
        return jsonResponse({ success: true, quote: data });
      }

      // ── Rank quotes ──
      case "rank_quotes": {
        const { data: quotes, error: quotesErr } = await adminClient
          .from("rfq_quotes")
          .select("*")
          .eq("rfq_id", payload.rfqId);

        if (quotesErr) throw quotesErr;
        if (!quotes || quotes.length === 0) {
          return jsonResponse({ success: true, ranked: [], message: "No quotes to rank" });
        }

        const { data: rfq } = await supabase
          .from("rfqs")
          .select("*")
          .eq("id", payload.rfqId)
          .single();

        // Fetch supplier profiles for scoring
        const supplierIds = [...new Set(quotes.map((q: Record<string, unknown>) => q.supplier_id))];
        const { data: suppliers } = await adminClient
          .from("supplier_profiles")
          .select("*")
          .in("id", supplierIds);

        const supplierMap = new Map(
          (suppliers ?? []).map((s: Record<string, unknown>) => [s.id as string, s]),
        );

        // Scoring weights
        const weights = payload.weights ?? { cost: 0.35, leadTime: 0.20, quality: 0.25, certification: 0.10, complexityFit: 0.10 };

        // Normalize and score
        const prices = quotes.map((q: Record<string, unknown>) => Number(q.unit_price_usd));
        const leads = quotes.map((q: Record<string, unknown>) => Number(q.lead_time_days));
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const minLead = Math.min(...leads);
        const maxLead = Math.max(...leads);
        const priceRange = maxPrice - minPrice || 1;
        const leadRange = maxLead - minLead || 1;

        const scored = quotes.map((q: Record<string, unknown>) => {
          const supplier = supplierMap.get(q.supplier_id as string) as Record<string, unknown> | undefined;
          const costScore = 100 - ((Number(q.unit_price_usd) - minPrice) / priceRange) * 100;
          const leadTimeScore = 100 - ((Number(q.lead_time_days) - minLead) / leadRange) * 100;
          const qualityScore = (Number(supplier?.quality_rating ?? 0.7)) * 100;
          const certScore = Math.min(100, ((supplier?.certifications as string[]) ?? []).length * 20);
          const compFit = Math.min(100, 60 + (Number(supplier?.max_complexity ?? 0.5) - Number(rfq?.complexity_score ?? 0.5)) * 200);

          const totalScore =
            costScore * weights.cost +
            leadTimeScore * weights.leadTime +
            qualityScore * weights.quality +
            certScore * weights.certification +
            compFit * weights.complexityFit;

          return { ...q, score: Math.round(totalScore * 10) / 10, score_breakdown: { costScore: Math.round(costScore * 10) / 10, leadTimeScore: Math.round(leadTimeScore * 10) / 10, qualityScore: Math.round(qualityScore * 10) / 10, certificationScore: Math.round(certScore * 10) / 10, complexityFitScore: Math.round(compFit * 10) / 10, totalScore: Math.round(totalScore * 10) / 10 } };
        });

        scored.sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.score) - Number(a.score));

        // Persist rankings
        for (let i = 0; i < scored.length; i++) {
          const q = scored[i];
          await adminClient
            .from("rfq_quotes")
            .update({ rank: i + 1, score: q.score, score_breakdown: q.score_breakdown, updated_at: new Date().toISOString() })
            .eq("id", q.id);
          scored[i].rank = i + 1;
        }

        // Update RFQ status
        await supabase
          .from("rfqs")
          .update({ status: "evaluating", updated_at: new Date().toISOString() })
          .eq("id", payload.rfqId);

        return jsonResponse({ success: true, ranked: scored });
      }

      // ── Award quote ──
      case "award_quote": {
        await adminClient
          .from("rfq_quotes")
          .update({ status: "accepted", updated_at: new Date().toISOString() })
          .eq("id", payload.quoteId);

        await adminClient
          .from("rfq_quotes")
          .update({ status: "rejected", updated_at: new Date().toISOString() })
          .eq("rfq_id", payload.rfqId)
          .neq("id", payload.quoteId);

        await supabase
          .from("rfqs")
          .update({ status: "awarded", updated_at: new Date().toISOString() })
          .eq("id", payload.rfqId);

        return jsonResponse({ success: true, message: "Quote awarded successfully" });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
