import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Simulated GNN Inference ────────────────────────────────────
// In production, this calls your FastAPI/PyTorch Geometric backend.
// Here it simulates realistic GAT inference on a geometry graph.

interface GraphInput {
  nodes: { id: string; type: string; features: number[] }[];
  edges: { source: string; target: string; type: string }[];
  material?: string;
  process?: string;
}

interface InferenceResult {
  manufacturability_score: number;
  estimated_cost_usd: number;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_regions: { node_id: string; severity: string; description: string }[];
  geometry_stats: {
    complexity: number;
    thin_wall_count: number;
    deep_hole_count: number;
    undercut_count: number;
  };
  recommendations: string[];
  latency_ms: number;
}

function runInference(graph: GraphInput): InferenceResult {
  const start = performance.now();

  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const faceCount = graph.nodes.filter((n) => n.type === "face").length;

  // Simulate feature extraction + attention aggregation
  const complexity = Math.min(1, (nodeCount * 0.01 + edgeCount * 0.005));
  const baseScore = 95 - complexity * 30 - Math.random() * 10;
  const score = Math.max(20, Math.min(98, baseScore));

  // Cost model
  const materialMultiplier = graph.material === "Ti-6Al-4V" ? 3.2
    : graph.material === "Inconel 718" ? 4.1
    : graph.material === "Al 7075-T6" ? 1.0
    : 1.5;
  const baseCost = 200 + faceCount * 25 + edgeCount * 8;
  const cost = Math.round(baseCost * materialMultiplier);

  // Risk analysis
  const riskRegions: InferenceResult["risk_regions"] = [];
  const thinWalls = Math.floor(Math.random() * 3);
  const deepHoles = Math.floor(Math.random() * 2);
  const undercuts = Math.floor(Math.random() * 2);

  for (let i = 0; i < thinWalls; i++) {
    riskRegions.push({
      node_id: graph.nodes[Math.floor(Math.random() * nodeCount)]?.id ?? `n${i}`,
      severity: "high",
      description: `Thin wall region ${i + 1}: below minimum thickness threshold`,
    });
  }
  for (let i = 0; i < deepHoles; i++) {
    riskRegions.push({
      node_id: graph.nodes[Math.floor(Math.random() * nodeCount)]?.id ?? `n${i}`,
      severity: "medium",
      description: `Deep hole L/D ratio exceeds recommended limit`,
    });
  }

  const riskLevel = score >= 85 ? "low" : score >= 70 ? "medium" : score >= 50 ? "high" : "critical";

  const recommendations: string[] = [];
  if (thinWalls > 0) recommendations.push("Increase wall thickness in flagged regions to ≥1.5mm");
  if (deepHoles > 0) recommendations.push("Consider step drilling for deep holes with L/D > 6");
  if (undercuts > 0) recommendations.push("Add draft angles ≥3° to undercut faces");
  if (score < 75) recommendations.push("Simplify B-spline surfaces to reduce machining time");
  if (recommendations.length === 0) recommendations.push("Part is well-optimized for manufacturing");

  const latency = performance.now() - start;

  return {
    manufacturability_score: Math.round(score * 10) / 10,
    estimated_cost_usd: cost,
    risk_level: riskLevel,
    risk_regions: riskRegions,
    geometry_stats: {
      complexity: Math.round(complexity * 100) / 100,
      thin_wall_count: thinWalls,
      deep_hole_count: deepHoles,
      undercut_count: undercuts,
    },
    recommendations,
    latency_ms: Math.round(latency * 100) / 100,
  };
}

// ─── Simulated Genetic Optimization ─────────────────────────────

interface OptConfig {
  population_size?: number;
  generations?: number;
  max_time_ms?: number;
}

interface OptResult {
  original_score: InferenceResult;
  optimized_score: InferenceResult;
  improvement: number;
  improvement_pct: number;
  mutations_applied: string[];
  generations_completed: number;
  candidates_evaluated: number;
  runtime_ms: number;
  best_graph: GraphInput;
}

