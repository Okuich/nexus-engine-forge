/**
 * Geometry Optimization — Candidate Generators
 *
 * Each generator inspects the current geometry features and
 * proposes specific parametric modifications. Generators are
 * modular and can be enabled/disabled independently.
 */

import type { GeometryFeatureSet, GeometryStats, FaceFeatures } from '@/lib/geometry/types';
import type { CandidateGenerator, Modification, FeatureDelta } from './types';

// ─── Helpers ────────────────────────────────────────────────────

let _modId = 0;
function modId(): string {
  return `mod-${++_modId}-${Date.now().toString(36)}`;
}

function facesAboveCurvature(faces: FaceFeatures[], threshold: number): FaceFeatures[] {
  return faces.filter(f => f.curvatureMax > threshold);
}

function freeformFaces(faces: FaceFeatures[]): FaceFeatures[] {
  return faces.filter(f => f.surfaceClass === 'freeform');
}

function smallFaces(faces: FaceFeatures[], stats: GeometryStats): FaceFeatures[] {
  const avgArea = stats.totalArea / Math.max(stats.totalFaces, 1);
  return faces.filter(f => f.area < avgArea * 0.3);
}

// ─── Thickness Adjustment ───────────────────────────────────────

/**
 * Detects thin-wall regions (high curvature + small area) and
 * proposes thickening them to improve manufacturability.
 */
export const thicknessAdjustment: CandidateGenerator = {
  type: 'thickness_adjustment',
  generate(features, stats, iteration): Modification[] {
    const mods: Modification[] = [];
    const avgArea = stats.totalArea / Math.max(stats.totalFaces, 1);

    // Find thin-wall candidates: high curvature AND small area
    const thinFaces = features.faces.filter(
      f => f.curvatureMean > 0.2 && f.area < avgArea * 0.5,
    );

    if (thinFaces.length === 0) return mods;

    // Progressive thickening: more aggressive on later iterations
    const scaleFactor = 1.5 + iteration * 0.3;

    mods.push({
      id: modId(),
      type: 'thickness_adjustment',
      description: `Increase wall thickness in ${thinFaces.length} thin region(s) by ${((scaleFactor - 1) * 100).toFixed(0)}%`,
      affectedFaces: thinFaces.map(f => f.id),
      delta: {
        areaOffset: avgArea * 0.2 * thinFaces.length,
        curvatureScale: 1 / scaleFactor,
        volumeOffset: thinFaces.length * avgArea * 0.1,
      },
    });

    return mods;
  },
};

// ─── Radius Smoothing ───────────────────────────────────────────

/**
 * Finds tight-radius features (high max curvature) and proposes
 * smoothing/enlarging fillets to reduce machining difficulty.
 */
export const radiusSmoothing: CandidateGenerator = {
  type: 'radius_smoothing',
  generate(features, stats, iteration): Modification[] {
    const mods: Modification[] = [];

    // Progressive threshold: relax on later iterations
    const threshold = Math.max(0.1, 0.25 - iteration * 0.03);
    const tightFaces = facesAboveCurvature(features.faces, threshold);

    if (tightFaces.length === 0) return mods;

    // Propose gentle smoothing
    const smoothFactor = 0.5 - iteration * 0.05;
    mods.push({
      id: modId(),
      type: 'radius_smoothing',
      description: `Smooth ${tightFaces.length} tight-radius feature(s) — enlarge fillets to ≥R${(1 / threshold).toFixed(1)}mm`,
      affectedFaces: tightFaces.map(f => f.id),
      delta: {
        curvatureScale: Math.max(0.3, smoothFactor),
      },
    });

    // If many tight faces, propose aggressive smoothing variant
    if (tightFaces.length > 3) {
      mods.push({
        id: modId(),
        type: 'radius_smoothing',
        description: `Aggressively smooth all ${tightFaces.length} tight-radius features — replace with uniform R3mm fillets`,
        affectedFaces: tightFaces.map(f => f.id),
        delta: {
          curvatureScale: 0.2,
          targetSurfaceClass: 'cylindrical',
        },
      });
    }

    return mods;
  },
};

// ─── Feature Simplification ─────────────────────────────────────

/**
 * Identifies small/complex features that could be removed or
 * simplified to reduce machining cost and improve manufacturability.
 */
