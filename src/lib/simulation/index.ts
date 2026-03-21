/**
 * Simulation Engine — Public API
 */

export { runSimulation, defaultStructuralConfig, defaultAirflowConfig, sampleColorMap } from './engine';
export type {
  SimulationType,
  SimulationConfig,
  StructuralConfig,
  AirflowConfig,
  SimulationResult,
  StructuralResult,
  AirflowResult,
  SimulationOverlay,
  OverlayField,
  NodeResult,
  CriticalRegion,
  ConvergenceInfo,
  SimulationJob,
  SimulationStatus,
  ColorStop,
} from './types';
export { JET_COLOR_MAP, COOL_WARM_MAP } from './types';
