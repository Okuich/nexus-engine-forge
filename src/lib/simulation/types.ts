/**
 * Simulation Engine — Type Definitions
 *
 * Types for structural (FEA) and airflow (CFD) simulation,
 * including visual overlay data for 3D rendering.
 */

// ─── Simulation Configuration ────────────────────────────────────

export type SimulationType = 'structural' | 'airflow';

export interface StructuralConfig {
  type: 'structural';
  /** Applied load in Newtons */
  loadN: number;
  /** Load direction unit vector */
  loadDirection: [number, number, number];
  /** Material Young's modulus (Pa) */
  youngsModulus: number;
  /** Poisson's ratio */
  poissonRatio: number;
  /** Material yield strength (Pa) */
  yieldStrength: number;
  /** Mesh refinement level */
  meshResolution: 'coarse' | 'medium' | 'fine';
  /** Fixed boundary face indices */
  fixedFaces: number[];
}

export interface AirflowConfig {
  type: 'airflow';
  /** Inlet velocity (m/s) */
  inletVelocity: number;
  /** Flow direction unit vector */
  flowDirection: [number, number, number];
  /** Fluid density (kg/m³) */
  fluidDensity: number;
  /** Dynamic viscosity (Pa·s) */
  viscosity: number;
  /** Turbulence model */
  turbulenceModel: 'laminar' | 'k-epsilon' | 'k-omega-sst';
  /** Domain size multiplier relative to bounding box */
  domainScale: number;
}

export type SimulationConfig = StructuralConfig | AirflowConfig;

// ─── Per-Node Result Data ────────────────────────────────────────

export interface NodeResult {
  /** Node/face index */
  index: number;
  /** Position [x, y, z] */
  position: [number, number, number];
  /** Scalar field value (stress, pressure, velocity magnitude, etc.) */
  scalarValue: number;
  /** Vector field value (displacement, velocity) */
  vectorValue: [number, number, number];
}

// ─── Overlay Data for 3D Visualization ───────────────────────────

export type OverlayField =
  | 'vonMises'
  | 'displacement'
  | 'safetyFactor'
  | 'pressure'
  | 'velocity'
  | 'turbulenceIntensity';

export interface SimulationOverlay {
  /** Which scalar field this overlay represents */
  field: OverlayField;
  /** Display name */
  label: string;
  /** Unit string */
  unit: string;
  /** Per-face scalar values, indexed by face ID */
  values: number[];
  /** Min value in the field */
  min: number;
  /** Max value in the field */
  max: number;
  /** Color map stops for the legend */
  colorMap: ColorStop[];
}

export interface ColorStop {
  /** Normalized position 0-1 */
  t: number;
  /** Color as [r, g, b] 0-1 */
  color: [number, number, number];
}

// ─── Simulation Results ──────────────────────────────────────────

export interface StructuralResult {
  type: 'structural';
  /** Max von Mises stress (Pa) */
  maxVonMises: number;
  /** Max displacement magnitude (m) */
  maxDisplacement: number;
  /** Minimum safety factor */
  minSafetyFactor: number;
  /** Total strain energy (J) */
  strainEnergy: number;
  /** Per-node results */
  nodeResults: NodeResult[];
  /** Visual overlays for the 3D viewer */
  overlays: SimulationOverlay[];
  /** Critical regions requiring attention */
  criticalRegions: CriticalRegion[];
  /** Convergence info */
  convergence: ConvergenceInfo;
}

export interface AirflowResult {
  type: 'airflow';
  /** Max velocity (m/s) */
  maxVelocity: number;
  /** Max pressure (Pa) */
  maxPressure: number;
  /** Pressure drop across part (Pa) */
  pressureDrop: number;
  /** Drag coefficient */
  dragCoefficient: number;
  /** Lift coefficient */
  liftCoefficient: number;
  /** Reynolds number */
  reynoldsNumber: number;
  /** Per-node results */
  nodeResults: NodeResult[];
  /** Visual overlays */
  overlays: SimulationOverlay[];
  /** Recirculation/stagnation zones */
  criticalRegions: CriticalRegion[];
  /** Convergence info */
  convergence: ConvergenceInfo;
}

export type SimulationResult = StructuralResult | AirflowResult;

export interface CriticalRegion {
  /** Descriptive label */
  label: string;
  /** Severity */
  severity: 'info' | 'warning' | 'critical';
  /** Center position */
  center: [number, number, number];
  /** Approximate radius */
  radius: number;
  /** Explanation */
  description: string;
  /** Affected face indices */
  faceIndices: number[];
}

export interface ConvergenceInfo {
  /** Number of iterations run */
  iterations: number;
  /** Final residual */
  residual: number;
  /** Whether solution converged */
  converged: boolean;
  /** Convergence history (residual per iteration) */
  history: number[];
}

// ─── Job Integration ─────────────────────────────────────────────

export type SimulationStatus = 'queued' | 'meshing' | 'solving' | 'post-processing' | 'completed' | 'failed';

export interface SimulationJob {
  id: string;
  config: SimulationConfig;
  status: SimulationStatus;
  progress: number;
  result: SimulationResult | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  /** Duration in ms */
  durationMs: number | null;
}

// ─── Color Maps ──────────────────────────────────────────────────

/** Jet color map (blue → cyan → green → yellow → red) */
export const JET_COLOR_MAP: ColorStop[] = [
  { t: 0.0, color: [0.0, 0.0, 0.5] },
  { t: 0.125, color: [0.0, 0.0, 1.0] },
  { t: 0.375, color: [0.0, 1.0, 1.0] },
  { t: 0.625, color: [1.0, 1.0, 0.0] },
  { t: 0.875, color: [1.0, 0.0, 0.0] },
  { t: 1.0, color: [0.5, 0.0, 0.0] },
];

/** Cool-warm diverging color map */
export const COOL_WARM_MAP: ColorStop[] = [
  { t: 0.0, color: [0.23, 0.3, 0.75] },
  { t: 0.5, color: [0.87, 0.87, 0.87] },
  { t: 1.0, color: [0.71, 0.02, 0.15] },
];
