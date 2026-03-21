import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ──────────────────────────────────────────────────────

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

interface OptConfig {
  population_size?: number;
  generations?: number;
  max_time_ms?: number;
  batch_size?: number;
  cache_enabled?: boolean;
  objectives?: ("cost" | "manufacturability")[];
}

interface ImprovementMetrics {
  manufacturability_delta: number;
  manufacturability_pct: number;
  cost_delta: number;
  cost_pct: number;
  risk_level_before: string;
  risk_level_after: string;
  risks_eliminated: number;
  recommendations_resolved: number;
}

interface OptResult {
  original_score: InferenceResult;
  optimized_score: InferenceResult;
  improvement: number;
  improvement_pct: number;
  improvement_metrics: ImprovementMetrics;
  mutations_applied: string[];
  generations_completed: number;
  candidates_evaluated: number;
  cache_hits: number;
  cache_hit_rate: number;
  runtime_ms: number;
  best_graph: GraphInput;
}

// ─── LRU Inference Cache ────────────────────────────────────────

class InferenceCache {
  private cache = new Map<string, InferenceResult>();
  private order: string[] = [];
  private maxSize: number;
  hits = 0;
  misses = 0;

  constructor(maxSize = 512) {
    this.maxSize = maxSize;
  }

  private hash(graph: GraphInput): string {
    // Fast hash: combine node feature sums + structure fingerprint
    let h = graph.nodes.length * 7919;
    for (const n of graph.nodes) {
      for (let i = 0; i < n.features.length; i++) {
        // Quantize to reduce near-duplicate misses
        h = ((h * 31) + Math.round((n.features[i] ?? 0) * 1000)) | 0;
      }
    }
    h = ((h * 31) + graph.edges.length) | 0;
    h = ((h * 31) + (graph.material?.charCodeAt(0) ?? 0)) | 0;
    return h.toString(36);
  }

  get(graph: GraphInput): InferenceResult | null {
    const key = this.hash(graph);
    const val = this.cache.get(key);
    if (val) {
      this.hits++;
      // Move to end (MRU)
      const idx = this.order.indexOf(key);
      if (idx > -1) {
        this.order.splice(idx, 1);
        this.order.push(key);
      }
      return val;
    }
    this.misses++;
    return null;
  }

  set(graph: GraphInput, result: InferenceResult): void {
    const key = this.hash(graph);
    if (this.cache.has(key)) return;
    if (this.order.length >= this.maxSize) {
      const evict = this.order.shift()!;
      this.cache.delete(evict);
    }
    this.cache.set(key, result);
    this.order.push(key);
  }

  get hitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? Math.round((this.hits / total) * 1000) / 10 : 0;
  }
}

// ─── ML Model (Simulated GNN) ───────────────────────────────────

