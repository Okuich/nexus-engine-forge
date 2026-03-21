import { supabase } from '@/integrations/supabase/client';
import type { TrainingJob } from './types';

// ─── Inference Service ──────────────────────────────────────────

export interface InferenceRequest {
  nodes: { id: string; type: string; features: number[] }[];
  edges: { source: string; target: string; type: string }[];
  material?: string;
  process?: string;
}

export interface InferenceResult {
  manufacturability_score: number;
  estimated_cost_usd: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
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

export async function runInference(graph: InferenceRequest): Promise<InferenceResult> {
  const { data, error } = await supabase.functions.invoke('ml-inference', {
    body: { action: 'predict', graph },
  });
  if (error) throw new Error(error.message);
  return data as InferenceResult;
}

export async function runBatchInference(graphs: InferenceRequest[]): Promise<{
  results: InferenceResult[];
  cache_hits: number;
}> {
  const { data, error } = await supabase.functions.invoke('ml-inference', {
    body: { action: 'predict_batch', graphs },
  });
  if (error) throw new Error(error.message);
  return data as { results: InferenceResult[]; cache_hits: number };
}

// ─── Optimization Service ───────────────────────────────────────

export interface ImprovementMetrics {
  manufacturability_delta: number;
  manufacturability_pct: number;
  cost_delta: number;
  cost_pct: number;
  risk_level_before: string;
  risk_level_after: string;
  risks_eliminated: number;
  recommendations_resolved: number;
}

export interface OptimizationConfig {
  population_size?: number;
  generations?: number;
  max_time_ms?: number;
  batch_size?: number;
  cache_enabled?: boolean;
  objectives?: ('cost' | 'manufacturability')[];
}

export interface OptimizationResult {
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
  best_graph: InferenceRequest;
}

export async function runOptimization(
  graph: InferenceRequest,
  material?: string,
  config?: OptimizationConfig
): Promise<OptimizationResult> {
  const { data, error } = await supabase.functions.invoke('ml-inference', {
    body: { action: 'optimize', graph, material, config },
  });
  if (error) throw new Error(error.message);
  return data as OptimizationResult;
}

// ─── Pipeline Service ───────────────────────────────────────────

export interface PipelineStartResult {
  pipeline_id: string;
  status: string;
  stages: string[];
}

export async function startPipeline(params: {
  file_name: string;
  material: string;
  process: string;
  node_count?: number;
}): Promise<PipelineStartResult> {
  const { data, error } = await supabase.functions.invoke('ml-orchestrate', {
    body: { action: 'run_pipeline', ...params },
  });
  if (error) throw new Error(error.message);
  return data as PipelineStartResult;
}

export async function getPipelineStatus(pipelineId: string): Promise<TrainingJob> {
  const { data, error } = await supabase.functions.invoke('ml-orchestrate', {
    body: { action: 'pipeline_status', pipeline_id: pipelineId },
  });
  if (error) throw new Error(error.message);
  return data as unknown as TrainingJob;
}

export async function listPipelines(): Promise<TrainingJob[]> {
  const { data, error } = await supabase.functions.invoke('ml-orchestrate', {
    body: { action: 'list_pipelines' },
  });
  if (error) throw new Error(error.message);
  return (data as any)?.pipelines ?? [];
}

// ─── Generate mock geometry graph from file ─────────────────────

export function generateMockGraph(fileName: string): InferenceRequest {
  const nodeCount = 20 + Math.floor(Math.random() * 40);
  const faceTypes = ['face', 'cylindrical', 'planar', 'conical', 'spherical'];
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    type: faceTypes[i % faceTypes.length],
    features: [
      Math.random() * 200,                              // area
      Math.random() * 2 - 1,                            // nx
      Math.random() * 2 - 1,                            // ny
      0.5 + Math.random() * 0.5,                        // nz
      Math.random() * 20 - 10,                          // cx
      Math.random() * 20 - 10,                          // cy
      Math.random() * 20 - 10,                          // cz
      Math.random() * 0.3,                              // curv_min
      Math.random() * 0.4,                              // curv_max
      Math.random() * 0.05,                             // curv_gaussian
      Math.random() * 0.35,                             // curv_mean
      Math.floor(Math.random() * 20) + 2,               // num_triangles
    ],
  }));

  const edges: InferenceRequest['edges'] = [];
  for (let i = 0; i < nodeCount - 1; i++) {
    edges.push({
      source: `n${i}`,
      target: `n${i + 1}`,
      type: i % 2 === 0 ? 'adjacent' : 'tangent',
    });
    if (i > 2 && Math.random() > 0.6) {
      edges.push({
        source: `n${i}`,
        target: `n${Math.floor(Math.random() * i)}`,
        type: 'concentric',
      });
    }
  }

  return { nodes, edges };
}
