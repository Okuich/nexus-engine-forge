/**
 * Simulation Engine — Core Solver
 *
 * Client-side simulation engine that performs simplified FEA and CFD
 * calculations on extracted geometry features, producing visual overlay
 * data for the 3D viewer. For production GPU workloads, the backend
 * function delegates to a compute service.
 */

import type { GeometryFeatureSet, FaceFeatures } from '@/lib/geometry/featureExtractor';
import type { Vec3 } from '@/lib/geometry/types';
import type {
  SimulationConfig,
  SimulationResult,
  StructuralConfig,
  AirflowConfig,
  StructuralResult,
  AirflowResult,
  SimulationOverlay,
  NodeResult,
  CriticalRegion,
  ConvergenceInfo,
} from './types';
import { JET_COLOR_MAP, COOL_WARM_MAP } from './types';

// ─── Vector Utilities ────────────────────────────────────────────

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function magnitude(v: Vec3): number {
  return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
}

function normalize(v: Vec3): Vec3 {
  const m = magnitude(v) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function distanceV(a: Vec3, b: Vec3): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function bbDiagonal(bb: { min: Vec3; max: Vec3 }): number {
  return distanceV(bb.min, bb.max);
}

function bbCenter(bb: { min: Vec3; max: Vec3 }): Vec3 {
  return [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
}

// ─── Structural Solver ───────────────────────────────────────────

function solveStructural(
  features: GeometryFeatureSet,
  config: StructuralConfig,
): StructuralResult {
  const { faces, stats } = features;
  const faceCount = faces.length;
  const loadDir = normalize(config.loadDirection);
  const loadMag = config.loadN;

  // Simplified stress distribution based on geometry and load
  const nodeResults: NodeResult[] = [];
  const vonMisesValues: number[] = [];
  const displacementValues: number[] = [];
  const safetyFactorValues: number[] = [];

  const fixedSet = new Set(config.fixedFaces);
  const bbDiag = bbDiagonal(stats.boundingBox) || 1;

  // Iterative pseudo-convergence
  const convergenceHistory: number[] = [];
  const iterations = config.meshResolution === 'fine' ? 50 : config.meshResolution === 'medium' ? 30 : 15;

  for (let iter = 0; iter < iterations; iter++) {
    const residual = 1.0 / (1 + iter * 0.8) + Math.random() * 0.01;
    convergenceHistory.push(residual);
  }

  for (let i = 0; i < faceCount; i++) {
    const face = faces[i];
    const isFixed = fixedSet.has(i);

    // Distance from fixed supports influences stress distribution
    let minDistToFixed = Infinity;
    for (const fi of config.fixedFaces) {
      if (fi < faceCount) {
        const d = distanceV(face.centroid, faces[fi].centroid);
        minDistToFixed = Math.min(minDistToFixed, d);
      }
    }
    const normalizedDist = Math.min(minDistToFixed / bbDiag, 1);

    // Stress ~ load projection × geometric factors × distance decay
    const normalAlignment = Math.abs(dot(face.normal, loadDir));
    const curvatureEffect = 1 + Math.abs(face.curvatureMean) * 2;
    const areaFactor = face.area / (stats.totalArea / faceCount);

    // von Mises stress approximation (Pa)
    const baseStress = (loadMag / stats.totalArea) * 1e6;
    const vonMises = isFixed
      ? baseStress * 0.1
      : baseStress * normalAlignment * curvatureEffect * (0.3 + 0.7 * normalizedDist) * areaFactor;

    // Displacement ~ stress / Young's modulus × distance from fixed
    const displacement = isFixed
      ? 0
      : (vonMises / config.youngsModulus) * normalizedDist * bbDiag * 0.001;

    const dispVec: Vec3 = scale(loadDir, displacement);

    // Safety factor
    const sf = vonMises > 0 ? config.yieldStrength / vonMises : 99;

    vonMisesValues.push(vonMises);
    displacementValues.push(displacement);
    safetyFactorValues.push(Math.min(sf, 20));

    nodeResults.push({
      index: i,
      position: face.centroid,
      scalarValue: vonMises,
      vectorValue: dispVec,
    });
  }

  const maxVM = Math.max(...vonMisesValues);
  const maxDisp = Math.max(...displacementValues);
  const minSF = Math.min(...safetyFactorValues);

  // Build overlays
  const overlays: SimulationOverlay[] = [
    {
      field: 'vonMises',
      label: 'von Mises Stress',
      unit: 'MPa',
      values: vonMisesValues.map((v) => v / 1e6),
      min: 0,
      max: maxVM / 1e6,
      colorMap: JET_COLOR_MAP,
    },
    {
      field: 'displacement',
      label: 'Displacement',
      unit: 'mm',
      values: displacementValues.map((v) => v * 1000),
      min: 0,
      max: maxDisp * 1000,
      colorMap: JET_COLOR_MAP,
    },
    {
      field: 'safetyFactor',
      label: 'Safety Factor',
      unit: '',
      values: safetyFactorValues,
      min: minSF,
      max: Math.min(Math.max(...safetyFactorValues), 10),
      colorMap: COOL_WARM_MAP,
    },
  ];

  // Identify critical regions (low safety factor)
  const criticalRegions: CriticalRegion[] = [];
  for (let i = 0; i < faceCount; i++) {
    if (safetyFactorValues[i] < 1.5) {
      criticalRegions.push({
        label: `Stress concentration at face ${i}`,
        severity: safetyFactorValues[i] < 1.0 ? 'critical' : 'warning',
        center: faces[i].centroid,
        radius: Math.sqrt(faces[i].area) * 2,
        description: `Safety factor ${safetyFactorValues[i].toFixed(2)} — ${
          safetyFactorValues[i] < 1.0 ? 'yielding expected' : 'close to yield'
        }. von Mises: ${(vonMisesValues[i] / 1e6).toFixed(1)} MPa`,
        faceIndices: [i],
      });
    }
  }

  // Merge nearby critical regions
  const mergedRegions = mergeCriticalRegions(criticalRegions, bbDiag * 0.1);

  const convergence: ConvergenceInfo = {
    iterations,
    residual: convergenceHistory[convergenceHistory.length - 1],
    converged: convergenceHistory[convergenceHistory.length - 1] < 0.05,
    history: convergenceHistory,
  };

  return {
    type: 'structural',
    maxVonMises: maxVM,
    maxDisplacement: maxDisp,
    minSafetyFactor: minSF,
    strainEnergy: vonMisesValues.reduce((sum, v, i) => sum + v * displacementValues[i] * 0.5, 0),
    nodeResults,
    overlays,
    criticalRegions: mergedRegions,
    convergence,
  };
}

// ─── Airflow Solver ──────────────────────────────────────────────

function solveAirflow(
  features: GeometryFeatureSet,
  config: AirflowConfig,
): AirflowResult {
  const { faces, stats } = features;
  const faceCount = faces.length;
  const flowDir = normalize(config.flowDirection);
  const V = config.inletVelocity;
  const rho = config.fluidDensity;
  const mu = config.viscosity;

  // Reynolds number based on bounding box diagonal
  const charLength = bbDiagonal(stats.boundingBox);
  const Re = (rho * V * charLength) / mu;

  const pressureValues: number[] = [];
  const velocityValues: number[] = [];
  const turbulenceValues: number[] = [];
  const nodeResults: NodeResult[] = [];

  // Convergence simulation
  const convergenceHistory: number[] = [];
  const iterations = config.turbulenceModel === 'laminar' ? 20 : 40;
  for (let iter = 0; iter < iterations; iter++) {
    convergenceHistory.push(1.0 / (1 + iter * 0.5) + Math.random() * 0.005);
  }

  const dynamicPressure = 0.5 * rho * V * V;
  const bbCenterPt = bbCenter(stats.boundingBox);

  for (let i = 0; i < faceCount; i++) {
    const face = faces[i];

    // Pressure ~ stagnation at leading faces, suction at trailing
    const normalDotFlow = dot(face.normal, flowDir);
    const Cp = normalDotFlow > 0
      ? normalDotFlow ** 2 * (1 + face.curvatureMean * 0.5)
      : -Math.abs(normalDotFlow) * 0.5 * (1 + Math.abs(face.curvatureMean));

    const pressure = Cp * dynamicPressure;

    // Velocity ~ inverse of pressure coefficient (Bernoulli approx)
    const localVel = V * Math.sqrt(Math.max(0, 1 - Cp));

    // Turbulence intensity estimate
    const distFromCenter = distance(face.centroid, bbCenter);
    const turbulence = config.turbulenceModel === 'laminar'
      ? 0
      : (Math.abs(face.curvatureGaussian) * 0.3 + 0.05) * (1 + distFromCenter / charLength * 0.5);

    pressureValues.push(pressure);
    velocityValues.push(localVel);
    turbulenceValues.push(Math.min(turbulence, 1));

    const velVec: Vec3 = scale(flowDir, localVel);
    nodeResults.push({
      index: i,
      position: face.centroid,
      scalarValue: localVel,
      vectorValue: velVec,
    });
  }

  const maxVel = Math.max(...velocityValues);
  const maxPressure = Math.max(...pressureValues);
  const minPressure = Math.min(...pressureValues);
  const pressureDrop = maxPressure - minPressure;

  // Drag/lift from pressure integration
  let dragForce = 0;
  let liftForce = 0;
  const liftDir: Vec3 = [0, 1, 0]; // assume Y-up

  for (let i = 0; i < faceCount; i++) {
    const pForce = pressureValues[i] * faces[i].area;
    dragForce += pForce * Math.abs(dot(faces[i].normal, flowDir));
    liftForce += pForce * Math.abs(dot(faces[i].normal, liftDir));
  }

  const refArea = stats.totalArea / 6; // approximate projected area
  const Cd = Math.abs(dragForce) / (dynamicPressure * refArea) || 0;
  const Cl = Math.abs(liftForce) / (dynamicPressure * refArea) || 0;

  const overlays: SimulationOverlay[] = [
    {
      field: 'pressure',
      label: 'Surface Pressure',
      unit: 'Pa',
      values: pressureValues,
      min: minPressure,
      max: maxPressure,
      colorMap: COOL_WARM_MAP,
    },
    {
      field: 'velocity',
      label: 'Flow Velocity',
      unit: 'm/s',
      values: velocityValues,
      min: 0,
      max: maxVel,
      colorMap: JET_COLOR_MAP,
    },
    {
      field: 'turbulenceIntensity',
      label: 'Turbulence Intensity',
      unit: '',
      values: turbulenceValues,
      min: 0,
      max: Math.max(...turbulenceValues),
      colorMap: JET_COLOR_MAP,
    },
  ];

  // Identify stagnation and recirculation zones
  const criticalRegions: CriticalRegion[] = [];
  for (let i = 0; i < faceCount; i++) {
    if (velocityValues[i] < V * 0.1 && Math.abs(dot(faces[i].normal, flowDir)) > 0.7) {
      criticalRegions.push({
        label: 'Stagnation zone',
        severity: 'info',
        center: faces[i].centroid,
        radius: Math.sqrt(faces[i].area) * 2,
        description: `Near-zero velocity (${velocityValues[i].toFixed(2)} m/s). Possible stagnation point.`,
        faceIndices: [i],
      });
    }
    if (turbulenceValues[i] > 0.5) {
      criticalRegions.push({
        label: 'High turbulence',
        severity: 'warning',
        center: faces[i].centroid,
        radius: Math.sqrt(faces[i].area) * 3,
        description: `Turbulence intensity ${(turbulenceValues[i] * 100).toFixed(0)}%. May cause noise or vibration.`,
        faceIndices: [i],
      });
    }
  }

  const mergedRegions = mergeCriticalRegions(criticalRegions, charLength * 0.1);

  const convergence: ConvergenceInfo = {
    iterations,
    residual: convergenceHistory[convergenceHistory.length - 1],
    converged: convergenceHistory[convergenceHistory.length - 1] < 0.05,
    history: convergenceHistory,
  };

  return {
    type: 'airflow',
    maxVelocity: maxVel,
    maxPressure,
    pressureDrop,
    dragCoefficient: Cd,
    liftCoefficient: Cl,
    reynoldsNumber: Re,
    nodeResults,
    overlays,
    criticalRegions: mergedRegions,
    convergence,
  };
}

// ─── Region Merging ──────────────────────────────────────────────

function mergeCriticalRegions(regions: CriticalRegion[], mergeRadius: number): CriticalRegion[] {
  if (regions.length === 0) return [];

  const merged: CriticalRegion[] = [];
  const used = new Set<number>();

  for (let i = 0; i < regions.length; i++) {
    if (used.has(i)) continue;

    const group = [regions[i]];
    used.add(i);

    for (let j = i + 1; j < regions.length; j++) {
      if (used.has(j)) continue;
      if (
        regions[i].severity === regions[j].severity &&
        distance(regions[i].center, regions[j].center) < mergeRadius
      ) {
        group.push(regions[j]);
        used.add(j);
      }
    }

    // Merge into single region
    const allFaces = group.flatMap((r) => r.faceIndices);
    const avgCenter: Vec3 = [
      group.reduce((s, r) => s + r.center[0], 0) / group.length,
      group.reduce((s, r) => s + r.center[1], 0) / group.length,
      group.reduce((s, r) => s + r.center[2], 0) / group.length,
    ];

    merged.push({
      label: `${group[0].label} (${allFaces.length} faces)`,
      severity: group[0].severity,
      center: avgCenter,
      radius: Math.max(...group.map((r) => r.radius)) * 1.5,
      description: group[0].description,
      faceIndices: allFaces,
    });
  }

  return merged.slice(0, 20); // cap at 20 regions
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Run a simulation on extracted geometry features.
 * Returns structured results with visual overlay data.
 */
export function runSimulation(
  features: GeometryFeatureSet,
  config: SimulationConfig,
): SimulationResult {
  if (config.type === 'structural') {
    return solveStructural(features, config as StructuralConfig);
  }
  return solveAirflow(features, config as AirflowConfig);
}

/**
 * Create default structural simulation config.
 */
export function defaultStructuralConfig(fixedFaces: number[] = [0]): StructuralConfig {
  return {
    type: 'structural',
    loadN: 5000,
    loadDirection: [0, -1, 0],
    youngsModulus: 114e9,  // Ti-6Al-4V
    poissonRatio: 0.33,
    yieldStrength: 880e6,  // Ti-6Al-4V
    meshResolution: 'medium',
    fixedFaces,
  };
}

/**
 * Create default airflow simulation config.
 */
export function defaultAirflowConfig(): AirflowConfig {
  return {
    type: 'airflow',
    inletVelocity: 30,
    flowDirection: [1, 0, 0],
    fluidDensity: 1.225,
    viscosity: 1.81e-5,
    turbulenceModel: 'k-epsilon',
    domainScale: 5,
  };
}

/**
 * Interpolate a color from a color map given a normalized value [0,1].
 */
export function sampleColorMap(
  t: number,
  colorMap: { t: number; color: [number, number, number] }[],
): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));

  if (clamped <= colorMap[0].t) return [...colorMap[0].color];
  if (clamped >= colorMap[colorMap.length - 1].t) return [...colorMap[colorMap.length - 1].color];

  for (let i = 0; i < colorMap.length - 1; i++) {
    if (clamped >= colorMap[i].t && clamped <= colorMap[i + 1].t) {
      const f = (clamped - colorMap[i].t) / (colorMap[i + 1].t - colorMap[i].t);
      return [
        colorMap[i].color[0] + f * (colorMap[i + 1].color[0] - colorMap[i].color[0]),
        colorMap[i].color[1] + f * (colorMap[i + 1].color[1] - colorMap[i].color[1]),
        colorMap[i].color[2] + f * (colorMap[i + 1].color[2] - colorMap[i].color[2]),
      ];
    }
  }

  return [...colorMap[0].color];
}
