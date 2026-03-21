/**
 * Multi-Agent Orchestration System — Core Types
 * 
 * Architecture:
 *   Planner (LLM) → Agent Registry → Tool System → Execution Engine → Validation → Memory
 */

// ─── Agent Types ─────────────────────────────────────────────────

export type AgentType = 'geometry' | 'cost' | 'optimization' | 'simulation' | 'workflow' | 'document';

export interface AgentDefinition {
  type: AgentType;
  name: string;
  description: string;
  icon: string;
  capabilities: string[];
  maxConcurrency: number;
}

// ─── Tool System ─────────────────────────────────────────────────

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  agent: AgentType;
  parameters: ToolParameter[];
  outputSchema?: Record<string, unknown>;
  cacheable?: boolean;
  cacheTTLSeconds?: number;
}

// ─── Validation Layer ────────────────────────────────────────────

export interface ValidationRule {
  field: string;
  check: 'required' | 'range' | 'type' | 'enum' | 'custom';
  params?: Record<string, unknown>;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
}

// ─── Task Planning (DAG-based) ───────────────────────────────────

export interface TaskStep {
  id: string;
  tool: string;
  agent: AgentType;
  description: string;
  parameters: Record<string, unknown>;
  dependsOn: string[];
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
  retryCount: number;
  maxRetries: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  validationResult?: ValidationResult;
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  status: 'planning' | 'validating' | 'executing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  parallelGroups: string[][]; // groups of step IDs that can run in parallel
}

// ─── Execution Engine ────────────────────────────────────────────

export interface ExecutionResult {
  stepId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
  retries: number;
  cached: boolean;
}

export interface ExecutionContext {
  tenantId?: string;
  userId?: string;
  modelId?: string;
  material?: string;
  conversationHistory: { role: string; content: string }[];
  memoryHints: Record<string, unknown>;
}

export interface ExecutionSummary {
  planId: string;
  goal: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  totalDurationMs: number;
  cacheHits: number;
  results: ExecutionResult[];
}

// ─── Memory System ───────────────────────────────────────────────

export type MemoryType = 'tool_result_cache' | 'learned_pattern' | 'user_preference' | 'execution_summary';

export interface MemoryEntry {
  id: string;
  tenantId?: string;
  memoryType: MemoryType;
  key: string;
  value: unknown;
  ttlSeconds: number;
  createdAt: string;
  expiresAt?: string;
}

// ─── Aggregated Response ─────────────────────────────────────────

export interface AgentResponse {
  plan: TaskPlan;
  execution: ExecutionSummary;
  aggregated: AggregatedResult;
}

export interface AggregatedResult {
  summary: string;
  scores: Record<string, number>;
  warnings: string[];
  recommendations: string[];
  data: Record<string, unknown>;
}

// ─── Streaming Events ────────────────────────────────────────────

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  agentActivity?: AgentActivity;
}

export interface AgentActivity {
  type: 'planning' | 'validating' | 'executing' | 'tool_call' | 'result' | 'cache_hit' | 'memory_store'
    | 'output_validation' | 'step_retry' | 'consistency_check' | 'confidence_report' | 'error';
  agent?: AgentType;
  tool?: string;
  stepId?: string;
  details?: string;
  parallelGroup?: number;
  confidence?: number;
  confidenceGrade?: 'HIGH' | 'MEDIUM' | 'LOW';
}

// ─── Agent Registry ──────────────────────────────────────────────

export const AGENT_REGISTRY: Record<AgentType, AgentDefinition> = {
  geometry: {
    type: 'geometry',
    name: 'Geometry Agent',
    description: 'Analyzes CAD topology, extracts features, builds face-adjacency graphs, measures dimensions',
    icon: '📐',
    capabilities: ['face_analysis', 'hole_detection', 'thickness_measurement', 'draft_checking', 'topology_graph'],
    maxConcurrency: 4,
  },
  cost: {
    type: 'cost',
    name: 'Cost Agent',
    description: 'Estimates material costs, machining time, tooling costs, total pricing with quantity breaks',
    icon: '💰',
    capabilities: ['material_costing', 'machining_estimation', 'total_cost_aggregation', 'quantity_pricing'],
    maxConcurrency: 3,
  },
  optimization: {
    type: 'optimization',
    name: 'Optimization Agent',
    description: 'Runs multi-objective optimization for cost, manufacturability, and weight reduction',
    icon: '⚡',
    capabilities: ['topology_optimization', 'parameter_sweep', 'pareto_analysis', 'design_suggestion'],
    maxConcurrency: 2,
  },
  simulation: {
    type: 'simulation',
    name: 'Simulation Agent',
    description: 'Runs FEA stress/thermal analysis, fatigue life prediction, manufacturability scoring',
    icon: '🔬',
    capabilities: ['stress_analysis', 'thermal_analysis', 'fatigue_prediction', 'manufacturability_scoring'],
    maxConcurrency: 2,
  },
  workflow: {
    type: 'workflow',
    name: 'Workflow Agent',
    description: 'Manages multi-step manufacturing workflows, scheduling, and process planning',
    icon: '🔄',
    capabilities: ['process_planning', 'operation_sequencing', 'fixture_selection', 'quality_checkpoints'],
    maxConcurrency: 2,
  },
  document: {
    type: 'document',
    name: 'Document Agent',
    description: 'Generates reports, quotes, inspection sheets, and engineering documentation',
    icon: '📄',
    capabilities: ['quote_generation', 'inspection_report', 'material_cert', 'process_sheet'],
    maxConcurrency: 2,
  },
};