function runMLModel(graph: GraphInput): InferenceResult {
  const start = performance.now();
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const faceCount = graph.nodes.filter((n) => n.type === "face").length;

  // Feature-based scoring using actual node features
  let featureScore = 0;
  let totalArea = 0;
  let thinWalls = 0;
  let deepHoles = 0;
  let undercuts = 0;
  let highCurvNodes = 0;
  const riskRegions: InferenceResult["risk_regions"] = [];

  for (const node of graph.nodes) {
    const f = node.features;
    if (f.length >= 12) {
      const area = f[0] ?? 0;
      const curvMean = Math.abs(f[10] ?? 0);
      const curvGauss = Math.abs(f[9] ?? 0);
      const nz = Math.abs(f[3] ?? 0);

      totalArea += area;

      // Thin wall detection: high mean curvature
      if (curvMean > 0.3) {
        thinWalls++;
        riskRegions.push({
          node_id: node.id,
          severity: "high",
          description: `Thin wall: curvature ${curvMean.toFixed(3)} exceeds threshold`,
        });
      }

      // Deep hole detection: cylindrical with high curvature
      if ((node.type === "cylindrical" || node.type === "conical") && curvMean > 0.15) {
        deepHoles++;
        if (riskRegions.length < 8) {
          riskRegions.push({
            node_id: node.id,
            severity: "medium",
            description: `Deep hole: L/D ratio likely exceeds recommended limit`,
          });
        }
      }

      // Draft angle: near-vertical faces
      if (nz > 0.95 && nz < 1.0) {
        undercuts++;
      }

      // Per-node score contribution
      const nodeScore = 100 - curvMean * 80 - curvGauss * 40;
      featureScore += Math.max(0, Math.min(100, nodeScore));

      // Bonus for high curvature being well-handled
      if (curvMean < 0.05) highCurvNodes++;
    } else {
      featureScore += 70; // default for sparse features
    }
  }

  const avgNodeScore = nodeCount > 0 ? featureScore / nodeCount : 50;

  // Structural complexity penalty
  const complexity = Math.min(1, (nodeCount * 0.01 + edgeCount * 0.005));
  const complexityPenalty = complexity * 15;

  // Risk penalties
  const thinWallPenalty = thinWalls * 4;
  const holePenalty = deepHoles * 3;
  const undercutPenalty = undercuts * 2;

  // Planar face bonus (simpler = cheaper to manufacture)
  const planarCount = graph.nodes.filter(n =>
    n.type === "planar" || n.type === "face"
  ).length;
  const planarBonus = (planarCount / Math.max(nodeCount, 1)) * 10;

  const score = Math.max(20, Math.min(98,
    avgNodeScore - complexityPenalty - thinWallPenalty - holePenalty - undercutPenalty + planarBonus
  ));

  // Cost model: uses actual geometry features
  const materialMultiplier = graph.material === "Ti-6Al-4V" ? 3.2
    : graph.material === "Inconel 718" ? 4.1
    : graph.material === "Al 7075-T6" ? 1.0
    : 1.5;

  const baseCost = 150 + totalArea * 0.5 + faceCount * 20 + edgeCount * 5 + deepHoles * 40 + thinWalls * 30;
  const cost = Math.round(baseCost * materialMultiplier);

  const riskLevel = score >= 85 ? "low" : score >= 70 ? "medium" : score >= 50 ? "high" : "critical";

  const recommendations: string[] = [];
  if (thinWalls > 0) recommendations.push(`Increase wall thickness in ${thinWalls} flagged region(s) to ≥1.5mm`);
  if (deepHoles > 0) recommendations.push(`Consider step drilling for ${deepHoles} deep hole(s) with L/D > 6`);
  if (undercuts > 0) recommendations.push(`Add draft angles ≥3° to ${undercuts} undercut face(s)`);
  if (complexity > 0.5) recommendations.push("Simplify B-spline surfaces to reduce machining time");
  if (recommendations.length === 0) recommendations.push("Part is well-optimized for manufacturing");

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
    latency_ms: Math.round((performance.now() - start) * 100) / 100,
  };
}

// ─── Batched Inference ──────────────────────────────────────────

function batchInference(
  graphs: GraphInput[],
  cache: InferenceCache
): InferenceResult[] {
  const results: (InferenceResult | null)[] = new Array(graphs.length).fill(null);
  const uncachedIndices: number[] = [];

  // Phase 1: check cache
  for (let i = 0; i < graphs.length; i++) {
    const cached = cache.get(graphs[i]);
    if (cached) {
      results[i] = cached;
    } else {
      uncachedIndices.push(i);
    }
  }

  // Phase 2: batch evaluate uncached
  for (const idx of uncachedIndices) {
    const result = runMLModel(graphs[idx]);
    cache.set(graphs[idx], result);
    results[idx] = result;
  }

  return results as InferenceResult[];
}

// ─── Mutation Strategies ────────────────────────────────────────

const STRATEGIES = ["thickness", "simplify", "hole_reduce", "draft_correct"] as const;
type Strategy = typeof STRATEGIES[number];

