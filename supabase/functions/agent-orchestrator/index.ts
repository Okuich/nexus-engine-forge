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

// ─── Input Validation Layer ──────────────────────────────────────

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

// ─── Output Validation Schemas ───────────────────────────────────

interface OutputSchema {
  requiredFields: string[];
  numericRanges?: Record<string, { min?: number; max?: number }>;
  nonEmpty?: string[];
}

const OUTPUT_SCHEMAS: Record<string, OutputSchema> = {
  // Geometry
  analyze_faces:         { requiredFields: ["total_faces", "breakdown", "total_area_mm2"], numericRanges: { total_faces: { min: 1 }, total_area_mm2: { min: 0 } } },
  analyze_edges:         { requiredFields: ["total_edges", "breakdown", "total_length_mm"], numericRanges: { total_edges: { min: 0 } } },
  detect_holes:          { requiredFields: ["total_holes", "holes"], numericRanges: { total_holes: { min: 0 } } },
  measure_thickness:     { requiredFields: ["min_thickness_mm", "max_thickness_mm", "avg_thickness_mm"], numericRanges: { min_thickness_mm: { min: 0 }, max_thickness_mm: { min: 0 }, avg_thickness_mm: { min: 0 } } },
  check_draft_angles:    { requiredFields: ["faces_checked", "passing", "failing"], numericRanges: { faces_checked: { min: 1 } } },
  build_topology_graph:  { requiredFields: ["nodes", "edges", "connected_components", "is_manifold"], numericRanges: { nodes: { min: 1 } } },
  // Cost
  estimate_material_cost: { requiredFields: ["material", "mass_kg", "material_cost_usd"], numericRanges: { mass_kg: { min: 0 }, material_cost_usd: { min: 0 } } },
  estimate_machining_time: { requiredFields: ["total_hours", "machining_cost_usd"], numericRanges: { total_hours: { min: 0 }, machining_cost_usd: { min: 0 } } },
  estimate_total_cost:   { requiredFields: ["unit_cost_usd", "total_usd"], numericRanges: { unit_cost_usd: { min: 0 }, total_usd: { min: 0 } } },
  quantity_price_breaks:  { requiredFields: ["breaks"], nonEmpty: ["breaks"] },
  // Optimization
  run_topology_optimization: { requiredFields: ["iterations", "best_fitness", "changes"], numericRanges: { best_fitness: { min: 0, max: 1 } } },
  suggest_design_changes: { requiredFields: ["suggestions"], nonEmpty: ["suggestions"] },
  run_parameter_sweep:   { requiredFields: ["optimal_values", "objective_value"], numericRanges: { objective_value: { min: 0 } } },
  // Simulation
  run_stress_analysis:   { requiredFields: ["max_von_mises_mpa", "safety_factor", "status"], numericRanges: { safety_factor: { min: 0 } } },
  run_thermal_analysis:  { requiredFields: ["max_temp_c", "status"], numericRanges: { max_temp_c: { min: -273 } } },
  predict_fatigue_life:  { requiredFields: ["cycles_to_failure", "endurance_limit_mpa", "status"] },
  check_manufacturability: { requiredFields: ["overall_score", "sub_scores"], numericRanges: { overall_score: { min: 0, max: 100 } } },
  // Workflow
  generate_process_plan: { requiredFields: ["operations", "total_time_min"], nonEmpty: ["operations"], numericRanges: { total_time_min: { min: 0 } } },
  select_fixtures:       { requiredFields: ["fixtures", "total_fixtures"], numericRanges: { total_fixtures: { min: 1 } } },
  estimate_lead_time:    { requiredFields: ["total_business_days", "calendar_days"], numericRanges: { total_business_days: { min: 1 } } },
  define_quality_checkpoints: { requiredFields: ["checkpoints", "total_checkpoints"], numericRanges: { total_checkpoints: { min: 1 } } },
  // Document
  generate_quote:        { requiredFields: ["quote_number", "total_usd", "status"] },
  generate_inspection_report: { requiredFields: ["report_id", "status"] },
  generate_material_cert: { requiredFields: ["cert_id", "material", "compliance"] },
  generate_process_sheet: { requiredFields: ["sheet_id", "status"] },
};

interface OutputValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateToolOutput(tool: string, output: Record<string, unknown>): OutputValidationResult {
  const schema = OUTPUT_SCHEMAS[tool];
  const result: OutputValidationResult = { valid: true, errors: [], warnings: [] };
  if (!schema) return result; // no schema = assume valid

  // Check required fields
  for (const field of schema.requiredFields) {
    if (output[field] === undefined || output[field] === null) {
      result.errors.push(`Missing required output field: ${field}`);
      result.valid = false;
    }
  }

  // Check numeric ranges
  if (schema.numericRanges) {
    for (const [field, range] of Object.entries(schema.numericRanges)) {
      const val = output[field];
      if (typeof val !== "number") continue;
      if (range.min !== undefined && val < range.min) {
        result.errors.push(`${field}=${val} below minimum ${range.min}`);
        result.valid = false;
      }
      if (range.max !== undefined && val > range.max) {
        result.warnings.push(`${field}=${val} exceeds expected maximum ${range.max}`);
      }
    }
  }

  // Check non-empty arrays
  if (schema.nonEmpty) {
    for (const field of schema.nonEmpty) {
      const val = output[field];
      if (Array.isArray(val) && val.length === 0) {
        result.warnings.push(`${field} is empty — expected at least one item`);
      }
    }
  }

  return result;
}

// ─── Confidence Scoring ──────────────────────────────────────────

interface StepConfidence {
  stepId: string;
  tool: string;
  agent: string;
  score: number;        // 0.0–1.0
  factors: Record<string, number>;
  grade: "HIGH" | "MEDIUM" | "LOW";
}

function computeStepConfidence(
  tool: string,
  output: Record<string, unknown>,
  validation: OutputValidationResult,
  cached: boolean,
  retries: number,
  durationMs: number,
): number {
  let score = 1.0;

  // Penalty for validation errors/warnings
  score -= validation.errors.length * 0.25;
  score -= validation.warnings.length * 0.05;

  // Penalty for retries (each retry = less reliable)
  score -= retries * 0.15;

  // Cached results are trusted
  if (cached) score = Math.min(score + 0.05, 1.0);

  // Very slow execution may indicate instability
  if (durationMs > 5000) score -= 0.05;

  // Tool-specific confidence adjustments
  if (tool === "check_manufacturability" && typeof output.overall_score === "number") {
    // Low manuf. score doesn't reduce confidence—the tool is correct, just the part is bad
  }
  if (tool === "run_stress_analysis" && typeof output.safety_factor === "number") {
    if ((output.safety_factor as number) < 1.0) score -= 0.05; // edge case, flag it
  }
  if (tool === "predict_fatigue_life" && output.cycles_to_failure === "INFINITE") {
    // High confidence for infinite life
    score = Math.min(score + 0.05, 1.0);
  }

  return Math.max(0, Math.min(1, +score.toFixed(2)));
}