// ─── Complete Tool Registry ──────────────────────────────────────

export const TOOL_REGISTRY: ToolDefinition[] = [
  // ── Geometry Agent ──
  {
    name: 'analyze_faces', description: 'Extract and classify all faces from CAD geometry',
    agent: 'geometry', cacheable: true, cacheTTLSeconds: 600,
    parameters: [{ name: 'model_id', type: 'string', description: 'Model identifier', required: true }],
  },
  {
    name: 'analyze_edges', description: 'Extract edges and classify curve types',
    agent: 'geometry', cacheable: true, cacheTTLSeconds: 600,
    parameters: [{ name: 'model_id', type: 'string', description: 'Model identifier', required: true }],
  },
  {
    name: 'detect_holes', description: 'Detect and classify holes (through, blind, countersunk)',
    agent: 'geometry', cacheable: true, cacheTTLSeconds: 600,
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'min_diameter', type: 'number', description: 'Minimum hole diameter (mm)', default: 0.5 },
    ],
  },
  {
    name: 'measure_thickness', description: 'Compute wall thickness distribution via ray-casting',
    agent: 'geometry', cacheable: true, cacheTTLSeconds: 600,
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'sample_density', type: 'number', description: 'Ray sample density', default: 100 },
    ],
  },
  {
    name: 'check_draft_angles', description: 'Check draft angles on all faces relative to pull direction',
    agent: 'geometry', cacheable: true, cacheTTLSeconds: 600,
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'pull_direction', type: 'string', description: 'Pull direction (x/y/z)', default: 'z' },
    ],
  },
  {
    name: 'build_topology_graph', description: 'Convert geometry into face-adjacency graph',
    agent: 'geometry', cacheable: true, cacheTTLSeconds: 600,
    parameters: [{ name: 'model_id', type: 'string', description: 'Model identifier', required: true }],
  },

  // ── Cost Agent ──
  {
    name: 'estimate_material_cost', description: 'Calculate raw material cost based on volume and material',
    agent: 'cost', cacheable: true, cacheTTLSeconds: 300,
    parameters: [
      { name: 'material', type: 'string', description: 'Material (e.g. Ti-6Al-4V)', required: true },
      { name: 'volume_cm3', type: 'number', description: 'Part volume in cm³', required: true },
      { name: 'bounding_volume_cm3', type: 'number', description: 'Bounding box volume', required: true },
    ],
  },
  {
    name: 'estimate_machining_time', description: 'Estimate CNC machining cycle time',
    agent: 'cost', cacheable: true, cacheTTLSeconds: 300,
    parameters: [
      { name: 'face_count', type: 'number', description: 'Number of faces', required: true },
      { name: 'hole_count', type: 'number', description: 'Number of holes', required: true },
      { name: 'material', type: 'string', description: 'Material type', required: true },
      { name: 'complexity_score', type: 'number', description: 'Surface complexity 0-100', required: true },
    ],
  },
  {
    name: 'estimate_total_cost', description: 'Aggregate all costs into total part cost',
    agent: 'cost',
    parameters: [
      { name: 'material_cost', type: 'number', description: 'Material cost ($)', required: true },
      { name: 'machining_hours', type: 'number', description: 'Machining time (hours)', required: true },
      { name: 'quantity', type: 'number', description: 'Production quantity', default: 1 },
    ],
  },
  {
    name: 'quantity_price_breaks', description: 'Calculate volume pricing across quantities',
    agent: 'cost',
    parameters: [
      { name: 'unit_cost', type: 'number', description: 'Single unit cost ($)', required: true },
      { name: 'quantities', type: 'array', description: 'Quantity breakpoints', required: true },
    ],
  },

  // ── Optimization Agent ──
  {
    name: 'run_topology_optimization', description: 'Multi-objective topology optimization using GA',
    agent: 'optimization',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'objectives', type: 'array', description: 'Objectives: cost, weight, manufacturability', required: true },
      { name: 'material', type: 'string', description: 'Material', required: true },
      { name: 'constraints', type: 'object', description: 'Design constraints', default: {} },
    ],
  },
  {
    name: 'suggest_design_changes', description: 'AI-driven design improvement suggestions',
    agent: 'optimization',
    parameters: [
      { name: 'analysis_data', type: 'object', description: 'Combined analysis results', required: true },
      { name: 'priorities', type: 'array', description: 'Priority ranking of objectives' },
    ],
  },
  {
    name: 'run_parameter_sweep', description: 'Sweep design parameters to find optimal values',
    agent: 'optimization',
    parameters: [
      { name: 'parameters', type: 'object', description: 'Parameters and ranges to sweep', required: true },
      { name: 'objective', type: 'string', description: 'Objective to optimize', required: true },
      { name: 'resolution', type: 'number', description: 'Number of steps per parameter', default: 10 },
    ],
  },

  // ── Simulation Agent ──
  {
    name: 'run_stress_analysis', description: 'Quick FEA stress analysis at critical points',
    agent: 'simulation', cacheable: true, cacheTTLSeconds: 600,
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'load_newtons', type: 'number', description: 'Applied load (N)', default: 1000 },
      { name: 'material', type: 'string', description: 'Material', required: true },
    ],
  },
  {
    name: 'run_thermal_analysis', description: 'Thermal distribution under operating conditions',
    agent: 'simulation', cacheable: true, cacheTTLSeconds: 600,
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'temp_celsius', type: 'number', description: 'Operating temperature (°C)', default: 200 },
      { name: 'material', type: 'string', description: 'Material', required: true },
    ],
  },
  {
    name: 'predict_fatigue_life', description: 'Estimate fatigue life cycles under cyclic loading',
    agent: 'simulation',
    parameters: [
      { name: 'max_stress_mpa', type: 'number', description: 'Max cyclic stress (MPa)', required: true },
      { name: 'material', type: 'string', description: 'Material', required: true },
      { name: 'stress_ratio', type: 'number', description: 'R-ratio (min/max stress)', default: 0.1 },
    ],
  },
  {
    name: 'check_manufacturability', description: 'Score manufacturability from geometry features',
    agent: 'simulation', cacheable: true, cacheTTLSeconds: 300,
    parameters: [
      { name: 'face_count', type: 'number', description: 'Number of faces', required: true },
      { name: 'hole_count', type: 'number', description: 'Number of holes', required: true },
      { name: 'min_thickness', type: 'number', description: 'Min wall thickness (mm)', required: true },
      { name: 'complex_face_ratio', type: 'number', description: 'Ratio of non-planar faces', required: true },
    ],
  },

  // ── Workflow Agent ──
  {
    name: 'generate_process_plan', description: 'Generate machining process plan with operation sequence',
    agent: 'workflow',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'material', type: 'string', description: 'Material', required: true },
      { name: 'quantity', type: 'number', description: 'Batch quantity', default: 1 },
    ],
  },
  {
    name: 'select_fixtures', description: 'Recommend work-holding fixtures for each operation',
    agent: 'workflow',
    parameters: [
      { name: 'process_plan', type: 'object', description: 'Process plan from generate_process_plan', required: true },
    ],
  },
  {
    name: 'estimate_lead_time', description: 'Estimate total lead time including queue and setup',
    agent: 'workflow',
    parameters: [
      { name: 'machining_hours', type: 'number', description: 'Total machining time', required: true },
      { name: 'quantity', type: 'number', description: 'Quantity', required: true },
      { name: 'priority', type: 'string', description: 'Priority: standard, rush, critical', default: 'standard' },
    ],
  },
  {
    name: 'define_quality_checkpoints', description: 'Define in-process inspection checkpoints',
    agent: 'workflow',
    parameters: [
      { name: 'process_plan', type: 'object', description: 'Process plan', required: true },
      { name: 'tolerance_class', type: 'string', description: 'ISO tolerance class', default: 'IT7' },
    ],
  },

  // ── Document Agent ──
  {
    name: 'generate_quote', description: 'Generate formal quotation document',
    agent: 'document',
    parameters: [
      { name: 'part_name', type: 'string', description: 'Part name', required: true },
      { name: 'cost_breakdown', type: 'object', description: 'Cost breakdown data', required: true },
      { name: 'lead_time_days', type: 'number', description: 'Lead time in business days', required: true },
      { name: 'quantity', type: 'number', description: 'Quantity', default: 1 },
    ],
  },
  {
    name: 'generate_inspection_report', description: 'Generate inspection report template',
    agent: 'document',
    parameters: [
      { name: 'part_name', type: 'string', description: 'Part name', required: true },
      { name: 'checkpoints', type: 'array', description: 'Quality checkpoints', required: true },
    ],
  },
  {
    name: 'generate_material_cert', description: 'Generate material certification document',
    agent: 'document',
    parameters: [
      { name: 'material', type: 'string', description: 'Material specification', required: true },
      { name: 'properties', type: 'object', description: 'Material properties data' },
    ],
  },
  {
    name: 'generate_process_sheet', description: 'Generate manufacturing process sheet',
    agent: 'document',
    parameters: [
      { name: 'process_plan', type: 'object', description: 'Process plan', required: true },
      { name: 'part_name', type: 'string', description: 'Part name', required: true },
    ],
  },
];
