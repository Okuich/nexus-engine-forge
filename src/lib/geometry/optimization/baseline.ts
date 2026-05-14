/**
 * Baseline geometric + cost analysis.
 *
 * Volume via signed-tetrahedron sum, area via triangle areas.
 * Cost = material cost + process rate × volume + amortized tooling.
 */
import type { RawMesh } from '../core/meshGenerator';
import { triangleArea } from '../meshMath';
import type { Material, ManufacturingProcess, OptimizationContext } from './types';
import {
  MATERIAL_DB,
  PROCESS_RATE_USD_PER_CM3,
  PROCESS_TOOLING_USD,
} from './materials';

export interface BaselineMetrics {
  volumeMm3: number;
  surfaceAreaMm2: number;
  massG: number;
  estUnitCostUsd: number;
  estSafetyFactor: number;
}

export function computeVolume(mesh: RawMesh): number {
  const { positions, indices } = mesh;
  let v = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    v += (ax * (by * cz - bz * cy) + bx * (cy * az - cy * 0 - cz * ay) + cx * (ay * bz - az * by)) / 6;
  }
  return Math.abs(v);
}

export function computeSurfaceArea(mesh: RawMesh): number {
  const { positions, indices } = mesh;
  let s = 0;
  for (let i = 0; i < indices.length; i += 3) {
    s += triangleArea(positions, indices[i], indices[i + 1], indices[i + 2]);
  }
  return s;
}

export function estimateUnitCost(
  volumeMm3: number,
  material: Material,
  process: ManufacturingProcess,
  annualVolume = 1000,
): number {
  const props = MATERIAL_DB[material];
  const volumeCm3 = volumeMm3 / 1000;
  const massKg = (volumeMm3 * 1e-9) * props.density;
  const matCost = massKg * props.costPerKg;
  const procCost = volumeCm3 * PROCESS_RATE_USD_PER_CM3[process] / Math.max(0.1, props.machinability);
  const tooling = PROCESS_TOOLING_USD[process] / Math.max(1, annualVolume);
  return matCost + procCost + tooling;
}

/**
 * Crude safety-factor estimate using a uniform-stress proxy:
 *   stress ≈ load / characteristic_area, FoS = yield / stress.
 * This is intentionally fast — full FEA lives in the simulation engine.
 */
export function estimateSafetyFactor(
  surfaceAreaMm2: number,
  material: Material,
  peakLoadN = 1000,
): number {
  const props = MATERIAL_DB[material];
  const charAreaMm2 = Math.max(1, surfaceAreaMm2 * 0.05); // ~5% load-bearing
  const stressMpa = peakLoadN / charAreaMm2; // N/mm² = MPa
  return props.yieldStrength / Math.max(0.01, stressMpa);
}

export function computeBaseline(mesh: RawMesh, ctx: OptimizationContext): BaselineMetrics {
  const volumeMm3 = computeVolume(mesh);
  const surfaceAreaMm2 = computeSurfaceArea(mesh);
  const props = MATERIAL_DB[ctx.material];
  const massG = (volumeMm3 * 1e-9) * props.density * 1000;
  const estUnitCostUsd = estimateUnitCost(
    volumeMm3,
    ctx.material,
    ctx.process,
    ctx.cost?.annualVolume ?? 1000,
  );
  const estSafetyFactor = estimateSafetyFactor(
    surfaceAreaMm2,
    ctx.material,
    ctx.physics?.peakLoadN ?? 1000,
  );
  return { volumeMm3, surfaceAreaMm2, massG, estUnitCostUsd, estSafetyFactor };
}
