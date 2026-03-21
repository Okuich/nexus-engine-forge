import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Agent Registry ──────────────────────────────────────────────

type AgentType = "geometry" | "cost" | "optimization" | "simulation" | "workflow" | "document";

const AGENT_MAP: Record<string, AgentType> = {
  analyze_faces: "geometry", analyze_edges: "geometry", detect_holes: "geometry",
  measure_thickness: "geometry", check_draft_angles: "geometry", build_topology_graph: "geometry",
  estimate_material_cost: "cost", estimate_machining_time: "cost",
  estimate_total_cost: "cost", quantity_price_breaks: "cost",
  run_topology_optimization: "optimization", suggest_design_changes: "optimization",
  run_parameter_sweep: "optimization",
  run_stress_analysis: "simulation", run_thermal_analysis: "simulation",
  predict_fatigue_life: "simulation", check_manufacturability: "simulation",
  generate_process_plan: "workflow", select_fixtures: "workflow",
  estimate_lead_time: "workflow", define_quality_checkpoints: "workflow",
  generate_quote: "document", generate_inspection_report: "document",
  generate_material_cert: "document", generate_process_sheet: "document",
};

// ─── Tool Definitions for LLM ────────────────────────────────────

const TOOL_DEFINITIONS = [
  // Geometry
  { type: "function" as const, function: { name: "analyze_faces", description: "Extract and classify all faces from CAD geometry", parameters: { type: "object", properties: { model_id: { type: "string" } }, required: ["model_id"] } } },
  { type: "function" as const, function: { name: "detect_holes", description: "Detect and classify holes", parameters: { type: "object", properties: { model_id: { type: "string" }, min_diameter: { type: "number" } }, required: ["model_id"] } } },
  { type: "function" as const, function: { name: "measure_thickness", description: "Compute wall thickness distribution", parameters: { type: "object", properties: { model_id: { type: "string" }, sample_density: { type: "number" } }, required: ["model_id"] } } },
  { type: "function" as const, function: { name: "check_draft_angles", description: "Check draft angles on faces", parameters: { type: "object", properties: { model_id: { type: "string" }, pull_direction: { type: "string" } }, required: ["model_id"] } } },
  { type: "function" as const, function: { name: "build_topology_graph", description: "Build face-adjacency topology graph", parameters: { type: "object", properties: { model_id: { type: "string" } }, required: ["model_id"] } } },
  // Cost
  { type: "function" as const, function: { name: "estimate_material_cost", description: "Calculate raw material cost", parameters: { type: "object", properties: { material: { type: "string" }, volume_cm3: { type: "number" }, bounding_volume_cm3: { type: "number" } }, required: ["material", "volume_cm3"] } } },
  { type: "function" as const, function: { name: "estimate_machining_time", description: "Estimate CNC machining cycle time", parameters: { type: "object", properties: { face_count: { type: "number" }, hole_count: { type: "number" }, material: { type: "string" }, complexity_score: { type: "number" } }, required: ["face_count", "material"] } } },
  { type: "function" as const, function: { name: "estimate_total_cost", description: "Aggregate all costs into total", parameters: { type: "object", properties: { material_cost: { type: "number" }, machining_hours: { type: "number" }, quantity: { type: "number" } }, required: ["material_cost", "machining_hours"] } } },
  { type: "function" as const, function: { name: "quantity_price_breaks", description: "Calculate volume pricing", parameters: { type: "object", properties: { unit_cost: { type: "number" }, quantities: { type: "array", items: { type: "number" } } }, required: ["unit_cost", "quantities"] } } },
  // Optimization
  { type: "function" as const, function: { name: "run_topology_optimization", description: "Multi-objective topology optimization", parameters: { type: "object", properties: { model_id: { type: "string" }, objectives: { type: "array", items: { type: "string" } }, material: { type: "string" }, constraints: { type: "object" } }, required: ["model_id", "objectives", "material"] } } },
  { type: "function" as const, function: { name: "suggest_design_changes", description: "AI-driven design improvement suggestions", parameters: { type: "object", properties: { analysis_data: { type: "object" }, priorities: { type: "array", items: { type: "string" } } }, required: ["analysis_data"] } } },
  { type: "function" as const, function: { name: "run_parameter_sweep", description: "Sweep design parameters", parameters: { type: "object", properties: { parameters: { type: "object" }, objective: { type: "string" }, resolution: { type: "number" } }, required: ["parameters", "objective"] } } },
  // Simulation
  { type: "function" as const, function: { name: "run_stress_analysis", description: "FEA stress analysis", parameters: { type: "object", properties: { model_id: { type: "string" }, load_newtons: { type: "number" }, material: { type: "string" } }, required: ["model_id", "material"] } } },
  { type: "function" as const, function: { name: "run_thermal_analysis", description: "Thermal distribution analysis", parameters: { type: "object", properties: { model_id: { type: "string" }, temp_celsius: { type: "number" }, material: { type: "string" } }, required: ["model_id", "material"] } } },
  { type: "function" as const, function: { name: "predict_fatigue_life", description: "Fatigue life prediction", parameters: { type: "object", properties: { max_stress_mpa: { type: "number" }, material: { type: "string" }, stress_ratio: { type: "number" } }, required: ["max_stress_mpa", "material"] } } },
  { type: "function" as const, function: { name: "check_manufacturability", description: "Manufacturability scoring", parameters: { type: "object", properties: { face_count: { type: "number" }, hole_count: { type: "number" }, min_thickness: { type: "number" }, complex_face_ratio: { type: "number" } }, required: ["face_count", "min_thickness"] } } },
  // Workflow
  { type: "function" as const, function: { name: "generate_process_plan", description: "Generate machining process plan", parameters: { type: "object", properties: { model_id: { type: "string" }, material: { type: "string" }, quantity: { type: "number" } }, required: ["model_id", "material"] } } },
  { type: "function" as const, function: { name: "select_fixtures", description: "Recommend work-holding fixtures", parameters: { type: "object", properties: { process_plan: { type: "object" } }, required: ["process_plan"] } } },
  { type: "function" as const, function: { name: "estimate_lead_time", description: "Estimate total lead time", parameters: { type: "object", properties: { machining_hours: { type: "number" }, quantity: { type: "number" }, priority: { type: "string" } }, required: ["machining_hours", "quantity"] } } },
  { type: "function" as const, function: { name: "define_quality_checkpoints", description: "Define inspection checkpoints", parameters: { type: "object", properties: { process_plan: { type: "object" }, tolerance_class: { type: "string" } }, required: ["process_plan"] } } },
  // Document
  { type: "function" as const, function: { name: "generate_quote", description: "Generate formal quotation", parameters: { type: "object", properties: { part_name: { type: "string" }, cost_breakdown: { type: "object" }, lead_time_days: { type: "number" }, quantity: { type: "number" } }, required: ["part_name", "cost_breakdown", "lead_time_days"] } } },
  { type: "function" as const, function: { name: "generate_inspection_report", description: "Generate inspection report", parameters: { type: "object", properties: { part_name: { type: "string" }, checkpoints: { type: "array" } }, required: ["part_name", "checkpoints"] } } },
  { type: "function" as const, function: { name: "generate_material_cert", description: "Generate material cert", parameters: { type: "object", properties: { material: { type: "string" }, properties: { type: "object" } }, required: ["material"] } } },
  { type: "function" as const, function: { name: "generate_process_sheet", description: "Generate process sheet", parameters: { type: "object", properties: { process_plan: { type: "object" }, part_name: { type: "string" } }, required: ["process_plan", "part_name"] } } },
];

