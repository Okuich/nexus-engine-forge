/**
 * Workflow Engine — Type Definitions
 *
 * Converts AI agent outputs into structured execution plans
 * with step-by-step timelines, resource allocation, and dependencies.
 */

// ─── Resource Types ──────────────────────────────────────────────

export type ResourceType = 'machine' | 'operator' | 'tool' | 'fixture' | 'inspection' | 'material';

export interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  /** Availability in hours per day */
  availabilityHrs: number;
  /** Hourly cost rate */
  costPerHr: number;
  /** Utilization 0-1 */
  utilization: number;
  /** Capabilities / tags */
  capabilities: string[];
}

// ─── Operation Steps ─────────────────────────────────────────────

export type OperationCategory =
  | 'setup'
  | 'roughing'
  | 'finishing'
  | 'drilling'
  | 'inspection'
  | 'heat-treatment'
  | 'surface-treatment'
  | 'assembly'
  | 'packaging'
  | 'documentation';

export interface OperationStep {
  id: string;
  /** Sequential order */
  sequence: number;
  /** Operation name */
  name: string;
  /** Detailed description */
  description: string;
  /** Category for grouping/coloring */
  category: OperationCategory;
  /** Depends on these step IDs being complete */
  dependsOn: string[];
  /** Assigned resources */
  resources: ResourceAssignment[];
  /** Estimated duration in hours */
  durationHrs: number;
  /** Setup time in hours (included in duration) */
  setupHrs: number;
  /** Scheduled start (offset from plan start, in hours) */
  startOffsetHrs: number;
  /** Scheduled end */
  endOffsetHrs: number;
  /** Cost for this operation */
  costUsd: number;
  /** Quality checkpoint at this step? */
  qualityCheck: QualityCheckpoint | null;
  /** Status */
  status: 'pending' | 'scheduled' | 'in-progress' | 'completed' | 'blocked' | 'skipped';
  /** Notes / warnings */
  notes: string[];
}

export interface ResourceAssignment {
  resourceId: string;
  resourceName: string;
  resourceType: ResourceType;
  /** Hours this resource is needed */
  hoursNeeded: number;
  /** Cost for this assignment */
  costUsd: number;
}

export interface QualityCheckpoint {
  id: string;
  name: string;
  /** Inspection method */
  method: 'cmm' | 'visual' | 'gauge' | 'surface-finish' | 'hardness' | 'dimensional';
  /** Tolerance */
  tolerance: string;
  /** Is this a mandatory hold point? */
  holdPoint: boolean;
}

// ─── Execution Plan ──────────────────────────────────────────────

export interface ExecutionPlan {
  id: string;
  /** Part/job name */
  partName: string;
  /** Material */
  material: string;
  /** Production quantity */
  quantity: number;
  /** Ordered operation steps */
  steps: OperationStep[];
  /** All resources used */
  resources: Resource[];
  /** Timeline summary */
  timeline: TimelineSummary;
  /** Cost summary */
  costSummary: CostSummary;
  /** Risk flags */
  risks: PlanRisk[];
  /** Critical path step IDs */
  criticalPath: string[];
  /** Created timestamp */
  createdAt: string;
  /** Source agent outputs used */
  sourceAgents: string[];
}

export interface TimelineSummary {
  /** Total lead time in business days */
  totalDays: number;
  /** Total machining hours */
  machiningHrs: number;
  /** Total setup hours */
  setupHrs: number;
  /** Total inspection hours */
  inspectionHrs: number;
  /** Idle/queue time in hours */
  idleHrs: number;
  /** Efficiency percentage */
  efficiency: number;
  /** Earliest possible start */
  earliestStart: string;
  /** Estimated completion */
  estimatedCompletion: string;
  /** Gantt data for visualization */
  ganttBars: GanttBar[];
}

export interface GanttBar {
  stepId: string;
  label: string;
  category: OperationCategory;
  startHrs: number;
  endHrs: number;
  isCriticalPath: boolean;
}

export interface CostSummary {
  materialCost: number;
  laborCost: number;
  machineCost: number;
  toolingCost: number;
  inspectionCost: number;
  overheadCost: number;
  totalCost: number;
  costPerUnit: number;
}

export interface PlanRisk {
  id: string;
  severity: 'low' | 'medium' | 'high';
  category: string;
  description: string;
  mitigation: string;
  affectedSteps: string[];
}

// ─── Input from AI Agents ────────────────────────────────────────

export interface AgentOutputs {
  /** From geometry agent */
  geometry?: {
    faceCount: number;
    holeCount: number;
    minThickness: number;
    volume: number;
    complexityScore: number;
    surfaceClasses: string[];
  };
  /** From cost agent */
  cost?: {
    materialCost: number;
    machiningCost: number;
    toolingCost: number;
    totalCost: number;
  };
  /** From simulation agent */
  simulation?: {
    maxStress: number;
    safetyFactor: number;
    criticalRegionCount: number;
    requiresHeatTreatment: boolean;
  };
  /** Part metadata */
  partName: string;
  material: string;
  quantity: number;
  priority: 'standard' | 'rush' | 'critical';
}

// ─── Category Colors for UI ─────────────────────────────────────

export const CATEGORY_COLORS: Record<OperationCategory, string> = {
  'setup': 'hsl(var(--muted-foreground))',
  'roughing': 'hsl(var(--primary))',
  'finishing': 'hsl(var(--accent))',
  'drilling': 'hsl(210, 70%, 55%)',
  'inspection': 'hsl(45, 90%, 55%)',
  'heat-treatment': 'hsl(0, 70%, 55%)',
  'surface-treatment': 'hsl(280, 60%, 55%)',
  'assembly': 'hsl(160, 60%, 45%)',
  'packaging': 'hsl(var(--muted-foreground))',
  'documentation': 'hsl(var(--muted-foreground))',
};