export const featureSimplification: CandidateGenerator = {
  type: 'feature_simplification',
  generate(features, stats, _iteration): Modification[] {
    const mods: Modification[] = [];

    // Find small freeform faces that could be simplified to planar
    const smalls = smallFaces(features.faces, stats);
    const freeforms = freeformFaces(features.faces);
    const simplifiable = smalls.filter(f => f.surfaceClass !== 'planar');

    if (simplifiable.length > 0) {
      mods.push({
        id: modId(),
        type: 'feature_simplification',
        description: `Simplify ${simplifiable.length} small complex feature(s) to planar surfaces`,
        affectedFaces: simplifiable.map(f => f.id),
        delta: {
          targetSurfaceClass: 'planar',
          curvatureScale: 0.05,
          complexityScale: Math.max(0.3, 1 - simplifiable.length / stats.totalFaces),
        },
      });
    }

    // Propose removing tiny freeform features
    const tinyFreeforms = freeforms.filter(
      f => f.area < stats.totalArea / stats.totalFaces * 0.15,
    );

    if (tinyFreeforms.length > 0) {
      mods.push({
        id: modId(),
        type: 'feature_simplification',
        description: `Remove ${tinyFreeforms.length} tiny freeform feature(s) below 15% of average face area`,
        affectedFaces: tinyFreeforms.map(f => f.id),
        delta: {
          targetSurfaceClass: 'planar',
          curvatureScale: 0,
          freeformDelta: -tinyFreeforms.length,
        },
      });
    }

    return mods;
  },
};

// ─── Surface Consolidation ──────────────────────────────────────

/**
 * Groups adjacent similar surfaces and proposes merging them
 * to reduce face count and complexity.
 */
export const surfaceConsolidation: CandidateGenerator = {
  type: 'surface_consolidation',
  generate(features, stats, _iteration): Modification[] {
    const mods: Modification[] = [];

    // If many faces of same class, consolidation could simplify
    const dist = stats.surfaceClassDistribution;
    const dominantClass = Object.entries(dist)
      .sort((a, b) => b[1] - a[1])[0];

    if (!dominantClass) return mods;

    const [className, count] = dominantClass;
    const ratio = count / stats.totalFaces;

    // Only propose if there are other surface classes to consolidate
    if (ratio < 0.9 && stats.totalFaces > 4) {
      const nonDominant = features.faces.filter(f => f.surfaceClass !== className);

      if (nonDominant.length > 0 && nonDominant.length < stats.totalFaces * 0.4) {
        mods.push({
          id: modId(),
          type: 'surface_consolidation',
          description: `Consolidate ${nonDominant.length} non-${className} faces into ${className} surfaces`,
          affectedFaces: nonDominant.map(f => f.id),
          delta: {
            targetSurfaceClass: className === 'planar' ? 'planar' : 'cylindrical',
            curvatureScale: className === 'planar' ? 0.05 : 0.5,
            complexityScale: ratio,
          },
        });
      }
    }

    return mods;
  },
};

// ─── Draft Angle Addition ───────────────────────────────────────

/**
 * For injection molding/casting, proposes adding draft angles
 * to vertical faces to improve mold release.
 */
export const draftAngleAddition: CandidateGenerator = {
  type: 'draft_angle_addition',
  generate(features, stats, _iteration): Modification[] {
    const mods: Modification[] = [];

    // Find near-vertical faces (normal nearly perpendicular to Z-axis)
    const verticalFaces = features.faces.filter(f => {
      const nz = Math.abs(f.normal[2]);
      return nz < 0.15; // Nearly vertical
    });

    if (verticalFaces.length === 0) return mods;

    mods.push({
      id: modId(),
      type: 'draft_angle_addition',
      description: `Add 1.5° draft angle to ${verticalFaces.length} vertical face(s) for mold release`,
      affectedFaces: verticalFaces.map(f => f.id),
      delta: {
        curvatureScale: 0.9,
        complexityScale: 0.95,
      },
    });

    return mods;
  },
};

// ─── Generator Registry ─────────────────────────────────────────

export const ALL_GENERATORS: CandidateGenerator[] = [
  thicknessAdjustment,
  radiusSmoothing,
  featureSimplification,
  surfaceConsolidation,
  draftAngleAddition,
];

export function getEnabledGenerators(types: string[]): CandidateGenerator[] {
  return ALL_GENERATORS.filter(g => types.includes(g.type));
}