// ─── In-Memory Cache (per invocation warm, cross-request via DB) ─

const memoryCache = new Map<string, { data: unknown; expires: number }>();

function getCacheKey(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(args, Object.keys(args).sort())}`;
}

// ─── Validation Layer ────────────────────────────────────────────

interface ValidationError { field: string; message: string }

function validateToolArgs(tool: string, args: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const def = TOOL_DEFINITIONS.find(t => t.function.name === tool);
  if (!def) { errors.push({ field: "tool", message: `Unknown tool: ${tool}` }); return errors; }

  const required = def.function.parameters.required || [];
  for (const r of required) {
    if (args[r] === undefined || args[r] === null || args[r] === "") {
      errors.push({ field: r, message: `Required parameter '${r}' is missing` });
    }
  }

  // Type checks
  const props = def.function.parameters.properties as Record<string, { type: string }>;
  for (const [key, val] of Object.entries(args)) {
    const schema = props[key];
    if (!schema) continue;
    if (schema.type === "number" && typeof val !== "number") {
      errors.push({ field: key, message: `'${key}' must be a number, got ${typeof val}` });
    }
    if (schema.type === "string" && typeof val !== "string") {
      errors.push({ field: key, message: `'${key}' must be a string, got ${typeof val}` });
    }
  }

  return errors;
}

// ─── Tool Execution Engine ───────────────────────────────────────

const MAX_RETRIES = 2;
const CACHEABLE_TOOLS = new Set([
  "analyze_faces", "analyze_edges", "detect_holes", "measure_thickness",
  "check_draft_angles", "build_topology_graph", "run_stress_analysis",
  "run_thermal_analysis", "check_manufacturability", "estimate_material_cost",
  "estimate_machining_time",
]);

function executeTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case "analyze_faces":
      return { total_faces: 47, breakdown: { planar: 28, cylindrical: 12, conical: 3, toroidal: 2, bspline: 2 }, total_area_mm2: 18432.7 };
    case "analyze_edges":
      return { total_edges: 112, breakdown: { line: 68, arc: 32, spline: 12 }, total_length_mm: 4821.3 };
    case "detect_holes":
      return { total_holes: 12, holes: [{ id: 1, diameter: 8.0, depth: 15.0, type: "through" }, { id: 2, diameter: 5.0, depth: 8.0, type: "blind" }, { id: 3, diameter: 3.2, depth: 25.0, type: "through" }], warnings: ["Hole #3: L/D ratio 7.8 exceeds recommended 6.0"] };
    case "measure_thickness":
      return { min_thickness_mm: 1.2, max_thickness_mm: 14.8, avg_thickness_mm: 4.3, thin_regions: [{ location: [12.5, -3.2, 45.0], thickness: 1.2, warning: "Below 1.5mm min for Ti-6Al-4V" }], uniformity_score: 62 };
    case "check_draft_angles":
      return { faces_checked: 47, passing: 44, failing: 3, details: [{ face_id: 12, angle: 1.2, required: 3.0 }, { face_id: 23, angle: 0.8, required: 3.0 }] };
    case "build_topology_graph":
      return { nodes: 47, edges: 112, connected_components: 1, max_degree: 8, avg_degree: 4.8 };
    case "estimate_material_cost": {
      const m = (args.material as string) || "Ti-6Al-4V";
      const v = (args.volume_cm3 as number) || 120;
      const prices: Record<string, number> = { "Ti-6Al-4V": 180, "Inconel 718": 95, "Al 7075-T6": 12, "SS 316L": 8 };
      const densities: Record<string, number> = { "Ti-6Al-4V": 4.43, "Inconel 718": 8.19, "Al 7075-T6": 2.81, "SS 316L": 7.99 };
      const d = densities[m] || 4.43; const p = prices[m] || 50;
      const massKg = (v * d) / 1000; const btf = 3.2;
      return { material: m, volume_cm3: v, mass_kg: +(massKg).toFixed(2), buy_to_fly_ratio: btf, material_cost_usd: +(massKg * btf * p).toFixed(2) };
    }
    case "estimate_machining_time": {
      const f = (args.face_count as number) || 47; const h = (args.hole_count as number) || 12;
      const c = (args.complexity_score as number) || 65;
      const total = (2.0 + f * 0.05 + h * 0.15) * (1 + (c / 100) * 0.8);
      return { roughing_hours: +(total * 0.4).toFixed(2), finishing_hours: +(total * 0.45).toFixed(2), setup_hours: +(total * 0.15).toFixed(2), total_hours: +total.toFixed(2), machining_cost_usd: +(total * 150).toFixed(2) };
    }
    case "estimate_total_cost": {
      const mc = (args.material_cost as number) || 0; const mh = (args.machining_hours as number) || 0;
      const q = (args.quantity as number) || 1; const machCost = mh * 150;
      const overhead = (mc + machCost) * 0.15; const unit = mc + machCost + overhead;
      return { material: mc, machining: machCost, overhead: +overhead.toFixed(2), unit_cost: +unit.toFixed(2), total: +(unit * q).toFixed(2), quantity: q };
    }
    case "quantity_price_breaks": {
      const uc = (args.unit_cost as number) || 1000; const qs = (args.quantities as number[]) || [1, 10, 50, 100];
      return { breaks: qs.map(q => ({ quantity: q, unit_price: +(uc * (q === 1 ? 1 : q < 10 ? 0.92 : q < 50 ? 0.82 : 0.72)).toFixed(2), total: +(uc * q * (q === 1 ? 1 : q < 10 ? 0.92 : q < 50 ? 0.82 : 0.72)).toFixed(2) })) };
    }
    case "run_topology_optimization":
      return { iterations: 80, best_score: 0.89, weight_reduction_pct: 18.3, cost_reduction_pct: 24.1, changes: [{ type: "thickness_increase", region: "Section C-7", value: "1.2mm → 2.0mm" }, { type: "hole_simplify", id: 3, description: "Split deep hole into 2 operations" }] };
    case "suggest_design_changes":
      return { suggestions: [{ priority: "high", change: "Add reinforcement rib at thin wall region", impact: "Manufacturability +15pts" }, { priority: "medium", change: "Increase draft on 3 faces to 3°", impact: "Reduces tooling cost 12%" }, { priority: "low", change: "Simplify B-spline surface #2 to cylindrical", impact: "Finishing time -8%" }] };
    case "run_parameter_sweep":
      return { parameter_count: Object.keys(args.parameters || {}).length, evaluations: 100, optimal: { wall_thickness: 2.1, draft_angle: 3.5, fillet_radius: 1.5 }, objective_value: 0.91 };
    case "run_stress_analysis":
      return { max_von_mises_mpa: 342.7, yield_strength_mpa: 880, safety_factor: 2.57, critical_location: [12.5, -3.2, 45.0], status: "PASS" };
    case "run_thermal_analysis":
      return { max_temp_c: 248.3, min_temp_c: 22.1, gradient_c_per_mm: 1.8, hot_spots: [{ location: [12.5, -3.2, 45.0], temp: 248.3 }], status: "PASS" };
    case "predict_fatigue_life":
      return { cycles_to_failure: 1.2e6, endurance_limit_mpa: 510, safety_factor: 1.49, status: (args.max_stress_mpa as number) < 510 ? "INFINITE_LIFE" : "FINITE_LIFE" };
    case "check_manufacturability":
      return { overall_score: 72, sub_scores: { wall_thickness: 58, hole_accessibility: 75, undercuts: 85, surface_complexity: 68 }, warnings: ["Thin wall at inlet (1.2mm < 1.5mm)", "Deep hole L/D=7.8", "3 faces insufficient draft"], recommendations: ["Add rib at C-7", "Split hole #3", "Increase draft to 3°"] };
    case "generate_process_plan":
      return { operations: [{ seq: 1, type: "rough_mill", machine: "5-axis CNC", time_min: 45 }, { seq: 2, type: "drill", machine: "CNC drill", time_min: 20 }, { seq: 3, type: "finish_mill", machine: "5-axis CNC", time_min: 35 }, { seq: 4, type: "deburr", machine: "manual", time_min: 15 }], total_time_min: 115 };
    case "select_fixtures":
      return { fixtures: [{ operation: 1, type: "3-jaw chuck", clamping_force: "12kN" }, { operation: 2, type: "vice with soft jaws", clamping_force: "8kN" }] };
    case "estimate_lead_time": {
      const mh2 = (args.machining_hours as number) || 2; const q2 = (args.quantity as number) || 1;
      const p2 = (args.priority as string) || "standard";
      const mult = p2 === "rush" ? 0.6 : p2 === "critical" ? 0.4 : 1.0;
      const days = Math.ceil((mh2 * q2 / 8 + 3) * mult);
      return { business_days: days, calendar_days: Math.ceil(days * 1.4), priority: p2, includes_inspection: true };
    }
    case "define_quality_checkpoints":
      return { checkpoints: [{ after_op: 1, type: "dimensional", measurements: ["OD", "length", "concentricity"] }, { after_op: 3, type: "surface_finish", spec: "Ra 1.6μm" }, { final: true, type: "CMM_full", tolerance_class: args.tolerance_class || "IT7" }] };
    case "generate_quote":
      return { quote_number: `Q-${Date.now().toString(36).toUpperCase()}`, part_name: args.part_name, line_items: [{ description: "Material", amount: (args.cost_breakdown as any)?.material || 342 }, { description: "Machining", amount: (args.cost_breakdown as any)?.machining || 1125 }, { description: "Overhead", amount: (args.cost_breakdown as any)?.overhead || 220 }], total: (args.cost_breakdown as any)?.total || 1687, lead_time_days: args.lead_time_days, validity_days: 30 };
    case "generate_inspection_report":
      return { report_id: `IR-${Date.now().toString(36).toUpperCase()}`, part_name: args.part_name, checkpoint_count: (args.checkpoints as any[])?.length || 3, template_ready: true };
    case "generate_material_cert":
      return { cert_id: `MC-${Date.now().toString(36).toUpperCase()}`, material: args.material, spec: "AMS 4928", properties: { UTS: "950 MPa", yield: "880 MPa", elongation: "14%", hardness: "36 HRC" } };
    case "generate_process_sheet":
      return { sheet_id: `PS-${Date.now().toString(36).toUpperCase()}`, part_name: args.part_name, operations: ((args.process_plan as any)?.operations || []).length, generated: true };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function executeWithCacheAndRetry(
  name: string, args: Record<string, unknown>,
  supabaseAdmin: any, tenantId?: string,
): Promise<{ success: boolean; data: Record<string, unknown>; retries: number; cached: boolean }> {
  // Check in-memory cache
  const cacheKey = getCacheKey(name, args);
  if (CACHEABLE_TOOLS.has(name)) {
    const cached = memoryCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return { success: true, data: cached.data as Record<string, unknown>, retries: 0, cached: true };
    }
    // Check DB cache
    if (supabaseAdmin && tenantId) {
      try {
        const { data: memRow } = await supabaseAdmin
          .from("agent_memory")
          .select("value, expires_at")
          .eq("tenant_id", tenantId)
          .eq("memory_type", "tool_result_cache")
          .eq("key", cacheKey)
          .maybeSingle();
        if (memRow && (!memRow.expires_at || new Date(memRow.expires_at) > new Date())) {
          memoryCache.set(cacheKey, { data: memRow.value, expires: Date.now() + 300_000 });
          return { success: true, data: memRow.value as Record<string, unknown>, retries: 0, cached: true };
        }
      } catch { /* DB cache miss, continue */ }
    }
  }

  // Execute with retries
  let retries = 0;
  while (retries <= MAX_RETRIES) {
    try {
      const result = executeTool(name, args);
      if (result.error) throw new Error(result.error as string);

      // Store in cache
      if (CACHEABLE_TOOLS.has(name)) {
        const ttl = 600_000;
        memoryCache.set(cacheKey, { data: result, expires: Date.now() + ttl });
        if (supabaseAdmin && tenantId) {
          supabaseAdmin.from("agent_memory").upsert({
            tenant_id: tenantId, memory_type: "tool_result_cache", key: cacheKey,
            value: result, ttl_seconds: 600, expires_at: new Date(Date.now() + ttl).toISOString(),
          }, { onConflict: "tenant_id,memory_type,key" }).then(() => {});
        }
      }

      return { success: true, data: result, retries, cached: false };
    } catch (e) {
      retries++;
      if (retries > MAX_RETRIES) return { success: false, data: { error: (e as Error).message }, retries, cached: false };
      await new Promise(r => setTimeout(r, 500 * retries));
    }
  }
  return { success: false, data: { error: "Max retries exceeded" }, retries: MAX_RETRIES, cached: false };
}

// ─── DAG Scheduler ───────────────────────────────────────────────

interface ToolCall { id: string; function: { name: string; arguments: string } }

function buildDAG(toolCalls: ToolCall[]): string[][] {
  // Simple: group independent calls together, chain dependent ones
  // For now, all tool calls from a single LLM response are independent
  const groups: string[][] = [toolCalls.map(tc => tc.id)];
  return groups;
}

// ─── SSE Helper ──────────────────────────────────────────────────

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ─── Main Handler ────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const { messages, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const tenantId = context?.tenantId;
    let supabaseAdmin: any = null;
    try {
      supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
    } catch { /* no DB persistence */ }

    const systemPrompt = `You are FORGE CAD Copilot, a senior AI systems engineer for industrial CAD/CAM.
