/**
 * Manufacturability Metric Space — Type Definitions
 *
 * Represents CAD parts/assemblies as points in a fixed-dimensional
 * manufacturability space so we can retrieve similar manufacturable
 * parts and score feasibility per fabrication process before
 * production begins.
 */

export type FabricationProcess =
  | 'cnc'
  | 'injection-molding'
  | 'additive'
  | 'sheet-metal'
  | 'casting';

export const FABRICATION_PROCESSES: FabricationProcess[] = [
  'cnc',
  'injection-molding',
  'additive',
  'sheet-metal',
  'casting',
];

// ─── Raw CAD inputs ──────────────────────────────────────────────

export interface FeatureCounts {
  holes: number;
  pockets: number;
  bosses: number;
  ribs: number;
  fillets: number;
  chamfers: number;
  threads: number;
  undercuts: number;
}

export interface ToleranceProfile {
  /** Tightest dimensional tolerance in mm (lower = harder) */
  tightestTolMm: number;
  /** Number of features with tolerance <= 0.05 mm */
  precisionFeatureCount: number;
  /** Best surface roughness in microns (Ra), lower = harder */
  bestSurfaceRaUm: number;
  /** GD&T callout count */
  gdtCount: number;
}

export interface SurfaceComplexity {
  /** Surface area in mm^2 */
  surfaceAreaMm2: number;
  /** Count of freeform (NURBS/spline) faces */
  freeformFaceCount: number;
  /** Count of planar faces */
  planarFaceCount: number;
  /** Mean Gaussian curvature magnitude */
  meanCurvature: number;
}

export interface WallThicknessProfile {
  /** Minimum wall thickness in mm */
  minThicknessMm: number;
  /** Mean wall thickness in mm */
  meanThicknessMm: number;
  /** Std deviation of wall thickness */
  thicknessStdMm: number;
}

export interface MaterialSelection {
  /** Generic family */
  family:
    | 'aluminum'
    | 'steel'
    | 'stainless'
    | 'titanium'
    | 'inconel'
    | 'plastic'
    | 'composite'
    | 'other';
  /** Machinability rating 0..1 (1 = easiest) */
  machinability: number;
  /** Hardness on a 0..1 scale relative to tooling capability */
  hardness: number;
  /** Cost per kg in USD */
  costPerKgUsd: number;
}

export interface ToolAccessibility {
  /** Fraction of surface area reachable with 3-axis tooling (0..1) */
  threeAxisCoverage: number;
  /** Required tool length in mm */
  requiredToolLengthMm: number;
  /** Number of distinct setups required */
  setupCount: number;
}

export interface AssemblyComplexity {
  partCount: number;
  fastenerCount: number;
  /** Number of interfaces / mating surfaces */
  interfaceCount: number;
  /** Stack-up tolerance count */
  stackupCount: number;
}

export interface TopologicalComplexity {
  /** Euler characteristic */
  euler: number;
  /** Genus (handle count) */
  genus: number;
  /** Connected component count */
  componentCount: number;
  /** Distinct feature class count */
  featureClassCount: number;
}

export interface CadModel {
  id: string;
  name: string;
  /** Bounding-box volume in mm^3 */
  volumeMm3: number;
  features: FeatureCounts;
  tolerances: ToleranceProfile;
  surface: SurfaceComplexity;
  wall: WallThicknessProfile;
  material: MaterialSelection;
  tooling: ToolAccessibility;
  assembly: AssemblyComplexity;
  topology: TopologicalComplexity;
  /** Intended process if known — used for ranking, not required */
  intendedProcess?: FabricationProcess;
}

// ─── Vector ──────────────────────────────────────────────────────

export const MFG_DIMENSIONS = [
  // Features (8)
  'feat.holes',
  'feat.pockets',
  'feat.bosses',
  'feat.ribs',
  'feat.fillets',
  'feat.chamfers',
  'feat.threads',
  'feat.undercuts',
  // Tolerances (4) — inverted so higher = harder
  'tol.tightnessInv',
  'tol.precisionFeatureCount',
  'tol.surfaceInv',
  'tol.gdtCount',
  // Surface (4)
  'surf.areaLog',
  'surf.freeform',
  'surf.planar',
  'surf.curvature',
  // Wall (3) — min inverted
  'wall.minInv',
  'wall.mean',
  'wall.std',
  // Material (3)
  'mat.machinabilityInv',
  'mat.hardness',
  'mat.costLog',
  // Tooling (3)
  'tool.coverageInv',
  'tool.lengthLog',
  'tool.setups',
  // Assembly (4)
  'asm.parts',
  'asm.fasteners',
  'asm.interfaces',
  'asm.stackups',
  // Topology (4)
  'topo.eulerAbs',
  'topo.genus',
  'topo.components',
  'topo.featureClasses',
  // Volume (1)
  'vol.log',
] as const;

export type MfgDimension = (typeof MFG_DIMENSIONS)[number];
export const MFG_VECTOR_DIM = MFG_DIMENSIONS.length; // 34

export interface ManufacturabilityVector {
  id: string;
  modelId: string;
  /** Normalized [0,1], length = MFG_VECTOR_DIM */
  vector: Float32Array;
  /** Raw (pre-normalization) values for inspection */
  raw: Float32Array;
}

// ─── Outputs ─────────────────────────────────────────────────────

export interface ProcessScore {
  process: FabricationProcess;
  /** 0..100 (higher = better fit) */
  score: number;
  /** Process feasibility 0..1 */
  feasibility: number;
  /** Top reasons that lowered the score */
  reasons: string[];
}

export interface ManufacturabilityEvaluation {
  modelId: string;
  vector: ManufacturabilityVector;
  /** Overall 0..100 manufacturability score */
  score: number;
  /** 0..1 feasibility index across the best-fit process */
  feasibility: number;
  /** Best-fit process */
  recommendedProcess: FabricationProcess;
  /** All process scores, sorted by score desc */
  processScores: ProcessScore[];
  /** Top similar historical parts */
  similarParts: SimilarPart[];
  /** Alternative fabrication methods, sorted by score desc */
  alternatives: ProcessScore[];
  /** Difficulty explanations, highest impact first */
  difficulty: DifficultyExplanation[];
}

export interface SimilarPart {
  modelId: string;
  modelName: string;
  /** Geometric similarity 0..1 */
  geometricSimilarity: number;
  /** Manufacturing-difficulty distance (lower = closer in difficulty) */
  difficultyDistance: number;
  process?: FabricationProcess;
  actualScore?: number;
}

export interface DifficultyExplanation {
  dimension: MfgDimension;
  /** Contribution to difficulty 0..1 */
  impact: number;
  message: string;
}

export interface StoredManufacturablePart {
  vector: ManufacturabilityVector;
  modelName: string;
  process: FabricationProcess;
  actualScore: number;
}

export type DistanceMetric = 'geometric' | 'difficulty';

export interface NearestNeighborOptions {
  k?: number;
  metric?: DistanceMetric;
}
