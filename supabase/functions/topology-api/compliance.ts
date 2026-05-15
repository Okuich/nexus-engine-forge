/**
 * Pure compliance evaluator — multi-load-case aggregation logic shared by
 * the REST and GraphQL handlers in `index.ts`. Kept dependency-free so it
 * can be unit-tested without spinning up the Deno HTTP server.
 */

export type V3 = [number, number, number];
export type LoadCaseAggregation = 'weighted-sum' | 'ks';

export interface LoadCondition {
  point: V3;
  force: V3;
  radius?: number;
}

export interface SupportCondition {
  point: V3;
  fixed?: boolean;
  radius?: number;
}

export interface LoadCase {
  name?: string;
  loads: LoadCondition[];
  supports?: SupportCondition[];
  weight?: number;
}

export interface ComplianceRequest {
  loadCases: LoadCase[];
  loadCaseAggregation?: LoadCaseAggregation;
  ksRho?: number;
  supports?: SupportCondition[];
}

export interface PerCaseEntry {
  name: string;
  weight: number;
  compliance: number;
}

export interface ComplianceResult {
  perCaseCompliance: number[];
  perCase: PerCaseEntry[];
  loadCaseAggregation: LoadCaseAggregation;
  ksRho?: number;
  aggregatedCompliance: number;
  surrogate: true;
}

/**
 * Per-case compliance surrogate: Σ‖F‖² scaled by 1 / max(1, supportCount).
 * Placeholder until the SIMP solver runs server-side; preserves units
 * (energy-like) and the aggregation contract used by `runSIMP`.
 */
export function computePerCaseCompliance(req: ComplianceRequest): number[] {
  const topSupports = req.supports?.length ?? 0;
  return req.loadCases.map((c) => {
    const supports = c.supports?.length ?? topSupports;
    const denom = Math.max(1, supports);
    let energy = 0;
    for (const ld of c.loads) {
      const [fx, fy, fz] = ld.force;
      energy += fx * fx + fy * fy + fz * fz;
    }
    return energy / denom;
  });
}

export function aggregate(
  perCase: number[],
  weights: number[],
  mode: LoadCaseAggregation,
  ksRho: number,
): number {
  if (mode === 'ks') {
    const scaled = perCase.map((c, i) => ksRho * weights[i] * c);
    const M = scaled.reduce((m, v) => Math.max(m, v), -Infinity);
    if (!Number.isFinite(M)) return 0;
    let denom = 0;
    for (const s of scaled) denom += Math.exp(s - M);
    return (Math.log(denom) + M) / ksRho;
  }
  let acc = 0;
  for (let i = 0; i < perCase.length; i++) acc += weights[i] * perCase[i];
  return acc;
}

export function evaluateCompliance(req: ComplianceRequest): ComplianceResult {
  const mode: LoadCaseAggregation = req.loadCaseAggregation ?? 'weighted-sum';
  const ksRho = req.ksRho ?? 8;
  const perCaseCompliance = computePerCaseCompliance(req);
  const weights = req.loadCases.map((c) => c.weight ?? 1);
  const aggregated = aggregate(perCaseCompliance, weights, mode, ksRho);
  const perCase: PerCaseEntry[] = req.loadCases.map((c, i) => ({
    name: c.name ?? `case_${i}`,
    weight: weights[i],
    compliance: perCaseCompliance[i],
  }));
  return {
    perCaseCompliance,
    perCase,
    loadCaseAggregation: mode,
    ksRho: mode === 'ks' ? ksRho : undefined,
    aggregatedCompliance: aggregated,
    surrogate: true,
  };
}