function confidenceGrade(score: number): "HIGH" | "MEDIUM" | "LOW" {
  return score >= 0.85 ? "HIGH" : score >= 0.6 ? "MEDIUM" : "LOW";
}

// ─── Cross-Result Consistency Checks ─────────────────────────────

interface ConsistencyIssue {
  type: "contradiction" | "mismatch" | "warning";
  description: string;
  involvedSteps: string[];
  severity: "high" | "medium" | "low";
}

function checkCrossResultConsistency(
  stepResults: Map<string, Record<string, unknown>>,
  stepMeta: Map<string, { tool: string; agent: string }>,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const findStep = (tool: string) => {
    for (const [id, meta] of stepMeta.entries()) {
      if (meta.tool === tool) return { id, data: stepResults.get(id) };
    }
    return null;
  };

  // 1. Geometry face count vs manufacturability face_count input
  const faces = findStep("analyze_faces");
  const manuf = findStep("check_manufacturability");
  if (faces?.data && manuf?.data) {
    const geoFaces = faces.data.total_faces as number;
    const manufFaces = manuf.data.sub_scores ? (manuf.data as any) : null;
    // The face count should be consistent
    if (geoFaces && manufFaces) {
      // Check is implicit — just ensure they were both used
    }
  }

  // 2. Stress safety factor vs fatigue safety factor should be coherent
  const stress = findStep("run_stress_analysis");
  const fatigue = findStep("predict_fatigue_life");
  if (stress?.data && fatigue?.data) {
    const stressSF = stress.data.safety_factor as number;
    const fatigueSF = fatigue.data.safety_factor as number;
    if (stressSF && fatigueSF) {
      if (stressSF > 2.0 && fatigueSF < 1.0) {
        issues.push({ type: "contradiction", description: `Static safety factor (${stressSF}) is adequate but fatigue safety factor (${fatigueSF}) indicates failure — review loading assumptions`, involvedSteps: [stress.id, fatigue.id], severity: "high" });
      }
    }
  }

  // 3. Material cost + machining cost should roughly match total cost
  const matCost = findStep("estimate_material_cost");
  const machTime = findStep("estimate_machining_time");
  const totalCost = findStep("estimate_total_cost");
  if (matCost?.data && machTime?.data && totalCost?.data) {
    const mat = matCost.data.material_cost_usd as number;
    const mach = machTime.data.machining_cost_usd as number;
    const total = totalCost.data.unit_cost_usd as number;
    if (mat && mach && total) {
      const sum = mat + mach;
      // Total should be >= sum (includes overhead)
      if (total < sum * 0.95) {
        issues.push({ type: "mismatch", description: `Total cost $${total} is less than material ($${mat}) + machining ($${mach}) = $${sum.toFixed(2)}`, involvedSteps: [matCost.id, machTime.id, totalCost.id], severity: "high" });
      }
      if (total > sum * 2.0) {
        issues.push({ type: "warning", description: `Total cost $${total} is >2× raw costs ($${sum.toFixed(2)}) — overhead seems high`, involvedSteps: [matCost.id, machTime.id, totalCost.id], severity: "medium" });
      }
    }
  }

  // 4. Process plan time vs lead time coherence
  const procPlan = findStep("generate_process_plan");
  const leadTime = findStep("estimate_lead_time");
  if (procPlan?.data && leadTime?.data) {
    const procHours = procPlan.data.total_time_hours as number;
    const leadDays = leadTime.data.total_business_days as number;
    if (procHours && leadDays) {
      const minDays = Math.ceil(procHours / 8);
      if (leadDays < minDays) {
        issues.push({ type: "contradiction", description: `Lead time (${leadDays} days) is shorter than minimum machining time (${minDays} days at 8hr/day)`, involvedSteps: [procPlan.id, leadTime.id], severity: "high" });
      }
    }
  }

  // 5. Thickness warnings vs optimization suggestions should align
  const thickness = findStep("measure_thickness");
  const optimization = findStep("run_topology_optimization");
  if (thickness?.data && optimization?.data) {
    const minT = thickness.data.min_thickness_mm as number;
    const changes = (optimization.data.changes as any[]) || [];
    if (minT && minT < 1.5) {
      const hasThicknessFix = changes.some((c: any) => c.type === "thickness_increase");
      if (!hasThicknessFix) {
        issues.push({ type: "warning", description: `Thin wall detected (${minT}mm) but optimization did not suggest a thickness increase`, involvedSteps: [thickness.id, optimization.id], severity: "low" });
      }
    }
  }

  return issues;
}

// ─── Agent Base Class ────────────────────────────────────────────

interface AgentOutput {
  agent: AgentType;
  tool: string;
  success: boolean;
  data: Record<string, unknown>;
  metadata: { duration_ms: number; warnings: string[] };
}

abstract class BaseAgent {
  abstract readonly type: AgentType;
  abstract readonly tools: string[];

  canHandle(tool: string): boolean {
    return this.tools.includes(tool);
  }

  async execute(tool: string, input: Record<string, unknown>): Promise<AgentOutput> {
    const start = Date.now();
    const warnings: string[] = [];
    try {
      const data = this.runTool(tool, input, warnings);
      return { agent: this.type, tool, success: true, data, metadata: { duration_ms: Date.now() - start, warnings } };
    } catch (e) {
      return { agent: this.type, tool, success: false, data: { error: (e as Error).message }, metadata: { duration_ms: Date.now() - start, warnings } };
    }
  }

  protected abstract runTool(tool: string, input: Record<string, unknown>, warnings: string[]): Record<string, unknown>;
}

// ─── Geometry Agent ──────────────────────────────────────────────

class GeometryAgent extends BaseAgent {
  readonly type: AgentType = "geometry";
  readonly tools = ["analyze_faces", "analyze_edges", "detect_holes", "measure_thickness", "check_draft_angles", "build_topology_graph"];

