/**
 * Advanced Geometry Feature Extractor.
 *
 * Combines curvature, thickness, and edge sharpness into a single
 * ML-ready per-face feature matrix. Each row is an 8-dim vector:
 *
 *   [0] gaussianCurvature
 *   [1] meanCurvature
 *   [2] principalK1
 *   [3] principalK2
 *   [4] thickness        (NaN → −1 sentinel)
 *   [5] sharpnessAbs     ∈ [0, 1]
 *   [6] sharpnessSigned  ∈ [-1, 1] — face's max-magnitude incident
 *   [7] isCrease         ∈ {0, 1}
 *
 * Plus aggregate statistics suitable for prompt context or model
 * conditioning vectors.
 */

import type { RawMesh } from '../types';
import { computeCurvature, type CurvatureField } from './curvature';
import { computeThickness, type ThicknessOptions, type ThicknessResult } from './thickness';
import { computeSharpness, type SharpnessOptions, type SharpnessReport } from './sharpness';
import {
  extractSDFFeatures,
  SDF_FEATURE_COLUMNS,
  type SDFFeatureOptions,
  type SDFFeatureSet,
} from './sdfFeatures';

export interface AdvancedFeatureOptions {
  thickness?: ThicknessOptions | false;
  sharpness?: SharpnessOptions;
  /** Replace NaN thickness with this sentinel value. Default −1. */
  thicknessNaNSentinel?: number;
  /**
   * When set, the SDF feature engine runs and appends 4 columns
   * (`sdfCentroidDist`, `sdfShellThickness`, `sdfGradAlignment`,
   * `sdfVertexMinDist`) to the per-face matrix.
   *
   * Pass `true` for defaults, an options object to customize, or omit/false
   * to skip SDF integration.
   */
  sdf?: SDFFeatureOptions | boolean;
}

export interface AdvancedFeatureSet {
  /**
   * Per-face feature matrix. 8 base columns; +4 if SDF is enabled.
   * Use `featureColumnsFor(opts)` to get the matching column names.
   */
  matrix: number[][];
  curvature: CurvatureField;
  thickness: ThicknessResult | null;
  sharpness: SharpnessReport;
  /** Present only when SDF integration was requested. */
  sdf: SDFFeatureSet | null;
  stats: {
    faces: number;
    meanGaussian: number;
    meanMean: number;
    meanThickness: number;
    creaseRatio: number;
    sharpnessMean: number;
    /** Present only when SDF integration was requested. */
    sdf?: SDFFeatureSet['stats'];
  };
}

const BASE_FEATURE_COLUMNS = [
  'gaussianCurvature',
  'meanCurvature',
  'principalK1',
  'principalK2',
  'thickness',
  'sharpnessAbs',
  'sharpnessSigned',
  'isCrease',
] as const;

const FEATURE_COLUMNS = BASE_FEATURE_COLUMNS;

export type FeatureColumn =
  | (typeof BASE_FEATURE_COLUMNS)[number]
  | (typeof SDF_FEATURE_COLUMNS)[number];
export const featureColumns: readonly FeatureColumn[] = FEATURE_COLUMNS;

/** Returns the matching column list for the requested option set. */
export function featureColumnsFor(opts: AdvancedFeatureOptions = {}): readonly FeatureColumn[] {
  return opts.sdf
    ? [...BASE_FEATURE_COLUMNS, ...SDF_FEATURE_COLUMNS]
    : BASE_FEATURE_COLUMNS;
}

export function extractAdvancedFeatures(
  mesh: RawMesh,
  opts: AdvancedFeatureOptions = {},
): AdvancedFeatureSet {
  const curvature = computeCurvature(mesh);
  const sharpness = computeSharpness(mesh, opts.sharpness);
  const thickness = opts.thickness === false ? null : computeThickness(mesh, opts.thickness);
  const sentinel = opts.thicknessNaNSentinel ?? -1;

  const faces = curvature.perFace.length;
  const matrix: number[][] = new Array(faces);
  let sumGauss = 0, sumMean = 0, sumThk = 0, thkCount = 0, sumSharp = 0, creaseFaces = 0;

  for (let f = 0; f < faces; f++) {
    const cf = curvature.perFace[f];
    const t = thickness ? thickness.thickness[f] : NaN;
    const tVal = Number.isFinite(t) ? t : sentinel;
    const sa = sharpness.perFaceSharpness[f] ?? 0;
    const isCrease = sharpness.perFaceCrease[f] ? 1 : 0;
    // Signed sharpness: pull strongest incident from the edge list (cheap O(E) pre-pass would be better; this stays O(F))
    const ss = signedSharpForFace(sharpness, f);

    matrix[f] = [
      cf.gaussian,
      cf.mean,
      cf.k1,
      cf.k2,
      tVal,
      sa,
      ss,
      isCrease,
    ];

    sumGauss += cf.gaussian;
    sumMean += cf.mean;
    sumSharp += sa;
    if (Number.isFinite(t)) { sumThk += t; thkCount++; }
    if (isCrease) creaseFaces++;
  }

  return {
    matrix,
    curvature,
    thickness,
    sharpness,
    stats: {
      faces,
      meanGaussian: faces ? sumGauss / faces : 0,
      meanMean: faces ? sumMean / faces : 0,
      meanThickness: thkCount ? sumThk / thkCount : 0,
      creaseRatio: faces ? creaseFaces / faces : 0,
      sharpnessMean: faces ? sumSharp / faces : 0,
    },
  };
}

// ─── Internals ──────────────────────────────────────────────────

function signedSharpForFace(report: SharpnessReport, faceIndex: number): number {
  let best = 0;
  let bestAbs = -1;
  for (const e of report.edges) {
    if (e.faceA !== faceIndex && e.faceB !== faceIndex) continue;
    if (e.sharpness > bestAbs) {
      bestAbs = e.sharpness;
      best = e.signedSharpness;
    }
  }
  return best;
}
