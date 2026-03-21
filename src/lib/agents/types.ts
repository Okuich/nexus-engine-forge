/**
 * Agent Framework — Core types and interfaces for the multi-agent system.
 * Used by both frontend (display) and edge function (execution).
 */

// ─── Tool Registry ───────────────────────────────────────────────

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  agent: AgentType;
  parameters: ToolParameter[];
}

export type AgentType = 'geometry' | 'cost' | 'simulation';

// ─── Task Planning ───────────────────────────────────────────────

export interface TaskStep {
  id: string;
  tool: string;
  agent: AgentType;
  description: string;
  parameters: Record<string, unknown>;
  dependsOn?: string[];  // step IDs this depends on
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  result?: unknown;
  error?: string;
  retryCount?: number;
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: string;
}

// ─── Execution ───────────────────────────────────────────────────

export interface ExecutionResult {
  stepId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export interface AgentResponse {
  plan: TaskPlan;
  results: ExecutionResult[];
  aggregated: AggregatedResult;
}

// ─── Aggregation ─────────────────────────────────────────────────

export interface AggregatedResult {
  summary: string;
  scores: Record<string, number>;
  warnings: string[];
  recommendations: string[];
  data: Record<string, unknown>;
}

// ─── Chat Messages ───────────────────────────────────────────────

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  agentActivity?: AgentActivity;
}

export interface AgentActivity {
  type: 'planning' | 'executing' | 'tool_call' | 'result' | 'error';
  agent?: AgentType;
  tool?: string;
  stepId?: string;
  details?: string;
}

// ─── Tool Registry (static definitions) ──────────────────────────

export const TOOL_REGISTRY: ToolDefinition[] = [
  // Geometry Agent Tools
  {
    name: 'analyze_faces',
    description: 'Extract and classify all faces from CAD geometry (planar, cylindrical, conical, etc.)',
    agent: 'geometry',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
    ],
  },
  {
    name: 'analyze_edges',
    description: 'Extract edges and classify curve types (line, arc, spline)',
    agent: 'geometry',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
    ],
  },
  {
    name: 'detect_holes',
    description: 'Detect and classify holes (through, blind, countersunk, counterbored)',
    agent: 'geometry',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'min_diameter', type: 'number', description: 'Minimum hole diameter (mm)', default: 0.5 },
    ],
  },
  {
    name: 'measure_thickness',
    description: 'Compute wall thickness distribution using ray-casting',
    agent: 'geometry',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'sample_density', type: 'number', description: 'Ray sample density', default: 100 },
    ],
  },
  {
    name: 'check_draft_angles',
    description: 'Check draft angles on all faces relative to pull direction',
    agent: 'geometry',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'pull_direction', type: 'string', description: 'Pull direction (x/y/z)', default: 'z' },
    ],
  },
  {
    name: 'build_topology_graph',
    description: 'Convert geometry into face-adjacency graph structure',
    agent: 'geometry',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
    ],
  },

  // Cost Agent Tools
  {
    name: 'estimate_material_cost',
    description: 'Calculate raw material cost based on bounding box and material',
    agent: 'cost',
    parameters: [
      { name: 'material', type: 'string', description: 'Material (e.g. Ti-6Al-4V)', required: true },
      { name: 'volume_cm3', type: 'number', description: 'Part volume in cm³', required: true },
      { name: 'bounding_volume_cm3', type: 'number', description: 'Bounding box volume in cm³', required: true },
    ],
  },
  {
    name: 'estimate_machining_time',
    description: 'Estimate CNC machining cycle time based on geometry complexity',
    agent: 'cost',
    parameters: [
      { name: 'face_count', type: 'number', description: 'Number of faces', required: true },
      { name: 'hole_count', type: 'number', description: 'Number of holes', required: true },
      { name: 'material', type: 'string', description: 'Material type', required: true },
      { name: 'complexity_score', type: 'number', description: 'Surface complexity 0-100', required: true },
    ],
  },
  {
    name: 'estimate_total_cost',
    description: 'Aggregate material, labor, overhead into total part cost',
    agent: 'cost',
    parameters: [
      { name: 'material_cost', type: 'number', description: 'Material cost ($)', required: true },
      { name: 'machining_hours', type: 'number', description: 'Machining time (hours)', required: true },
      { name: 'quantity', type: 'number', description: 'Production quantity', default: 1 },
    ],
  },

  // Simulation Agent Tools
  {
    name: 'run_stress_analysis',
    description: 'Quick FEA stress analysis at critical points',
    agent: 'simulation',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'load_newtons', type: 'number', description: 'Applied load (N)', default: 1000 },
      { name: 'material', type: 'string', description: 'Material for properties', required: true },
    ],
  },
  {
    name: 'run_thermal_analysis',
    description: 'Thermal distribution analysis under operating conditions',
    agent: 'simulation',
    parameters: [
      { name: 'model_id', type: 'string', description: 'Model identifier', required: true },
      { name: 'temp_celsius', type: 'number', description: 'Operating temperature (°C)', default: 200 },
      { name: 'material', type: 'string', description: 'Material for thermal properties', required: true },
    ],
  },
  {
    name: 'check_manufacturability',
    description: 'Score overall manufacturability considering all geometric features',
    agent: 'simulation',
    parameters: [
      { name: 'face_count', type: 'number', description: 'Number of faces', required: true },
      { name: 'hole_count', type: 'number', description: 'Number of holes', required: true },
      { name: 'min_thickness', type: 'number', description: 'Minimum wall thickness (mm)', required: true },
      { name: 'complex_face_ratio', type: 'number', description: 'Ratio of non-planar faces', required: true },
    ],
  },
];

export const AGENT_INFO: Record<AgentType, { name: string; description: string; icon: string }> = {
  geometry: {
    name: 'Geometry Agent',
    description: 'Analyzes CAD topology, extracts features, builds graphs',
    icon: '📐',
  },
  cost: {
    name: 'Cost Agent',
    description: 'Estimates material costs, machining time, total pricing',
    icon: '💰',
  },
  simulation: {
    name: 'Simulation Agent',
    description: 'Runs FEA stress/thermal analysis, manufacturability scoring',
    icon: '🔬',
  },
};