function mutateGraph(graph: GraphInput, strategy: string, strength: number): GraphInput {
  const g: GraphInput = JSON.parse(JSON.stringify(graph));
  for (const node of g.nodes) {
    const f = node.features;
    if (strategy === "thickness" && f.length >= 12) {
      // Reduce curvature extremes (indices 7-10)
      const blend = 0.3 + strength * 0.5;
      if (Math.abs(f[10] ?? 0) > 0.1) {
        f[7] = (f[7] ?? 0) * (1 - blend);
        f[8] = (f[8] ?? 0) * (1 - blend);
        f[9] = (f[7] ?? 0) * (f[8] ?? 0);
        f[10] = ((f[7] ?? 0) + (f[8] ?? 0)) / 2;
        f[0] = (f[0] ?? 1) * (1 + strength * 0.05);
      }
    } else if (strategy === "simplify" && f.length >= 12) {
      if (Math.abs(f[10] ?? 0) < 0.05 * (1 + strength)) {
        const flatten = 0.5 + strength * 0.4;
        f[7] = (f[7] ?? 0) * (1 - flatten);
        f[8] = (f[8] ?? 0) * (1 - flatten);
        f[9] = (f[7] ?? 0) * (f[8] ?? 0);
        f[10] = ((f[7] ?? 0) + (f[8] ?? 0)) / 2;
        f[11] = Math.max(1, (f[11] ?? 1) * (1 - strength * 0.3));
        node.type = "planar";
      }
    }
  }
  return g;
}

function runOptimization(
  graph: GraphInput,
  material?: string,
  config?: OptConfig
): OptResult {
  const start = performance.now();
  const popSize = config?.population_size ?? 20;
  const maxGen = config?.generations ?? 6;
  const maxTime = config?.max_time_ms ?? 4500;
  const strategies = ["thickness", "simplify"];

  const g: GraphInput = { ...graph, material: material ?? graph.material };
  const originalScore = runInference(g);
  let bestGraph = g;
  let bestScore = originalScore;
  let bestFitness = originalScore.manufacturability_score;
  const allMutations: string[] = [];
  let evaluated = 1;
  let genCompleted = 0;

  for (let gen = 0; gen < maxGen; gen++) {
    if (performance.now() - start > maxTime) break;

    for (let i = 0; i < popSize; i++) {
      const strategy = strategies[Math.floor(Math.random() * strategies.length)];
      const strength = 0.2 + Math.random() * 0.7;
      const candidate = mutateGraph(bestGraph, strategy, strength);
      const score = runInference(candidate);
      evaluated++;

      if (score.manufacturability_score > bestFitness) {
        bestGraph = candidate;
        bestScore = score;
        bestFitness = score.manufacturability_score;
        allMutations.push(`${strategy}@${strength.toFixed(2)}`);
      }
    }
    genCompleted = gen + 1;
  }

  const runtime = performance.now() - start;
  const improvement = Math.round((bestFitness - originalScore.manufacturability_score) * 10) / 10;

  return {
    original_score: originalScore,
    optimized_score: bestScore,
    improvement,
    improvement_pct: Math.round((improvement / Math.max(originalScore.manufacturability_score, 1)) * 1000) / 10,
    mutations_applied: allMutations,
    generations_completed: genCompleted,
    candidates_evaluated: evaluated,
    runtime_ms: Math.round(runtime * 100) / 100,
    best_graph: bestGraph,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "predict") {
      const graph: GraphInput = body.graph;
      if (!graph?.nodes?.length) {
        return new Response(
          JSON.stringify({ error: "graph with nodes[] required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const result = runInference(graph);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "predict_batch") {
      const graphs: GraphInput[] = body.graphs;
      if (!graphs?.length) {
        return new Response(
          JSON.stringify({ error: "graphs[] required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const results = graphs.map(runInference);
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "optimize") {
      const graph = body.graph;
      if (!graph?.nodes?.length) {
        return new Response(
          JSON.stringify({ error: "graph with nodes[] required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const result = runOptimization(graph, body.material, body.config);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "health") {
      return new Response(
        JSON.stringify({ status: "healthy", model: "ManufacturabilityGAT_v2", device: "edge", optimizer: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use 'predict', 'predict_batch', 'optimize', or 'health'." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
