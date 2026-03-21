/**
 * Midwater Cost Labeling Engine
 *
 * Estimates manufacturing cost from geometry features with
 * itemized breakdowns and correction factor support.
 *
 * Architecture:
 *   GeometryFeatureSet → CostEstimator → CostBreakdown
 *                                       ↕
 *                              CorrectionFactors (from feedback)
 */

import type { GeometryStats, GeometryFeatureSet } from '@/lib/geometry/types';

// ─── Data Models ─────────────────────────────────────────────────

export interface MaterialSpec {
  id: string;
  name: string;
  /** Cost per cm³ */
  costPerCm3: number;
  /** Machinability factor (0–1, lower = harder to machine) */
  machinability: number;
  /** Density g/cm³ */
  density: number;
  /** Hardness factor affecting tool wear */
  toolWearFactor: number;
}

export interface ProcessSpec {
  id: string;
  name: string;
  /** Base setup cost ($) */
  setupCost: number;
  /** Cost per minute of machine time ($) */
  costPerMinute: number;
  /** Minimum cycle time in minutes */
  minCycleTime: number;
}

export interface CostLineItem {
  category: 'material' | 'machining' | 'complexity' | 'setup' | 'finishing' | 'tooling' | 'overhead';
  label: string;
  amount: number;
  /** What drove this cost */
  driver: string;
}

export interface CostBreakdown {
  /** Unique estimate ID */
  estimateId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Total estimated cost */
  totalCost: number;
  /** Per-category subtotals */
  subtotals: Record<CostLineItem['category'], number>;
  /** Itemized line items */
  lineItems: CostLineItem[];
  /** Correction factor applied (1.0 = no correction) */
  correctionFactor: number;
  /** Total before correction */
  rawTotal: number;
  /** Confidence score (0–1) */
  confidence: number;
  /** Input parameters for reproducibility */
  inputs: {
    material: MaterialSpec;
    process: ProcessSpec;
    geometryStats: GeometryStats;
    complexityScore: number;
  };
}

export interface CostFeedback {
  estimateId: string;
  predictedCost: number;
  actualCost: number;
  material: string;
  process: string;
  complexityScore: number;
  notes?: string;
}

export interface CorrectionFactors {
  /** Global correction multiplier */
  global: number;
  /** Per-material correction */
  byMaterial: Record<string, number>;
  /** Per-process correction */
  byProcess: Record<string, number>;
  /** Per-complexity-band correction (low/medium/high) */
  byComplexity: Record<string, number>;
  /** Number of feedback samples used */
  sampleCount: number;
  /** When factors were last computed */
  computedAt: string;
}

// ─── Material & Process Libraries ────────────────────────────────

export const MATERIALS: Record<string, MaterialSpec> = {
  'al-6061': { id: 'al-6061', name: 'Al 6061-T6', costPerCm3: 0.008, machinability: 0.85, density: 2.7, toolWearFactor: 0.3 },
  'al-7075': { id: 'al-7075', name: 'Al 7075-T6', costPerCm3: 0.012, machinability: 0.75, density: 2.81, toolWearFactor: 0.35 },
  'ss-304':  { id: 'ss-304', name: 'SS 304', costPerCm3: 0.025, machinability: 0.45, density: 8.0, toolWearFactor: 0.65 },
  'ss-316':  { id: 'ss-316', name: 'SS 316L', costPerCm3: 0.032, machinability: 0.40, density: 8.0, toolWearFactor: 0.70 },
  'ti-6al4v': { id: 'ti-6al4v', name: 'Ti-6Al-4V', costPerCm3: 0.120, machinability: 0.25, density: 4.43, toolWearFactor: 0.90 },
  'inconel-718': { id: 'inconel-718', name: 'Inconel 718', costPerCm3: 0.180, machinability: 0.15, density: 8.19, toolWearFactor: 0.95 },
  'abs-plastic': { id: 'abs-plastic', name: 'ABS Plastic', costPerCm3: 0.003, machinability: 0.95, density: 1.04, toolWearFactor: 0.05 },
};

export const PROCESSES: Record<string, ProcessSpec> = {
  'cnc-milling':  { id: 'cnc-milling', name: 'CNC Milling', setupCost: 150, costPerMinute: 2.5, minCycleTime: 10 },
  'cnc-turning':  { id: 'cnc-turning', name: 'CNC Turning', setupCost: 100, costPerMinute: 2.0, minCycleTime: 5 },
  'edm':          { id: 'edm', name: 'Wire EDM', setupCost: 200, costPerMinute: 3.5, minCycleTime: 30 },
  'injection':    { id: 'injection', name: 'Injection Molding', setupCost: 5000, costPerMinute: 0.5, minCycleTime: 0.5 },
  'sheet-metal':  { id: 'sheet-metal', name: 'Sheet Metal', setupCost: 120, costPerMinute: 1.8, minCycleTime: 8 },
  '3d-print-fdm': { id: '3d-print-fdm', name: 'FDM 3D Print', setupCost: 20, costPerMinute: 0.3, minCycleTime: 60 },
};

// ─── Cost Estimation Functions ───────────────────────────────────

