/**
 * React hook for the end-to-end quoting pipeline.
 */

import { useMutation } from '@tanstack/react-query';
import { runPipeline } from '@/lib/pipeline';
import type { PipelineRequest, PipelineResult } from '@/lib/pipeline';

export function useQuotePipeline() {
  return useMutation({
    mutationFn: (req: PipelineRequest) => runPipeline(req),
  });
}

export type { PipelineRequest, PipelineResult };
