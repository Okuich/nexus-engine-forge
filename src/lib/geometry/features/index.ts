/**
 * Advanced geometry features — public API.
 *
 *   • computeCurvature  — discrete Gaussian + mean (cotangent Laplacian)
 *   • computeThickness  — Shape Diameter Function via inward raycasts
 *   • computeSharpness  — per-edge dihedral sharpness + crease faces
 *   • extractAdvancedFeatures — combined ML-ready feature matrix
 */

export { computeCurvature } from './curvature';
export type { VertexCurvature, FaceCurvature, CurvatureField } from './curvature';

export { computeThickness } from './thickness';
export type { ThicknessOptions, ThicknessResult } from './thickness';

export { computeSharpness } from './sharpness';
export type {
  EdgeSharpness,
  SharpnessOptions,
  SharpnessReport,
} from './sharpness';

export {
  extractAdvancedFeatures,
  featureColumns,
} from './advancedExtractor';
export type {
  AdvancedFeatureOptions,
  AdvancedFeatureSet,
  FeatureColumn,
} from './advancedExtractor';
