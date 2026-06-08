/**
 * Operational Optimization Geometry — Public API
 *
 * Industrial GPS: treats operations as movement through the
 * Operational State Metric Space and computes optimal multi-step
 * trajectories rather than single-action recommendations.
 */

export {
  OptimizationGeometryEngine,
  getOptimizationGeometryEngine,
  findOptimalPath,
  DEFAULT_WEIGHTS,
} from './engine';

export { resolveWeights } from './cost';
export { OperationalGraphBuilder, aStarPath, aggregateCost, predictOutcome, aggregateRisk, buildOptimalPath } from './graph';

export type {
  OptimizationGoal,
  CostWeights,
  EdgeCost,
  OptimizationNode,
  OptimizationEdge,
  OptimizationGraph,
  TrajectoryAction,
  ActionKind,
  ActionDelta,
  PredictedOutcome,
  RiskEstimate,
  OptimalPath,
  FindPathOptions,
  PathStep,
} from './types';
