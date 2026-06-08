/**
 * Autonomous Operational Navigation — Public API
 *
 * Self-optimizing operating system layer for Midwater: continuously
 * navigates operations toward higher-value regions of state space and
 * autonomously proposes improvements before users request them.
 */

export {
  AutonomousNavigationEngine,
  getAutonomousNavigationEngine,
  nearestStableRegion,
  nearestOptimalRegion,
  recoveryTrajectory,
  optimizationTrajectory,
} from './engine';
export type { EngineOptions } from './engine';

export { discoverBasins } from './basins';
export { detectDrift } from './drift';
export { computeValue, derivePerformance } from './value';

export {
  DEFAULT_MANIFOLD_CONFIG,
} from './types';
export type {
  Basin,
  BasinKind,
  DriftReport,
  DriftSeverity,
  IntegrationHooks,
  ManifoldConfig,
  ManifoldPoint,
  NavigationRecommendation,
  OperationalTrajectory,
  RegionHit,
  TrajectoryPoint,
} from './types';
