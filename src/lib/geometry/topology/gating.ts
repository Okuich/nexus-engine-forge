/**
 * API gating for the topology optimization engine.
 *
 * Activation conditions:
 *   • Validated physics model with R² ≥ 0.85
 *   • Training samples ≥ 100 (sufficient training data)
 *   • Enterprise tier OR enterpriseWorkflow=true on Professional
 *   • Voxel-count ceilings per tier
 */
import type { TopoGatingContext, TopoGatingDecision } from './types';

const MIN_ACCURACY = 0.85;
const MIN_TRAINING_SAMPLES = 100;
const STARTER_VOXEL_LIMIT = 32_768;     // 32³
const PRO_VOXEL_LIMIT = 1_000_000;      // ~100³
const ENTERPRISE_VOXEL_LIMIT = 16_777_216; // 256³

export function checkTopoGate(ctx: TopoGatingContext): TopoGatingDecision {
  // Physics validation
  if (!ctx.physics.validated) {
    return { allowed: false, reason: 'Underlying physics model is not validated.' };
  }
  if ((ctx.physics.accuracy ?? 0) < MIN_ACCURACY) {
    return {
      allowed: false,
      reason: `Physics model accuracy ${(ctx.physics.accuracy ?? 0).toFixed(2)} below required ${MIN_ACCURACY}.`,
    };
  }
  if ((ctx.physics.trainingSamples ?? 0) < MIN_TRAINING_SAMPLES) {
    return {
      allowed: false,
      reason: `Insufficient training data (${ctx.physics.trainingSamples ?? 0} < ${MIN_TRAINING_SAMPLES} samples).`,
    };
  }

  // Tier-based access
  if (ctx.tier === 'starter') {
    return {
      allowed: false,
      reason: 'Topology optimization requires Professional or Enterprise tier.',
      upgradeTo: 'professional',
    };
  }

  if (ctx.tier === 'professional') {
    if (!ctx.enterpriseWorkflow) {
      return {
        allowed: false,
        reason: 'Topology optimization on Professional requires an enterprise workflow context.',
        upgradeTo: 'enterprise',
      };
    }
    if (ctx.voxelCount > PRO_VOXEL_LIMIT) {
      return {
        allowed: false,
        reason: `Voxel budget exceeded (${ctx.voxelCount.toLocaleString()} > 1M). Reduce resolution or upgrade.`,
        upgradeTo: 'enterprise',
      };
    }
    return { allowed: true };
  }

  // Enterprise
  if (ctx.voxelCount > ENTERPRISE_VOXEL_LIMIT) {
    return { allowed: false, reason: `Voxel budget exceeded (${ctx.voxelCount.toLocaleString()} > 256³).` };
  }
  return { allowed: true };
}

export class TopoGateError extends Error {
  constructor(public decision: TopoGatingDecision) {
    super(decision.reason ?? 'Topology optimization blocked by gating policy.');
    this.name = 'TopoGateError';
  }
}

export const TOPO_GATING_LIMITS = {
  MIN_ACCURACY,
  MIN_TRAINING_SAMPLES,
  STARTER_VOXEL_LIMIT,
  PRO_VOXEL_LIMIT,
  ENTERPRISE_VOXEL_LIMIT,
};
