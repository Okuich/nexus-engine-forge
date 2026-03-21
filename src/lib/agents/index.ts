/**
 * Autonomous Agent System — Public API
 */

// Planner
export { createPlan, analyzeProblem, extractEntities } from './planner';
export type {
  AgentPlan,
  PlanStep,
  StepStatus,
  ProblemAnalysis,
  ExtractedEntities,
  PlannerConfig,
} from './planner';

// Executor
export { executePlan, runAgent } from './executor';
export type {
  ExecutionConfig,
  ExecutionReport,
  AgentRunConfig,
} from './executor';

// Tools (re-export for convenience)
export { executeTool, registerTool, listTools } from '@/lib/tools';

// Memory (re-export for convenience)
export { findSimilarIssues, storeIssueResolution } from '@/lib/memory';

// Existing types & registry
export type { AgentType, AgentDefinition, ToolDefinition } from './types';
export { AGENT_REGISTRY, TOOL_REGISTRY } from './types';