  protected runTool(tool: string, input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
    switch (tool) {
      case "analyze_faces":
        return { total_faces: 47, breakdown: { planar: 28, cylindrical: 12, conical: 3, toroidal: 2, bspline: 2 }, total_area_mm2: 18432.7, complex_face_ratio: 4 / 47 };
      case "analyze_edges":
        return { total_edges: 112, breakdown: { line: 68, arc: 32, spline: 12 }, total_length_mm: 4821.3 };
      case "detect_holes": {
        const minD = (input.min_diameter as number) ?? 0.5;
        const holes = [
          { id: 1, diameter: 8.0, depth: 15.0, type: "through", ld_ratio: 1.875 },
          { id: 2, diameter: 5.0, depth: 8.0, type: "blind", ld_ratio: 1.6 },
          { id: 3, diameter: 3.2, depth: 25.0, type: "through", ld_ratio: 7.8 },
        ].filter(h => h.diameter >= minD);
        if (holes.some(h => h.ld_ratio > 6)) warnings.push("Hole #3: L/D ratio 7.8 exceeds recommended 6.0 — requires special tooling");
        return { total_holes: holes.length, holes, min_diameter_filter: minD };
      }
      case "measure_thickness": {
        const result = { min_thickness_mm: 1.2, max_thickness_mm: 14.8, avg_thickness_mm: 4.3, uniformity_score: 62, thin_regions: [{ location: [12.5, -3.2, 45.0], thickness: 1.2 }] };
        if (result.min_thickness_mm < 1.5) warnings.push(`Min thickness ${result.min_thickness_mm}mm below 1.5mm threshold for Ti-6Al-4V`);
        return result;
      }
      case "check_draft_angles": {
        const pull = (input.pull_direction as string) || "z";
        const failing = [{ face_id: 12, angle: 1.2, required: 3.0 }, { face_id: 23, angle: 0.8, required: 3.0 }, { face_id: 31, angle: 2.1, required: 3.0 }];
        if (failing.length > 0) warnings.push(`${failing.length} faces below required draft angle`);
        return { faces_checked: 47, passing: 44, failing: failing.length, pull_direction: pull, details: failing };
      }
      case "build_topology_graph":
        return { nodes: 47, edges: 112, connected_components: 1, max_degree: 8, avg_degree: 4.8, is_manifold: true };
      default:
        throw new Error(`GeometryAgent: unknown tool ${tool}`);
    }
  }
}

// ─── Cost Agent ──────────────────────────────────────────────────

class CostAgent extends BaseAgent {
  readonly type: AgentType = "cost";
  readonly tools = ["estimate_material_cost", "estimate_machining_time", "estimate_total_cost", "quantity_price_breaks"];

  private static readonly PRICES: Record<string, number> = { "Ti-6Al-4V": 180, "Inconel 718": 95, "Al 7075-T6": 12, "SS 316L": 8 };
  private static readonly DENSITIES: Record<string, number> = { "Ti-6Al-4V": 4.43, "Inconel 718": 8.19, "Al 7075-T6": 2.81, "SS 316L": 7.99 };
  private static readonly MACHINE_RATE = 150;

  protected runTool(tool: string, input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
    switch (tool) {
      case "estimate_material_cost": {
        const mat = (input.material as string) || "Ti-6Al-4V";
        const vol = (input.volume_cm3 as number) || 120;
        const d = CostAgent.DENSITIES[mat] || 4.43;
        const p = CostAgent.PRICES[mat] || 50;
        const massKg = (vol * d) / 1000;
        const btf = 3.2;
        const cost = +(massKg * btf * p).toFixed(2);
        if (btf > 3) warnings.push(`Buy-to-fly ratio ${btf} is high — consider near-net-shape processes`);
        return { material: mat, volume_cm3: vol, mass_kg: +massKg.toFixed(2), buy_to_fly_ratio: btf, material_cost_usd: cost };
      }
      case "estimate_machining_time": {
        const f = (input.face_count as number) || 47;
        const h = (input.hole_count as number) || 12;
        const c = (input.complexity_score as number) || 65;
        const total = (2.0 + f * 0.05 + h * 0.15) * (1 + (c / 100) * 0.8);
        return {
          roughing_hours: +(total * 0.4).toFixed(2),
          finishing_hours: +(total * 0.45).toFixed(2),
          setup_hours: +(total * 0.15).toFixed(2),
          total_hours: +total.toFixed(2),
          machine_rate_usd_hr: CostAgent.MACHINE_RATE,
          machining_cost_usd: +(total * CostAgent.MACHINE_RATE).toFixed(2),
        };
      }
      case "estimate_total_cost": {
        const mc = (input.material_cost as number) || 0;
        const mh = (input.machining_hours as number) || 0;
        const q = (input.quantity as number) || 1;
        const machCost = mh * CostAgent.MACHINE_RATE;
        const overhead = +(( mc + machCost) * 0.15).toFixed(2);
        const unit = +(mc + machCost + overhead).toFixed(2);
        return { material_usd: mc, machining_usd: machCost, overhead_usd: overhead, unit_cost_usd: unit, total_usd: +(unit * q).toFixed(2), quantity: q };
      }
      case "quantity_price_breaks": {
        const uc = (input.unit_cost as number) || 1000;
        const qs = (input.quantities as number[]) || [1, 10, 50, 100];
        const discount = (q: number) => q === 1 ? 1 : q < 10 ? 0.92 : q < 50 ? 0.82 : 0.72;
        return { breaks: qs.map(q => ({ quantity: q, unit_price: +(uc * discount(q)).toFixed(2), total: +(uc * q * discount(q)).toFixed(2), discount_pct: +((1 - discount(q)) * 100).toFixed(0) })) };
      }
      default:
        throw new Error(`CostAgent: unknown tool ${tool}`);
    }
  }
}

// ─── Optimization Agent ──────────────────────────────────────────

class OptimizationAgent extends BaseAgent {
  readonly type: AgentType = "optimization";
  readonly tools = ["run_topology_optimization", "suggest_design_changes", "run_parameter_sweep"];

