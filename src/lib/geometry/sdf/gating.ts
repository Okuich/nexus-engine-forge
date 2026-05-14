/**
 * API gating for the SDF engine.
 *
 * SDF is computationally expensive — surface only to tiers / workloads
 * that justify it: enterprise, large datasets, or assembly workflows.
 *
 * Activation conditions:
 *   • Enterprise tier: always allowed
 *   • Professional tier: allowed for assembly workflows OR ≥ 50k triangles
 *   • Starter tier: blocked unless betaOverride=true
 *   • Hard ceiling: voxel count ≤ 8M (256³) for non-enterprise
 */
import type { SDFGatingContext, SDFGatingDecision } from './types';

const LARGE_DATASET_TRIS = 50_000;
const PRO_VOXEL_LIMIT = 4_000_000;   // ~158³
const STARTER_VOXEL_LIMIT = 262_144; // 64³
const ENTERPRISE_VOXEL_LIMIT = 134_217_728; // 512³

export function checkSDFGate(ctx: SDFGatingContext): SDFGatingDecision {
  if (ctx.betaOverride) return { allowed: true };

  if (ctx.tier === 'enterprise') {
    if (ctx.voxelCount > ENTERPRISE_VOXEL_LIMIT) {
      return {
        allowed: false,
        reason: `Voxel budget exceeded (${ctx.voxelCount.toLocaleString()} > 512³).`,
      };
    }
    return { allowed: true };
  }

  if (ctx.tier === 'professional') {
    const eligible = ctx.isAssembly || ctx.triangleCount >= LARGE_DATASET_TRIS;
    if (!eligible) {
      return {
        allowed: false,
        reason:
          'SDF on Professional requires an assembly workflow or ≥ 50k triangles. ' +
          'Upgrade to Enterprise for unrestricted access.',
        upgradeTo: 'enterprise',
      };
    }
    if (ctx.voxelCount > PRO_VOXEL_LIMIT) {
      return {
        allowed: false,
        reason: `Voxel budget exceeded (${ctx.voxelCount.toLocaleString()} > 4M). Reduce resolution or upgrade.`,
        upgradeTo: 'enterprise',
      };
    }
    return { allowed: true };
  }

  // Starter
  if (ctx.voxelCount > STARTER_VOXEL_LIMIT) {
    return {
      allowed: false,
      reason: 'SDF generation is not available on the Starter tier above 64³ voxels.',
      upgradeTo: 'professional',
    };
  }
  return {
    allowed: false,
    reason: 'SDF generation requires a Professional or Enterprise plan.',
    upgradeTo: 'professional',
  };
}

export class SDFGateError extends Error {
  constructor(public decision: SDFGatingDecision) {
    super(decision.reason ?? 'SDF generation blocked by gating policy.');
    this.name = 'SDFGateError';
  }
}
