/**
 * ROI Gating Engine — unified facade enforcing capability priority.
 *
 * Capabilities fire in strict order 1→5. Each tier is gated on:
 *   - the required inputs being present
 *   - prior tiers not having already short-circuited the pipeline
 *   - a minimum estimated ROI uplift threshold
 *
 * The result is a flat, prioritized list of GatedRecommendations
 * suitable for direct rendering or for feeding into agent planners.
 */

import {
  getOperationalStateEngine,
  type OperationalSnapshot,
} from '@/lib/operationalState';
import { evaluateManufacturability } from '@/lib/manufacturability';
import { evaluatePhysicalFeasibility } from '@/lib/physicsConstrained';
import {
  findOptimalPath,
  type OptimizationGoal,
} from '@/lib/optimizationGeometry';
import {
  getAutonomousNavigationEngine,
} from '@/lib/autonomousNavigation';
import {
  CAPABILITY_ORDER,
  type CapabilityDescriptor,
  type GatedRecommendation,
  type RoiGateInputs,
  type RoiGateOptions,
  type RoiGateResult,
} from './types';

const DEFAULTS: Required<RoiGateOptions> = {
  maxPriority: 5,
  shortCircuit: false,
  minRoi: 0.05,
  perTierLimit: 3,
};

function desc(id: CapabilityD