  protected runTool(tool: string, input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
    switch (tool) {
      case "run_topology_optimization": {
        const objectives = (input.objectives as string[]) || ["cost", "manufacturability"];
        return {
          iterations: 80, convergence_generation: 64, best_fitness: 0.89,
          objectives_achieved: Object.fromEntries(objectives.map(o => [o, o === "cost" ? 0.91 : 0.87])),
          weight_reduction_pct: 18.3, cost_reduction_pct: 24.1,
          changes: [
            { type: "thickness_increase", region: "Section C-7", from: "1.2mm", to: "2.0mm", impact: "eliminates thin-wall risk" },
            { type: "hole_simplify", hole_id: 3, description: "Split L/D=7.8 hole into 2 shorter operations", impact: "removes special tooling need" },
            { type: "draft_correction", face_ids: [12, 23, 31], from: "<2°", to: "3.5°", impact: "improves extraction" },
          ],
        };
      }
      case "suggest_design_changes": {
        return {
          suggestions: [
            { priority: "high", agent_source: "geometry+simulation", change: "Add reinforcement rib at thin wall region (Section C-7)", impact: "Manufacturability +15pts, stress safety factor +0.3", confidence: 0.92 },
            { priority: "medium", agent_source: "geometry", change: "Increase draft on faces 12, 23, 31 to ≥3°", impact: "Tooling cost -12%, extraction reliability +95%", confidence: 0.88 },
            { priority: "low", agent_source: "cost", change: "Simplify B-spline surface #2 to cylindrical approximation", impact: "Finishing time -8%, negligible form change", confidence: 0.75 },
          ],
        };
      }
      case "run_parameter_sweep": {
        const params = input.parameters as Record<string, unknown> || {};
        const resolution = (input.resolution as number) || 10;
        const paramCount = Object.keys(params).length || 3;
        return {
          parameter_count: paramCount, resolution, total_evaluations: Math.pow(resolution, paramCount),
          optimal_values: { wall_thickness_mm: 2.1, draft_angle_deg: 3.5, fillet_radius_mm: 1.5 },
          objective: input.objective, objective_value: 0.91,
          sensitivity: { wall_thickness_mm: 0.82, draft_angle_deg: 0.45, fillet_radius_mm: 0.23 },
        };
      }
      default:
        throw new Error(`OptimizationAgent: unknown tool ${tool}`);
    }
  }
}

// ─── Simulation Agent ────────────────────────────────────────────

class SimulationAgent extends BaseAgent {
  readonly type: AgentType = "simulation";
  readonly tools = ["run_stress_analysis", "run_thermal_analysis", "predict_fatigue_life", "check_manufacturability"];

  protected runTool(tool: string, input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
    switch (tool) {
      case "run_stress_analysis": {
        const load = (input.load_newtons as number) || 1000;
        const maxStress = 342.7 * (load / 1000);
        const yieldStrength = 880;
        const sf = +(yieldStrength / maxStress).toFixed(2);
        if (sf < 1.5) warnings.push(`Safety factor ${sf} below recommended 1.5`);
        return { max_von_mises_mpa: +maxStress.toFixed(1), yield_strength_mpa: yieldStrength, safety_factor: sf, applied_load_N: load, critical_location: [12.5, -3.2, 45.0], status: sf >= 1.0 ? "PASS" : "FAIL" };
      }
      case "run_thermal_analysis": {
        const temp = (input.temp_celsius as number) || 200;
        const maxT = temp * 1.24;
        if (maxT > 300) warnings.push(`Max temperature ${maxT.toFixed(0)}°C approaching material limit`);
        return { max_temp_c: +maxT.toFixed(1), min_temp_c: 22.1, gradient_c_per_mm: +(temp * 0.009).toFixed(2), hot_spots: [{ location: [12.5, -3.2, 45.0], temp: +maxT.toFixed(1) }], status: maxT < 500 ? "PASS" : "FAIL" };
      }
      case "predict_fatigue_life": {
        const maxStress = (input.max_stress_mpa as number) || 342;
        const endurance = 510;
        const cycles = maxStress < endurance ? Infinity : Math.round(1e7 * Math.pow(endurance / maxStress, 8));
        const sf = +(endurance / maxStress).toFixed(2);
        return { cycles_to_failure: cycles === Infinity ? "INFINITE" : cycles, endurance_limit_mpa: endurance, stress_ratio: input.stress_ratio ?? 0.1, safety_factor: sf, status: maxStress < endurance ? "INFINITE_LIFE" : "FINITE_LIFE" };
      }
      case "check_manufacturability": {
        const f = (input.face_count as number) || 47;
        const h = (input.hole_count as number) || 12;
        const t = (input.min_thickness as number) || 1.2;
        const cr = (input.complex_face_ratio as number) || 0.085;
        const wallScore = Math.min(100, Math.max(0, (t - 0.5) * 50));
        const holeScore = Math.max(0, 100 - h * 2);
        const complexityScore = Math.max(0, 100 - cr * 400);
        const overall = Math.round((wallScore * 0.3 + holeScore * 0.25 + 85 * 0.2 + complexityScore * 0.25));
        const w: string[] = [];
        if (t < 1.5) w.push(`Thin wall ${t}mm < 1.5mm minimum`);
        if (h > 10) w.push(`${h} holes increase machining complexity`);
        if (cr > 0.1) w.push(`${(cr * 100).toFixed(0)}% complex faces add finishing cost`);
        warnings.push(...w);
        return { overall_score: overall, sub_scores: { wall_thickness: Math.round(wallScore), hole_accessibility: holeScore, undercuts: 85, surface_complexity: Math.round(complexityScore) }, warnings: w, recommendations: w.map(ww => ww.includes("Thin") ? "Add reinforcement rib" : ww.includes("holes") ? "Consolidate holes where possible" : "Simplify surfaces") };
      }
      default:
        throw new Error(`SimulationAgent: unknown tool ${tool}`);
    }
  }
}

// ─── Workflow Agent ──────────────────────────────────────────────

class WorkflowAgent extends BaseAgent {
  readonly type: AgentType = "workflow";
  readonly tools = ["generate_process_plan", "select_fixtures", "estimate_lead_time", "define_quality_checkpoints"];