function mutateGraph(graph: GraphInput, strategy: Strategy, strength: number): GraphInput {
  const g: GraphInput = JSON.parse(JSON.stringify(graph));
  const blend = 0.3 + strength * 0.5;

  for (const node of g.nodes) {
    const f = node.features;
    if (f.length < 12) continue;

    switch (strategy) {
      case "thickness":
        if (Math.abs(f[10] ?? 0) > 0.1) {
          f[7] = (f[7] ?? 0) * (1 - blend);
          f[8] = (f[8] ?? 0) * (1 - blend);
          f[9] = (f[7] ?? 0) * (f[8] ?? 0);
          f[10] = ((f[7] ?? 0) + (f[8] ?? 0)) / 2;
          f[0] = (f[0] ?? 1) * (1 + strength * 0.05);
        }
        break;

      case "simplify":
        if (Math.abs(f[10] ?? 0) < 0.05 * (1 + strength)) {
          const flatten = 0.5 + strength * 0.4;
          f[7] = (f[7] ?? 0) * (1 - flatten);
          f[8] = (f[8] ?? 0) * (1 - flatten);
          f[9] = (f[7] ?? 0) * (f[8] ?? 0);
          f[10] = ((f[7] ?? 0) + (f[8] ?? 0)) / 2;
          f[11] = Math.max(1, (f[11] ?? 1) * (1 - strength * 0.3));
          node.type = "planar";
        }
        break;

      case "hole_reduce":
        if (node.type === "cylindrical" || node.type === "conical") {
          const reduction = 0.2 + strength * 0.4;
          f[7] = (f[7] ?? 0) * (1 - reduction);
          f[8] = (f[8] ?? 0) * (1 - reduction);
          f[9] = (f[7] ?? 0) * (f[8] ?? 0);
          f[10] = ((f[7] ?? 0) + (f[8] ?? 0)) / 2;
          f[0] = (f[0] ?? 1) * (1 - strength * 0.08);
        }
        break;

      case "draft_correct": {
        const nz = f[3] ?? 0;
        const angleFromZ = Math.acos(Math.max(-1, Math.min(1, Math.abs(nz))));
        const minDraft = (3 + strength * 5) * Math.PI / 180;
        const deficit = (Math.PI / 2 - minDraft) - angleFromZ;
        if (deficit > 0 && deficit < minDraft * 2) {
          const tilt = deficit * (0.3 + strength * 0.5);
          f[3] = nz + (nz >= 0 ? tilt : -tilt);
          const mag = Math.sqrt((f[1] ?? 0) ** 2 + (f[2] ?? 0) ** 2 + (f[3] ?? 0) ** 2) + 1e-12;
          f[1] = (f[1] ?? 0) / mag;
          f[2] = (f[2] ?? 0) / mag;
          f[3] = (f[3] ?? 0) / mag;
        }
        break;
      }
    }
  }
  return g;
}

// ─── Multi-Objective Fitness ────────────────────────────────────

function computeFitness(
  result: InferenceResult,
  originalResult: InferenceResult,
  objectives: ("cost" | "manufacturability")[]
): number {
  let fitness = 0;
  const weights = {
    manufacturability: objectives.includes("cost") ? 0.5 : 0.8,
    cost: objectives.includes("manufacturability") ? 0.5 : 0.8,
  };

  if (objectives.includes("manufacturability")) {
    fitness += result.manufacturability_score * weights.manufacturability;
  }

  if (objectives.includes("cost")) {
    // Normalize cost improvement as a 0-100 score (lower cost = higher fitness)
    const costRatio = originalResult.estimated_cost_usd > 0
      ? result.estimated_cost_usd / originalResult.estimated_cost_usd
      : 1;
    const costScore = Math.max(0, Math.min(100, (2 - costRatio) * 50));
    fitness += costScore * weights.cost;
  }

  // Bonus for reducing risk level
  const riskOrder = { low: 3, medium: 2, high: 1, critical: 0 };
  const riskImprovement = (riskOrder[result.risk_level] ?? 0) - (riskOrder[originalResult.risk_level] ?? 0);
  fitness += Math.max(0, riskImprovement) * 5;

  return fitness;
}

