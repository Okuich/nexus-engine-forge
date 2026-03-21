/**
 * React hook for the Midwater real-time inference engine.
 */

import { useMutation } from '@tanstack/react-query';
import { runInferenceEngine } from '@/lib/ml/inferenceEngine';
import type { InferenceRequest, ExplainedAssessment } from '@/lib/ml/inferenceEngine';

export function useInferenceEngine() {
  return useMutation({
    mutationFn: (req: InferenceRequest) => runInferenceEngine(req),
  });
}

export type { InferenceRequest, ExplainedAssessment };