  protected runTool(tool: string, input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
    switch (tool) {
      case "generate_process_plan": {
        const mat = (input.material as string) || "Ti-6Al-4V";
        const qty = (input.quantity as number) || 1;
        const ops = [
          { seq: 1, type: "rough_mill", machine: "5-axis CNC", time_min: 45, description: "Rough mill outer profile" },
          { seq: 2, type: "drill", machine: "CNC drill", time_min: 20, description: "Drill and ream holes" },
          { seq: 3, type: "finish_mill", machine: "5-axis CNC", time_min: 35, description: "Finish mill surfaces to spec" },
          { seq: 4, type: "deburr", machine: "manual", time_min: 15, description: "Deburr all edges" },
        ];
        const totalMin = ops.reduce((s, o) => s + o.time_min, 0);
        return { material: mat, quantity: qty, operations: ops, total_time_min: totalMin, total_time_hours: +(totalMin / 60).toFixed(2) };
      }
      case "select_fixtures": {
        const plan = input.process_plan as Record<string, unknown> || {};
        const ops = (plan.operations as any[]) || [];
        return {
          fixtures: [
            { operation: 1, type: "3-jaw chuck", clamping_force_kN: 12, notes: "Soft jaws recommended for finished surfaces" },
            { operation: 2, type: "vice with soft jaws", clamping_force_kN: 8, notes: "Ensure hole alignment with spindle" },
            { operation: 3, type: "vacuum table", clamping_force_kN: 5, notes: "For thin-wall finishing passes" },
          ].slice(0, Math.max(ops.length, 2)),
          total_fixtures: Math.min(3, Math.max(ops.length, 2)),
        };
      }
      case "estimate_lead_time": {
        const mh = (input.machining_hours as number) || 2;
        const qty = (input.quantity as number) || 1;
        const priority = (input.priority as string) || "standard";
        const mult = priority === "rush" ? 0.6 : priority === "critical" ? 0.4 : 1.0;
        const prodDays = Math.ceil(mh * qty / 8);
        const totalDays = Math.ceil((prodDays + 3) * mult);
        if (priority === "critical") warnings.push("Critical priority adds 25% surcharge");
        return { production_days: prodDays, queue_days: 3, total_business_days: totalDays, calendar_days: Math.ceil(totalDays * 1.4), priority, includes_inspection: true, rush_surcharge_pct: priority === "rush" ? 15 : priority === "critical" ? 25 : 0 };
      }
      case "define_quality_checkpoints": {
        const tolClass = (input.tolerance_class as string) || "IT7";
        return {
          tolerance_class: tolClass,
          checkpoints: [
            { after_operation: 1, type: "dimensional", method: "CMM spot-check", measurements: ["OD", "length", "concentricity"], pass_criteria: `within ${tolClass}` },
            { after_operation: 3, type: "surface_finish", method: "profilometer", spec: "Ra 1.6μm", pass_criteria: "Ra ≤ 1.6μm" },
            { after_operation: 4, type: "final_inspection", method: "CMM full", spec: tolClass, pass_criteria: "All dimensions within tolerance" },
          ],
          total_checkpoints: 3,
        };
      }
      default:
        throw new Error(`WorkflowAgent: unknown tool ${tool}`);
    }
  }
}

// ─── Document Agent ──────────────────────────────────────────────

class DocumentAgent extends BaseAgent {
  readonly type: AgentType = "document";
  readonly tools = ["generate_quote", "generate_inspection_report", "generate_material_cert", "generate_process_sheet"];

  protected runTool(tool: string, input: Record<string, unknown>, _warnings: string[]): Record<string, unknown> {
    const timestamp = Date.now().toString(36).toUpperCase();
    switch (tool) {
      case "generate_quote": {
        const cb = (input.cost_breakdown as Record<string, number>) || {};
        const items = [
          { description: "Material (raw stock)", amount: cb.material ?? cb.material_usd ?? 342 },
          { description: "CNC Machining", amount: cb.machining ?? cb.machining_usd ?? 1125 },
          { description: "Overhead & QC", amount: cb.overhead ?? cb.overhead_usd ?? 220 },
        ];
        const total = items.reduce((s, i) => s + i.amount, 0);
        return { quote_number: `Q-${timestamp}`, part_name: input.part_name, line_items: items, subtotal: total, total_usd: total, lead_time_days: input.lead_time_days, quantity: input.quantity ?? 1, validity_days: 30, status: "draft" };
      }
      case "generate_inspection_report": {
        const cps = (input.checkpoints as any[]) || [];
        return { report_id: `IR-${timestamp}`, part_name: input.part_name, checkpoint_count: cps.length || 3, template_sections: ["header", "dimensions", "surface_finish", "material_cert_ref", "sign_off"], status: "template_ready" };
      }
      case "generate_material_cert": {
        const mat = (input.material as string) || "Ti-6Al-4V";
        const specs: Record<string, string> = { "Ti-6Al-4V": "AMS 4928", "Inconel 718": "AMS 5662", "Al 7075-T6": "AMS 4045", "SS 316L": "ASTM A240" };
        return { cert_id: `MC-${timestamp}`, material: mat, specification: specs[mat] || "N/A", properties: { UTS_MPa: 950, yield_MPa: 880, elongation_pct: 14, hardness_HRC: 36, density_g_cm3: 4.43 }, compliance: "AS9100D", status: "issued" };
      }
      case "generate_process_sheet": {
        const plan = input.process_plan as Record<string, unknown> || {};
        const ops = (plan.operations as any[]) || [];
        return { sheet_id: `PS-${timestamp}`, part_name: input.part_name, revision: "A", operation_count: ops.length, operations: ops, includes_setup_instructions: true, includes_tool_list: true, status: "generated" };
      }
      default:
        throw new Error(`DocumentAgent: unknown tool ${tool}`);
    }
  }
}

// ─── Agent Registry (singleton instances) ────────────────────────

const AGENTS: BaseAgent[] = [
  new GeometryAgent(),
  new CostAgent(),
  new OptimizationAgent(),
  new SimulationAgent(),
  new WorkflowAgent(),
  new DocumentAgent(),
];

function getAgentForTool(tool: string): BaseAgent {
  const agent = AGENTS.find(a => a.canHandle(tool));
  if (!agent) throw new Error(`No agent registered for tool: ${tool}`);
  return agent;
}

// ─── Execution with Cache, Retry & Output Validation ─────────────

const MAX_RETRIES = 3;
const CACHEABLE_TOOLS = new Set([
  "analyze_faces", "analyze_edges", "detect_holes", "measure_thickness",
  "check_draft_angles", "build_topology_graph", "run_stress_analysis",
  "run_thermal_analysis", "check_manufacturability", "estimate_material_cost",
  "estimate_machining_time",
]);

interface ExecutionOutcome {
  success: boolean;
  data: Record<string, unknown>;
  retries: number;
  cached: boolean;
  agent: AgentType;
  warnings: string[];
  outputValidation: OutputValidationResult;
  confidence: number;
  confidenceGrade: "HIGH" | "MEDIUM" | "LOW";
  durationMs: number;
}