function estimateMaterialCost(stats: GeometryStats, material: MaterialSpec): CostLineItem[] {
  const items: CostLineItem[] = [];

  // Raw material cost (volume-based with 20% waste factor)
  const wasteFactor = 1.2;
  const bbVolumeCm3 = (stats.boundingBox.diagonal ** 3) * 0.001; // approximate bounding box volume
  const partVolumeCm3 = stats.volume * 0.001; // convert mm³ to cm³
  const stockVolumeCm3 = Math.max(bbVolumeCm3, partVolumeCm3) * wasteFactor;

  items.push({
    category: 'material',
    label: `${material.name} stock`,
    amount: +(stockVolumeCm3 * material.costPerCm3).toFixed(2),
    driver: `${stockVolumeCm3.toFixed(1)} cm³ × $${material.costPerCm3}/cm³ (incl. ${((wasteFactor - 1) * 100).toFixed(0)}% waste)`,
  });

  return items;
}

function estimateMachiningCost(stats: GeometryStats, material: MaterialSpec, process: ProcessSpec): CostLineItem[] {
  const items: CostLineItem[] = [];

  // Machining time = f(surface area, machinability, complexity)
  const surfaceAreaFactor = Math.sqrt(stats.totalArea) * 0.1;
  const complexityMultiplier = 1 + stats.complexityScore * 3;
  const machinabilityPenalty = 1 / Math.max(material.machinability, 0.1);
  const cycleMinutes = Math.max(
    process.minCycleTime,
    surfaceAreaFactor * complexityMultiplier * machinabilityPenalty,
  );

  items.push({
    category: 'machining',
    label: `${process.name} cycle time`,
    amount: +(cycleMinutes * process.costPerMinute).toFixed(2),
    driver: `${cycleMinutes.toFixed(1)} min × $${process.costPerMinute}/min`,
  });

  // Setup cost
  items.push({
    category: 'setup',
    label: `${process.name} setup`,
    amount: process.setupCost,
    driver: 'Fixed setup cost per job',
  });

  return items;
}

function estimateComplexityCost(stats: GeometryStats, material: MaterialSpec): CostLineItem[] {
  const items: CostLineItem[] = [];

  // Surface class penalty: freeform + toroidal surfaces increase cost
  const dist = stats.surfaceClassDistribution;
  const complexFaces = (dist.freeform ?? 0) + (dist.toroidal ?? 0) + (dist.spherical ?? 0);
  const complexRatio = stats.totalFaces > 0 ? complexFaces / stats.totalFaces : 0;

  if (complexRatio > 0.1) {
    const surcharge = +(complexRatio * 100 * (1 + material.toolWearFactor)).toFixed(2);
    items.push({
      category: 'complexity',
      label: 'Complex geometry surcharge',
      amount: surcharge,
      driver: `${(complexRatio * 100).toFixed(0)}% complex surfaces (freeform/toroidal/spherical)`,
    });
  }

  // High curvature variance penalty
  if (stats.curvatureStats.variance > 0.01) {
    const curvatureSurcharge = +(stats.curvatureStats.variance * 500).toFixed(2);
    items.push({
      category: 'complexity',
      label: 'Curvature complexity',
      amount: curvatureSurcharge,
      driver: `Curvature variance ${stats.curvatureStats.variance.toFixed(4)}`,
    });
  }

  // Connected components penalty (multiple bodies → multiple setups)
  if (stats.connectedComponents > 1) {
    items.push({
      category: 'complexity',
      label: 'Multi-body handling',
      amount: +(stats.connectedComponents * 25).toFixed(2),
      driver: `${stats.connectedComponents} connected components`,
    });
  }

  return items;
}

function estimateFinishingCost(stats: GeometryStats): CostLineItem[] {
  const items: CostLineItem[] = [];
  const areaCm2 = stats.totalArea * 0.01;

  if (areaCm2 > 10) {
    items.push({
      category: 'finishing',
      label: 'Deburr & surface finish',
      amount: +(areaCm2 * 0.15).toFixed(2),
      driver: `${areaCm2.toFixed(1)} cm² surface area`,
    });
  }

  return items;
}

function estimateToolingCost(material: MaterialSpec, cycleMinutes: number): CostLineItem[] {
  const toolWear = +(material.toolWearFactor * cycleMinutes * 0.5).toFixed(2);
  if (toolWear < 0.5) return [];

  return [{
    category: 'tooling',
    label: 'Tool wear allocation',
    amount: toolWear,
    driver: `Wear factor ${material.toolWearFactor} × ${cycleMinutes.toFixed(0)} min`,
  }];
}

// ─── Main Estimator ──────────────────────────────────────────────

export interface EstimateOptions {
  materialId: string;
  processId: string;
  /** Override correction factors */
  correctionFactor?: number;
  /** Overhead percentage (default 15%) */
  overheadPct?: number;
  /** Quantity (for amortizing setup costs) */
  quantity?: number;
}

/**
 * Estimate manufacturing cost from extracted geometry features.
 *
 * @param features - Output from extractFeatures()
 * @param options  - Material, process, and estimation options
 * @returns Full cost breakdown with line items
 */