// ─── GA Optimization with ML Scoring ────────────────────────────

function runOptimization(
  graph: GraphInput,
  material?: string,
  config?: OptConfig
): OptResult {
  const start = performance.now();
  const popSize = config?.population_size ?? 20;
  const maxGen = config?.generations ?? 8;
  const maxTime = config?.max_time_ms ?? 4500;
  const batchSize = config?.batch_size ?? popSize;
  const cacheEnabled = config?.cache_enabled !== false;
  const objectives = config?.objectives ?? ["cost", "manufacturability"];

  const cache = new InferenceCache(cacheEnabled ? 512 : 0);

  const g: GraphInput = { ...graph, material: material ?? graph.material };

  // Score original with ML model
  const originalScore = runMLModel(g);
  cache.set(g, originalScore);

  // Population: generate mutant candidates
  interface Individual {
    graph: GraphInput;
    score: InferenceResult;
    fitness: number;
    mutations: string[];
  }

  // Initialize population
  const population: Individual[] = [{
    graph: g,
    score: originalScore,
    fitness: computeFitness(originalScore, originalScore, objectives),
    mutations: ["original"],
  }];

  // Generate initial variants
  const initGraphs: GraphInput[] = [];
  const initMutations: string[][] = [];
  for (let i = 0; i < popSize - 1; i++) {
    const strategy = STRATEGIES[Math.floor(Math.random() * STRATEGIES.length)];
    const strength = 0.15 + Math.random() * 0.75;
    initGraphs.push(mutateGraph(g, strategy, strength));
    initMutations.push([`${strategy}@${strength.toFixed(2)}`]);
  }

  // Batch score initial population
  const initScores = batchInference(initGraphs, cache);
  for (let i = 0; i < initGraphs.length; i++) {
    population.push({
      graph: initGraphs[i],
      score: initScores[i],
      fitness: computeFitness(initScores[i], originalScore, objectives),
      mutations: initMutations[i],
    });
  }

  let evaluated = population.length;
  let genCompleted = 0;
  const eliteCount = Math.max(2, Math.floor(popSize * 0.15));

  // Evolution loop
  for (let gen = 0; gen < maxGen; gen++) {
    if (performance.now() - start > maxTime) break;

    // Sort by fitness
    population.sort((a, b) => b.fitness - a.fitness);

    // Elitism
    const elites = population.slice(0, eliteCount);

    // Tournament selection + mutation → offspring batch
    const offspringGraphs: GraphInput[] = [];
    const offspringMutations: string[][] = [];

    for (let i = 0; i < popSize - eliteCount; i++) {
      // Tournament select parent
      const tournamentSize = Math.min(4, population.length);
      let best = population[Math.floor(Math.random() * population.length)];
      for (let t = 1; t < tournamentSize; t++) {
        const contender = population[Math.floor(Math.random() * population.length)];
        if (contender.fitness > best.fitness) best = contender;
      }

      // Crossover (50% chance if we have 2 parents)
      let childGraph: GraphInput;
      let childMutations = [...best.mutations];

      if (Math.random() < 0.4) {
        let parent2 = population[Math.floor(Math.random() * population.length)];
        for (let t = 0; t < 2; t++) {
          const c = population[Math.floor(Math.random() * population.length)];
          if (c.fitness > parent2.fitness) parent2 = c;
        }
        childGraph = crossover(best.graph, parent2.graph);
        childMutations.push("crossover");
      } else {
        childGraph = JSON.parse(JSON.stringify(best.graph));
      }

      // Mutation
      if (Math.random() < 0.75) {
        const strategy = STRATEGIES[Math.floor(Math.random() * STRATEGIES.length)];
        const strength = 0.15 + Math.random() * 0.75;
        childGraph = mutateGraph(childGraph, strategy, strength);
        childMutations.push(`${strategy}@${strength.toFixed(2)}`);
      }

      offspringGraphs.push(childGraph);
      offspringMutations.push(childMutations);
    }

    // Batch score all offspring at once
    const offspringScores = batchInference(offspringGraphs, cache);
    evaluated += offspringGraphs.length;

    // Build next generation
    population.length = 0;
    population.push(...elites);

    for (let i = 0; i < offspringGraphs.length; i++) {
      population.push({
        graph: offspringGraphs[i],
        score: offspringScores[i],
        fitness: computeFitness(offspringScores[i], originalScore, objectives),
        mutations: offspringMutations[i],
      });
    }

    genCompleted = gen + 1;
  }

  // Find best
  population.sort((a, b) => b.fitness - a.fitness);
  const best = population[0];
  const runtime = performance.now() - start;

  // Compute improvement metrics
  const mfgDelta = Math.round((best.score.manufacturability_score - originalScore.manufacturability_score) * 10) / 10;
  const costDelta = originalScore.estimated_cost_usd - best.score.estimated_cost_usd;

  const riskLevels = ["critical", "high", "medium", "low"];
  const risksEliminated = Math.max(0,
    originalScore.risk_regions.length - best.score.risk_regions.length
  );
  const recsResolved = Math.max(0,
    originalScore.recommendations.length - best.score.recommendations.length
  );

  const improvementMetrics: ImprovementMetrics = {
    manufacturability_delta: mfgDelta,
    manufacturability_pct: Math.round((mfgDelta / Math.max(originalScore.manufacturability_score, 1)) * 1000) / 10,
    cost_delta: costDelta,
    cost_pct: originalScore.estimated_cost_usd > 0
      ? Math.round((costDelta / originalScore.estimated_cost_usd) * 1000) / 10
      : 0,
    risk_level_before: originalScore.risk_level,
    risk_level_after: best.score.risk_level,
    risks_eliminated: risksEliminated,
    recommendations_resolved: recsResolved,
  };

  return {
    original_score: originalScore,
    optimized_score: best.score,
    improvement: mfgDelta,
    improvement_pct: improvementMetrics.manufacturability_pct,
    improvement_metrics: improvementMetrics,
    mutations_applied: best.mutations.filter(m => m !== "original"),
    generations_completed: genCompleted,
    candidates_evaluated: evaluated,
    cache_hits: cache.hits,
    cache_hit_rate: cache.hitRate,
    runtime_ms: Math.round(runtime * 100) / 100,
    best_graph: best.graph,
  };
}