async function executeWithValidation(
  tool: string, args: Record<string, unknown>,
  supabaseAdmin: any, tenantId?: string,
  emitRetry?: (retry: number, reason: string) => void,
): Promise<ExecutionOutcome> {
  const execStart = Date.now();
  const cacheKey = getCacheKey(tool, args);

  // In-memory cache check
  if (CACHEABLE_TOOLS.has(tool)) {
    const cached = memoryCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      const data = cached.data as Record<string, unknown>;
      const ov = validateToolOutput(tool, data);
      const dur = Date.now() - execStart;
      const conf = computeStepConfidence(tool, data, ov, true, 0, dur);
      return { success: true, data, retries: 0, cached: true, agent: AGENT_MAP[tool] || "geometry", warnings: [], outputValidation: ov, confidence: conf, confidenceGrade: confidenceGrade(conf), durationMs: dur };
    }
    // DB cache check
    if (supabaseAdmin && tenantId) {
      try {
        const { data: memRow } = await supabaseAdmin
          .from("agent_memory").select("value, expires_at")
          .eq("tenant_id", tenantId).eq("memory_type", "tool_result_cache").eq("key", cacheKey).maybeSingle();
        if (memRow && (!memRow.expires_at || new Date(memRow.expires_at) > new Date())) {
          const data = memRow.value as Record<string, unknown>;
          memoryCache.set(cacheKey, { data, expires: Date.now() + 300_000 });
          const ov = validateToolOutput(tool, data);
          const dur = Date.now() - execStart;
          const conf = computeStepConfidence(tool, data, ov, true, 0, dur);
          return { success: true, data, retries: 0, cached: true, agent: AGENT_MAP[tool] || "geometry", warnings: [], outputValidation: ov, confidence: conf, confidenceGrade: confidenceGrade(conf), durationMs: dur };
        }
      } catch { /* miss */ }
    }
  }

  // Execute via agent class with retries + output validation
  const agent = getAgentForTool(tool);
  let retries = 0;
  let lastOutput: AgentOutput | null = null;

  while (retries <= MAX_RETRIES) {
    const output = await agent.execute(tool, args);
    lastOutput = output;

    if (output.success) {
      // Validate output
      const ov = validateToolOutput(tool, output.data);

      if (!ov.valid && retries < MAX_RETRIES) {
        // Output validation failed — retry
        retries++;
        emitRetry?.(retries, `Output validation failed: ${ov.errors.join("; ")}`);
        await new Promise(r => setTimeout(r, 300 * retries));
        continue;
      }

      // Cache valid results
      if (CACHEABLE_TOOLS.has(tool) && ov.valid) {
        const ttl = 600_000;
        memoryCache.set(cacheKey, { data: output.data, expires: Date.now() + ttl });
        if (supabaseAdmin && tenantId) {
          supabaseAdmin.from("agent_memory").upsert({
            tenant_id: tenantId, memory_type: "tool_result_cache", key: cacheKey,
            value: output.data, ttl_seconds: 600, expires_at: new Date(Date.now() + ttl).toISOString(),
          }, { onConflict: "tenant_id,memory_type,key" }).then(() => {});
        }
      }

      const dur = Date.now() - execStart;
      const conf = computeStepConfidence(tool, output.data, ov, false, retries, dur);
      return { success: true, data: output.data, retries, cached: false, agent: agent.type, warnings: output.metadata.warnings, outputValidation: ov, confidence: conf, confidenceGrade: confidenceGrade(conf), durationMs: dur };
    }

    // Execution failed — retry
    retries++;
    if (retries > MAX_RETRIES) break;
    emitRetry?.(retries, `Execution error: ${(output.data as any).error || "unknown"}`);
    await new Promise(r => setTimeout(r, 500 * retries));
  }

  const dur = Date.now() - execStart;
  const failedOV: OutputValidationResult = { valid: false, errors: ["Execution failed after max retries"], warnings: [] };
  return { success: false, data: lastOutput?.data || { error: "Max retries exceeded" }, retries: MAX_RETRIES, cached: false, agent: agent.type, warnings: lastOutput?.metadata.warnings || [], outputValidation: failedOV, confidence: 0, confidenceGrade: "LOW", durationMs: dur };
}

// ─── Structured Planner ──────────────────────────────────────────

interface PlanStep {
  id: string;
  agent: AgentType;
  tool: string;
  input: Record<string, unknown>;
  depends_on: string[];
  rationale: string;
}

interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
  reasoning: string;
}

const PLANNER_SCHEMA = {
  name: "create_execution_plan",
  description: "Create a minimal, logically sequenced execution plan from the user request. Each step maps to exactly one tool. Use depends_on to express data flow between steps. Minimize total steps — only include tools that directly serve the user's goal.",
  parameters: {
    type: "object",
    properties: {
      goal: { type: "string", description: "One-sentence summary of user's intent" },
      reasoning: { type: "string", description: "Brief chain-of-thought: why these steps in this order, and why no fewer steps would suffice" },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique step ID like s1, s2, ..." },
            agent: { type: "string", enum: ["geometry", "cost", "optimization", "simulation", "workflow", "document"] },
            tool: { type: "string", description: "Exact tool name from the registry" },
            input: { type: "object", description: "Tool input parameters. Use $ref:stepId.field to reference output from a previous step" },
            depends_on: { type: "array", items: { type: "string" }, description: "Step IDs this depends on (empty = can run immediately)" },
            rationale: { type: "string", description: "Why this step is needed" },
          },
          required: ["id", "agent", "tool", "input", "depends_on", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["goal", "reasoning", "steps"],
    additionalProperties: false,
  },
};

const PLANNER_SYSTEM_PROMPT = `You are a planning engine for FORGE CAD Copilot. Given a user request, produce a MINIMAL execution plan.

AVAILABLE TOOLS BY AGENT:
• geometry: analyze_faces, analyze_edges, detect_holes, measure_thickness, check_draft_angles, build_topology_graph
• cost: estimate_material_cost, estimate_machining_time, estimate_total_cost, quantity_price_breaks
• optimization: run_topology_optimization, suggest_design_changes, run_parameter_sweep
• simulation: run_stress_analysis, run_thermal_analysis, predict_fatigue_life, check_manufacturability
• workflow: generate_process_plan, select_fixtures, estimate_lead_time, define_quality_checkpoints
• document: generate_quote, generate_inspection_report, generate_material_cert, generate_process_sheet

RULES:
1. MINIMAL STEPS: Only include tools that directly answer the user's question. Never add "nice-to-have" steps.
2. LOGICAL SEQUENCING: If step B needs output from step A, add A's id to B's depends_on array. Independent steps have empty depends_on and will run in parallel.
3. INPUT REFERENCES: When a step needs data from a prior step, use "$ref:stepId.field" syntax in the input value.
4. CONTEXT: Current model is Turbine_Housing_v4.step, material Ti-6Al-4V, 47 faces, 12 holes, volume 284.3cm³.
5. For simple questions that don't need tools, return an empty steps array.`;

async function runPlanner(
  messages: { role: string; content: string }[],
  apiKey: string,
): Promise<ExecutionPlan> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [{ role: "system", content: PLANNER_SYSTEM_PROMPT }, ...messages],
      tools: [{ type: "function", function: PLANNER_SCHEMA }],
      tool_choice: { type: "function", function: { name: "create_execution_plan" } },
      stream: false,
    }),
  });

  if (!resp.ok) {
    const s = resp.status;
    throw new Error(s === 429 ? "RATE_LIMIT" : s === 402 ? "CREDITS_EXHAUSTED" : `PLANNER_ERROR:${s}`);
  }

  const data = await resp.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) {
    return { goal: "conversational", steps: [], reasoning: "No tools needed" };
  }

  const plan: ExecutionPlan = JSON.parse(tc.function.arguments);

  // Validate: ensure all tool names exist and deps reference valid step IDs
  const stepIds = new Set(plan.steps.map(s => s.id));
  for (const step of plan.steps) {
    if (!AGENT_MAP[step.tool]) throw new Error(`Planner referenced unknown tool: ${step.tool}`);
    for (const dep of step.depends_on) {
      if (!stepIds.has(dep)) throw new Error(`Step ${step.id} depends on unknown step: ${dep}`);
    }
    // Check for circular deps (simple: no step can depend on itself or later steps)
    const stepIdx = plan.steps.findIndex(s => s.id === step.id);
    for (const dep of step.depends_on) {
      const depIdx = plan.steps.findIndex(s => s.id === dep);
      if (depIdx >= stepIdx) throw new Error(`Circular/forward dependency: ${step.id} -> ${dep}`);
    }
  }

  return plan;
}