export function estimateCost(
  features: GeometryFeatureSet,
  options: EstimateOptions,
): CostBreakdown {
  const material = MATERIALS[options.materialId];
  if (!material) throw new Error(`Unknown material: ${options.materialId}`);

  const process = PROCESSES[options.processId];
  if (!process) throw new Error(`Unknown process: ${options.processId}`);

  const stats = features.stats;
  const overheadPct = options.overheadPct ?? 0.15;
  const quantity = options.quantity ?? 1;
  const correctionFactor = options.correctionFactor ?? 1.0;

  // Collect all line items
  const lineItems: CostLineItem[] = [
    ...estimateMaterialCost(stats, material),
    ...estimateMachiningCost(stats, material, process),
    ...estimateComplexityCost(stats, material),
    ...estimateFinishingCost(stats),
    ...estimateToolingCost(material, process.minCycleTime),
  ];

  // Amortize setup costs across quantity
  if (quantity > 1) {
    for (const item of lineItems) {
      if (item.category === 'setup') {
        item.amount = +(item.amount / quantity).toFixed(2);
        item.driver += ` (amortized over ${quantity} units)`;
      }
    }
  }

  // Compute subtotals
  const subtotals: Record<CostLineItem['category'], number> = {
    material: 0, machining: 0, complexity: 0,
    setup: 0, finishing: 0, tooling: 0, overhead: 0,
  };

  for (const item of lineItems) {
    subtotals[item.category] += item.amount;
  }

  const preOverhead = Object.values(subtotals).reduce((s, v) => s + v, 0);

  // Add overhead
  const overheadAmount = +(preOverhead * overheadPct).toFixed(2);
  lineItems.push({
    category: 'overhead',
    label: 'General overhead',
    amount: overheadAmount,
    driver: `${(overheadPct * 100).toFixed(0)}% of subtotal`,
  });
  subtotals.overhead = overheadAmount;

  const rawTotal = +(preOverhead + overheadAmount).toFixed(2);
  const totalCost = +(rawTotal * correctionFactor).toFixed(2);

  // Confidence: lower if high complexity or exotic material
  const confidence = Math.max(0.3, Math.min(0.95,
    0.85 - stats.complexityScore * 0.3 - material.toolWearFactor * 0.15
  ));

  return {
    estimateId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    totalCost,
    subtotals,
    lineItems,
    correctionFactor,
    rawTotal,
    confidence: +confidence.toFixed(3),
    inputs: {
      material,
      process,
      geometryStats: stats,
      complexityScore: stats.complexityScore,
    },
  };
}

// ─── Correction Factor Computation ───────────────────────────────

/**
 * Compute correction factors from historical feedback.
 * Uses median ratio (actual / predicted) to reduce outlier sensitivity.
 */
export function computeCorrectionFactors(feedback: CostFeedback[]): CorrectionFactors {
  if (feedback.length === 0) {
    return {
      global: 1.0,
      byMaterial: {},
      byProcess: {},
      byComplexity: {},
      sampleCount: 0,
      computedAt: new Date().toISOString(),
    };
  }

  const ratios = feedback.map((f) => f.actualCost / f.predictedCost);
  const global = median(ratios);

  // Group by material
  const byMaterial: Record<string, number> = {};
  const materialGroups = groupBy(feedback, (f) => f.material);
  for (const [mat, group] of Object.entries(materialGroups)) {
    byMaterial[mat] = median(group.map((f) => f.actualCost / f.predictedCost));
  }

  // Group by process
  const byProcess: Record<string, number> = {};
  const processGroups = groupBy(feedback, (f) => f.process);
  for (const [proc, group] of Object.entries(processGroups)) {
    byProcess[proc] = median(group.map((f) => f.actualCost / f.predictedCost));
  }

  // Group by complexity band
  const byComplexity: Record<string, number> = {};
  const complexityGroups = groupBy(feedback, (f) => complexityBand(f.complexityScore));
  for (const [band, group] of Object.entries(complexityGroups)) {
    byComplexity[band] = median(group.map((f) => f.actualCost / f.predictedCost));
  }

  return {
    global: +global.toFixed(4),
    byMaterial,
    byProcess,
    byComplexity,
    sampleCount: feedback.length,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Select the best correction factor for a given estimate context.
 * Priority: material-specific > process-specific > complexity-band > global
 */
export function selectCorrectionFactor(
  factors: CorrectionFactors,
  materialId: string,
  processId: string,
  complexityScore: number,
): number {
  // Prefer most specific factor with sufficient data
  if (factors.byMaterial[materialId] !== undefined) return factors.byMaterial[materialId];
  if (factors.byProcess[processId] !== undefined) return factors.byProcess[processId];

  const band = complexityBand(complexityScore);
  if (factors.byComplexity[band] !== undefined) return factors.byComplexity[band];

  return factors.global;
}

// ─── Utilities ───────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    (groups[key] ??= []).push(item);
  }
  return groups;
}

function complexityBand(score: number): string {
  if (score < 0.2) return 'low';
  if (score < 0.5) return 'medium';
  return 'high';
}