function crossover(g1: GraphInput, g2: GraphInput): GraphInput {
  const child: GraphInput = JSON.parse(JSON.stringify(g1));
  const len = Math.min(g1.nodes.length, g2.nodes.length);
  for (let i = 0; i < len; i++) {
    if (Math.random() < 0.5) {
      child.nodes[i] = JSON.parse(JSON.stringify(g2.nodes[i]));
    }
  }
  return child;
}

// ─── HTTP Handler ───────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    if (action === "predict") {
      const graph: GraphInput = body.graph;
      if (!graph?.nodes?.length) return json({ error: "graph with nodes[] required" }, 400);
      return json(runMLModel(graph));
    }

    if (action === "predict_batch") {
      const graphs: GraphInput[] = body.graphs;
      if (!graphs?.length) return json({ error: "graphs[] required" }, 400);
      const cache = new InferenceCache(256);
      return json({ results: batchInference(graphs, cache), cache_hits: cache.hits });
    }

    if (action === "optimize") {
      const graph = body.graph;
      if (!graph?.nodes?.length) return json({ error: "graph with nodes[] required" }, 400);
      return json(runOptimization(graph, body.material, body.config));
    }

    if (action === "health") {
      return json({
        status: "healthy",
        model: "ManufacturabilityGAT_v2",
        device: "edge",
        capabilities: ["predict", "predict_batch", "optimize"],
        optimization: {
          strategies: [...STRATEGIES],
          objectives: ["cost", "manufacturability"],
          cache: true,
        },
      });
    }

    return json({ error: "Invalid action. Use 'predict', 'predict_batch', 'optimize', or 'health'." }, 400);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
