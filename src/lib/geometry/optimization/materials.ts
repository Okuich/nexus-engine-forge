/**
 * Reference material database for cost / physics estimation.
 * Values are nominal — real specs should override at runtime.
 */
import type { Material, MaterialProps, ManufacturingProcess } from './types';

export const MATERIAL_DB: Record<Material, MaterialProps> = {
  aluminum_6061:    { density: 2700, yieldStrength: 276, youngsModulus: 69,  costPerKg: 6,   machinability: 0.85 },
  steel_1018:       { density: 7870, yieldStrength: 370, youngsModulus: 200, costPerKg: 2,   machinability: 0.70 },
  stainless_304:    { density: 8000, yieldStrength: 215, youngsModulus: 193, costPerKg: 5,   machinability: 0.45 },
  titanium_grade5:  { density: 4430, yieldStrength: 880, youngsModulus: 114, costPerKg: 35,  machinability: 0.25 },
  abs:              { density: 1040, yieldStrength: 40,  youngsModulus: 2.3, costPerKg: 4,   machinability: 0.95 },
  nylon_pa12:       { density: 1010, yieldStrength: 48,  youngsModulus: 1.7, costPerKg: 70,  machinability: 0.95 },
  pla:              { density: 1240, yieldStrength: 50,  youngsModulus: 3.5, costPerKg: 25,  machinability: 0.95 },
};

/** USD per cm^3 process surcharge (machine + labor amortized). */
export const PROCESS_RATE_USD_PER_CM3: Record<ManufacturingProcess, number> = {
  cnc_milling:       0.45,
  cnc_turning:       0.30,
  sheet_metal:       0.18,
  injection_molding: 0.04, // amortized at high volume
  die_casting:       0.08,
  fdm_3d_print:      0.20,
  sls_3d_print:      0.55,
  dmls_metal_print:  3.20,
};

/** Tooling fixed cost (USD) — amortized over annualVolume. */
export const PROCESS_TOOLING_USD: Record<ManufacturingProcess, number> = {
  cnc_milling:       0,
  cnc_turning:       0,
  sheet_metal:       1500,
  injection_molding: 25000,
  die_casting:       40000,
  fdm_3d_print:      0,
  sls_3d_print:      0,
  dmls_metal_print:  0,
};

/** Process-imposed minimum wall thickness (mm). */
export const PROCESS_MIN_WALL_MM: Record<ManufacturingProcess, number> = {
  cnc_milling:       0.8,
  cnc_turning:       0.5,
  sheet_metal:       0.5,
  injection_molding: 1.0,
  die_casting:       1.5,
  fdm_3d_print:      1.2,
  sls_3d_print:      0.7,
  dmls_metal_print:  0.4,
};

/** Process-imposed minimum draft angle (degrees, 0 if none). */
export const PROCESS_MIN_DRAFT_DEG: Record<ManufacturingProcess, number> = {
  cnc_milling:       0,
  cnc_turning:       0,
  sheet_metal:       0,
  injection_molding: 1.5,
  die_casting:       2.0,
  fdm_3d_print:      0,
  sls_3d_print:      0,
  dmls_metal_print:  0,
};