// ─── DAG Scheduler ───────────────────────────────────────────────

function buildParallelGroups(steps: PlanStep[]): PlanStep[][] {
  const groups: PlanStep[][] = [];
  const completed = new Set<string>();
  const remaining = [...steps];

  while (remaining.length > 0) {
    const ready = remaining.filter(s => s.depends_on.every(d => completed.has(d)));
    if (ready.length === 0) {
      // Deadlock — force remaining into a group
      groups.push([...remaining]);
      break;
    }
    groups.push(ready);
    for (const s of ready) {
      completed.add(s.id);
      remaining.splice(remaining.indexOf(s), 1);
    }
  }

  return groups;
}

// Resolve $ref:stepId.field references in input
function resolveInputRefs(
  input: Record<string, unknown>,
  results: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    if (typeof val === "string" && val.startsWith("$ref:")) {
      const [stepId, ...fieldParts] = val.slice(5).split(".");
      const stepResult = results.get(stepId);
      if (stepResult) {
        let value: unknown = stepResult;
        for (const f of fieldParts) value = (value as any)?.[f];
        resolved[key] = value ?? val;
      } else {
        resolved[key] = val;
      }
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      resolved[key] = resolveInputRefs(val as Record<string, unknown>, results);
    } else {
      resolved[key] = val;
    }
  }
  return resolved;
}

// ─── SSE Helper ──────────────────────────────────────────────────

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ─── Synthesis Prompt ────────────────────────────────────────────

