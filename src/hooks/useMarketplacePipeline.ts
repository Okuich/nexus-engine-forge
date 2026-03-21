/**
 * useMarketplacePipeline — React hook for the full marketplace pipeline.
 *
 * Wraps the orchestrator with React state management and
 * real-time event tracking.
 */

import { useState, useCallback, useRef } from 'react';
import { runMarketplacePipeline } from '@/lib/pipeline/marketplacePipeline';
import type {
  PipelineInput,
  PipelineOutput,
  PipelineStage,
  PipelineEvent,
} from '@/lib/pipeline/marketplacePipeline';

export function useMarketplacePipeline() {
  const [output, setOutput] = useState<PipelineOutput | null>(null);
  const [currentStage, setCurrentStage] = useState<PipelineStage>('idle');
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const run = useCallback(async (input: PipelineInput) => {
    setRunning(true);
    setError(null);
    setEvents([]);
    setOutput(null);
    setCurrentStage('generating_rfq');
    abortRef.current = false;

    try {
      const result = await runMarketplacePipeline(input, (event) => {
        if (abortRef.current) return;
        setEvents((prev) => [...prev, event]);
        if (event.status === 'started') {
          setCurrentStage(event.stage);
        }
      });

      if (!abortRef.current) {
        setOutput(result);
        setCurrentStage(result.status === 'completed' ? 'completed' : 'failed');
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipeline failed';
      setError(msg);
      setCurrentStage('failed');
      throw err;
    } finally {
      setRunning(false);
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    setOutput(null);
    setCurrentStage('idle');
    setEvents([]);
    setRunning(false);
    setError(null);
  }, []);

  return {
    output,
    currentStage,
    events,
    running,
    error,
    run,
    reset,
  };
}