You orchestrate 6 specialized agents:

**Geometry Agent** 📐: analyze_faces, analyze_edges, detect_holes, measure_thickness, check_draft_angles, build_topology_graph
**Cost Agent** 💰: estimate_material_cost, estimate_machining_time, estimate_total_cost, quantity_price_breaks
**Optimization Agent** ⚡: run_topology_optimization, suggest_design_changes, run_parameter_sweep
**Simulation Agent** 🔬: run_stress_analysis, run_thermal_analysis, predict_fatigue_life, check_manufacturability
**Workflow Agent** 🔄: generate_process_plan, select_fixtures, estimate_lead_time, define_quality_checkpoints
**Document Agent** 📄: generate_quote, generate_inspection_report, generate_material_cert, generate_process_sheet

For complex queries, chain tools across agents. Always cite numbers from results. Use markdown.
Current model: Turbine_Housing_v4.step (Ti-6Al-4V, 47 faces, 12 holes, 284.3cm³)`;

    // ── Phase 1: LLM Planning ──
    const planResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: TOOL_DEFINITIONS,
        stream: false,
      }),
    });

    if (!planResponse.ok) {
      const s = planResponse.status;
      if (s === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (s === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error: ${s}`);
    }

    const planData = await planResponse.json();
    const choice = planData.choices?.[0];

    // No tool calls → stream text response
    if (!choice?.message?.tool_calls?.length) {
      const text = choice?.message?.content || "Ready to analyze. What would you like to know?";
      const body = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const words = text.split(" ");
          let i = 0;
          const iv = setInterval(() => {
            if (i >= words.length) { controller.enqueue(enc.encode("data: [DONE]\n\n")); controller.close(); clearInterval(iv); return; }
            controller.enqueue(enc.encode(sseEvent({ choices: [{ delta: { content: (i === 0 ? "" : " ") + words[i] } }] })));
            i++;
          }, 25);
        },
      });
      return new Response(body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }

    // ── Phase 2: Validate, Build DAG, Execute ──
    const toolCalls: ToolCall[] = choice.message.tool_calls;
    const parallelGroups = buildDAG(toolCalls);

    const body = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (d: unknown) => controller.enqueue(enc.encode(sseEvent(d)));

        // Planning event
        const agents = [...new Set(toolCalls.map(tc => AGENT_MAP[tc.function.name] || "geometry"))];
        emit({ event: "planning", content: `Orchestrating ${toolCalls.length} tools across ${agents.length} agents: ${agents.join(", ")}`, data: { tool_count: toolCalls.length, agents } });

        // Validate all inputs
        let hasValidationErrors = false;
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* empty */ }
          const errors = validateToolArgs(tc.function.name, args);
          if (errors.length > 0) {
            emit({ event: "validation", tool: tc.function.name, stepId: tc.id, content: `⚠ Validation: ${errors.map(e => e.message).join(", ")}`, data: { errors } });
            hasValidationErrors = true;
          }
        }

        if (hasValidationErrors) {
          emit({ event: "error", content: "Some tool inputs failed validation. Proceeding with available data." });
        }

        // Execute in parallel groups
        const toolResults: { call_id: string; name: string; result: Record<string, unknown> }[] = [];
        let cacheHits = 0;

        for (let gi = 0; gi < parallelGroups.length; gi++) {
          const group = parallelGroups[gi];
          if (group.length > 1) {
            emit({ event: "parallel_group", parallelGroup: gi, content: `Executing ${group.length} tools in parallel (group ${gi + 1})` });
          }

          const promises = group.map(async (tcId) => {
            const tc = toolCalls.find(t => t.id === tcId)!;
            const toolName = tc.function.name;
            let toolArgs: Record<string, unknown> = {};
            try { toolArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* empty */ }

            const agent = AGENT_MAP[toolName] || "geometry";

            emit({ event: "step_start", agent, tool: toolName, stepId: tc.id, content: `Running ${toolName}...` });

            const result = await executeWithCacheAndRetry(toolName, toolArgs, supabaseAdmin, tenantId);

            if (result.cached) {
              cacheHits++;
              emit({ event: "cache_hit", agent, tool: toolName, stepId: tc.id, content: `⚡ ${toolName} (cached)`, cached: true });
            }

            if (result.success) {
              emit({ event: "step_complete", agent, tool: toolName, stepId: tc.id, data: result.data, content: `✓ ${toolName}${result.retries > 0 ? ` (${result.retries} retries)` : ""}${result.cached ? " [cached]" : ""}` });
            } else {
              emit({ event: "step_error", agent, tool: toolName, stepId: tc.id, content: `✗ ${toolName}: ${(result.data as any).error}` });
            }

            toolResults.push({ call_id: tc.id, name: toolName, result: result.data });
          });

          await Promise.all(promises);
        }

        // Store execution in memory
        if (supabaseAdmin) {
          const execRecord = {
            tenant_id: tenantId || null,
            goal: messages[messages.length - 1]?.content || "",
            plan: toolCalls.map(tc => ({ id: tc.id, tool: tc.function.name, agent: AGENT_MAP[tc.function.name] })),
            results: toolResults,
            status: "completed",
            total_duration_ms: Date.now() - startTime,
            model_used: "google/gemini-3-flash-preview",
            token_usage: { cache_hits: cacheHits },
            completed_at: new Date().toISOString(),
          };

          emit({ event: "memory_store", content: `💾 Storing execution (${cacheHits} cache hits, ${Date.now() - startTime}ms)` });

          supabaseAdmin.from("agent_executions").insert(execRecord).then(() => {});
        }

        // ── Phase 3: LLM Synthesis ──
        const synthesisMessages = [
          { role: "system", content: systemPrompt },
          ...messages,
          choice.message,
          ...toolResults.map(tr => ({ role: "tool" as const, tool_call_id: tr.call_id, content: JSON.stringify(tr.result) })),
        ];

        const synthesisResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages: synthesisMessages, stream: true }),
        });

        if (!synthesisResponse.ok || !synthesisResponse.body) {
          emit({ event: "error", content: "Failed to synthesize results" });
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const reader = synthesisResponse.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            let line = buf.slice(0, idx); buf = buf.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (json === "[DONE]") break;
            try {
              const p = JSON.parse(json);
              const c = p.choices?.[0]?.delta?.content;
              if (c) controller.enqueue(enc.encode(sseEvent({ choices: [{ delta: { content: c } }] })));
            } catch { /* skip */ }
          }
        }

        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("Agent orchestrator error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