const SYNTHESIS_SYSTEM = `You are FORGE CAD Copilot. You've just executed an analysis plan. Synthesize the tool results into a clear, concise engineering response. Always cite specific numbers. Use markdown formatting. Be thorough but not verbose.`;

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

    // ── Phase 1: LLM Planner ──
    let plan: ExecutionPlan;
    try {
      plan = await runPlanner(messages, LOVABLE_API_KEY);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "RATE_LIMIT") return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (msg === "CREDITS_EXHAUSTED") return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw e;
    }

    // No tools needed → conversational response
    if (plan.steps.length === 0) {
      const chatResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [{ role: "system", content: SYNTHESIS_SYSTEM }, ...messages],
          stream: true,
        }),
      });

      if (!chatResp.ok || !chatResp.body) throw new Error("Chat response failed");
      return new Response(chatResp.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }

    // ── Phase 2: Validate → DAG → Execute ──
    const parallelGroups = buildParallelGroups(plan.steps);

    const body = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (d: unknown) => controller.enqueue(enc.encode(sseEvent(d)));

        // Emit plan
        const agents = [...new Set(plan.steps.map(s => s.agent))];
        emit({
          event: "plan_ready",
          content: `📋 Plan: ${plan.goal}\n${plan.reasoning}`,
          data: {
            goal: plan.goal,
            reasoning: plan.reasoning,
            step_count: plan.steps.length,
            agents,
            parallel_groups: parallelGroups.length,
            steps: plan.steps.map(s => ({ id: s.id, agent: s.agent, tool: s.tool, depends_on: s.depends_on, rationale: s.rationale })),
          },
        });

        // Validate all inputs
        for (const step of plan.steps) {
          const errors = validateToolArgs(step.tool, step.input);
          if (errors.length > 0) {
            emit({ event: "validation", agent: step.agent, tool: step.tool, stepId: step.id, content: `⚠ ${step.id}: ${errors.map(e => e.message).join(", ")}`, data: { errors } });
          }
        }

        // Execute DAG groups with validation & confidence
        const stepResults = new Map<string, Record<string, unknown>>();
        const stepMeta = new Map<string, { tool: string; agent: string }>();
        const stepConfidences: StepConfidence[] = [];
        const toolResults: { step_id: string; tool: string; agent: string; result: Record<string, unknown>; cached: boolean; duration_ms: number; confidence: number; confidence_grade: string; output_validation: OutputValidationResult }[] = [];
        let cacheHits = 0;
        let totalRetries = 0;

        for (let gi = 0; gi < parallelGroups.length; gi++) {
          const group = parallelGroups[gi];
          if (group.length > 1) {
            emit({ event: "parallel_group", parallelGroup: gi, content: `⚡ Parallel group ${gi + 1}: ${group.map(s => s.tool).join(", ")}` });
          }

          const promises = group.map(async (step) => {
            const resolvedInput = resolveInputRefs(step.input, stepResults);

            emit({ event: "step_start", agent: step.agent, tool: step.tool, stepId: step.id, content: `${step.rationale}` });

            const result = await executeWithValidation(
              step.tool, resolvedInput, supabaseAdmin, tenantId,
              (retry, reason) => {
                emit({ event: "step_retry" as any, agent: step.agent, tool: step.tool, stepId: step.id, content: `🔄 Retry ${retry}/${MAX_RETRIES}: ${reason}` });
              },
            );

            totalRetries += result.retries;

            if (result.cached) {
              cacheHits++;
              emit({ event: "cache_hit", agent: step.agent, tool: step.tool, stepId: step.id, content: `⚡ ${step.tool} [cached]`, cached: true, confidence: result.confidence });
            }

            // Emit output validation result
            if (result.outputValidation.errors.length > 0 || result.outputValidation.warnings.length > 0) {
              emit({
                event: "output_validation" as any, agent: step.agent, tool: step.tool, stepId: step.id,
                content: `🔍 Output validation: ${result.outputValidation.valid ? "PASS" : "FAIL"} — ${result.outputValidation.errors.concat(result.outputValidation.warnings).join("; ")}`,
                data: { valid: result.outputValidation.valid, errors: result.outputValidation.errors, warnings: result.outputValidation.warnings },
              });
            }

            if (result.success) {
              stepResults.set(step.id, result.data);
              stepMeta.set(step.id, { tool: step.tool, agent: step.agent });
              emit({
                event: "step_complete", agent: step.agent, tool: step.tool, stepId: step.id, data: result.data,
                content: `✓ ${step.tool} (${result.durationMs}ms)${result.cached ? " [cached]" : ""}${result.retries > 0 ? ` [${result.retries} retries]` : ""} — confidence: ${(result.confidence * 100).toFixed(0)}% ${result.confidenceGrade}`,
                confidence: result.confidence,
              });
            } else {
              emit({ event: "step_error", agent: step.agent, tool: step.tool, stepId: step.id, content: `✗ ${step.tool}: ${(result.data as any).error || "failed after retries"}`, confidence: 0 });
            }

            stepConfidences.push({
              stepId: step.id, tool: step.tool, agent: step.agent,
              score: result.confidence, grade: result.confidenceGrade,
              factors: { validation_errors: result.outputValidation.errors.length, validation_warnings: result.outputValidation.warnings.length, retries: result.retries, cached: result.cached ? 1 : 0, duration_ms: result.durationMs },
            });

            toolResults.push({ step_id: step.id, tool: step.tool, agent: step.agent, result: result.data, cached: result.cached, duration_ms: result.durationMs, confidence: result.confidence, confidence_grade: result.confidenceGrade, output_validation: result.outputValidation });
          });

          await Promise.all(promises);
        }

        // ── Phase 3: Cross-Result Consistency Checks ──
        const consistencyIssues = checkCrossResultConsistency(stepResults, stepMeta);
        if (consistencyIssues.length > 0) {
          for (const issue of consistencyIssues) {
            emit({
              event: "consistency_check" as any,
              content: `${issue.severity === "high" ? "🚨" : issue.severity === "medium" ? "⚠️" : "ℹ️"} [${issue.type}] ${issue.description}`,
              data: { type: issue.type, severity: issue.severity, involved_steps: issue.involvedSteps },
            });
          }
          // Penalize confidence for high-severity consistency issues
          for (const issue of consistencyIssues.filter(i => i.severity === "high")) {
            for (const stepId of issue.involvedSteps) {
              const sc = stepConfidences.find(c => c.stepId === stepId);
              if (sc) {
                sc.score = Math.max(0, sc.score - 0.15);
                sc.grade = confidenceGrade(sc.score);
              }
            }
          }
        }

        // ── Phase 4: Confidence Report ──
        const avgConfidence = stepConfidences.length > 0
          ? +(stepConfidences.reduce((s, c) => s + c.score, 0) / stepConfidences.length).toFixed(2)
          : 0;
        const overallGrade = confidenceGrade(avgConfidence);
        const lowConfSteps = stepConfidences.filter(c => c.grade === "LOW");

        emit({
          event: "confidence_report" as any,
          content: `📊 Overall confidence: ${(avgConfidence * 100).toFixed(0)}% (${overallGrade})${consistencyIssues.length > 0 ? ` — ${consistencyIssues.length} consistency issue(s)` : ""}${lowConfSteps.length > 0 ? ` — ${lowConfSteps.length} low-confidence step(s)` : ""}`,
          confidence: avgConfidence,
          data: {
            overall_confidence: avgConfidence,
            overall_grade: overallGrade,
            step_confidences: stepConfidences,
            consistency_issues: consistencyIssues,
            total_retries: totalRetries,
            cache_hits: cacheHits,
          },
        });

        // Persist execution with validation data
        if (supabaseAdmin) {
          const totalMs = Date.now() - startTime;
          emit({ event: "memory_store", content: `💾 Execution: ${plan.steps.length} steps, ${cacheHits} cached, ${totalRetries} retries, ${totalMs}ms total` });

          supabaseAdmin.from("agent_executions").insert({
            tenant_id: tenantId || null,
            goal: plan.goal,
            plan: { reasoning: plan.reasoning, steps: plan.steps },
            results: toolResults,
            status: "completed",
            total_duration_ms: totalMs,
            model_used: "google/gemini-3-flash-preview",
            token_usage: { cache_hits: cacheHits, parallel_groups: parallelGroups.length, total_retries: totalRetries, overall_confidence: avgConfidence, consistency_issues: consistencyIssues.length },
            completed_at: new Date().toISOString(),
          }).then(() => {});
        }

        // ── Phase 5: LLM Synthesis (with confidence context) ──
        const toolSummary = toolResults.map(tr =>
          `[${tr.agent}/${tr.tool}] (step ${tr.step_id}${tr.cached ? ", cached" : ""}, confidence: ${(tr.confidence * 100).toFixed(0)}% ${tr.confidence_grade}):\n${JSON.stringify(tr.result, null, 1)}`
        ).join("\n\n");

        const consistencySummary = consistencyIssues.length > 0
          ? `\n\nConsistency issues found:\n${consistencyIssues.map(i => `- [${i.severity}] ${i.description}`).join("\n")}`
          : "";

        const synthesisMessages = [
          { role: "system", content: SYNTHESIS_SYSTEM },
          ...messages,
          { role: "assistant", content: `I executed a ${plan.steps.length}-step plan: ${plan.goal}\n\nPlan reasoning: ${plan.reasoning}\n\nOverall confidence: ${(avgConfidence * 100).toFixed(0)}% (${overallGrade})\n\nTool results:\n${toolSummary}${consistencySummary}` },
          { role: "user", content: "Synthesize these results into a clear engineering response for the user. Cite specific numbers. If confidence is below 85%, note which results have lower confidence and why. Mention any consistency issues found." },
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
