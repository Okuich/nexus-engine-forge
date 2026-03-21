/**
 * React hook for the geometry optimization engine.
 */

import { useMutation } from '@tanstack/react-query';
import { runOptimization } from '@/lib/optimization';
import type { OptimizationConfig, OptimizationResult } from '@/lib/optimization';
import type { GeometryFeatureSet } from '@/lib/geometry/types';
import { DEFAULT_OPTIMIZATION_CONFIG } from '@/lib/optimization';

interface OptimizeRequest {
  features: GeometryFeatureSet;
  config?: Partial<OptimizationConfig>;
  materialId: string;
  processId: string;
}

export function useOptimization() {
  return useMutation({
    mutationFn: (req: OptimizeRequest): Promise<OptimizationResult> => {
      const config: OptimizationConfig = {
        ...DEFAULT_OPTIMIZATION_CONFIG,
        ...req.config,
        materialId: req.materialId,
        processId: req.processId,
      };
      // Run synchronously but wrap in promise for react-query
      return Promise.resolve(runOptimization(req.features, config));
    },
  });
}

export type { OptimizeRequest, OptimizationResult };
