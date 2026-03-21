/**
 * useSimulation — React hook for running simulations
 * and managing simulation state including overlay selection.
 */

import { useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import {
  runSimulation,
  defaultStructuralConfig,
  defaultAirflowConfig,
} from '@/lib/simulation';
import type {
  SimulationConfig,
  SimulationResult,
  SimulationOverlay,
  SimulationJob,
  SimulationStatus,
  OverlayField,
} from '@/lib/simulation';

interface UseSimulationReturn {
  job: SimulationJob | null;
  result: SimulationResult | null;
  activeOverlay: SimulationOverlay | null;
  activeField: OverlayField | null;
  availableOverlays: SimulationOverlay[];
  isRunning: boolean;
  error: string | null;
  runStructural: (fixedFaces?: number[]) => void;
  runAirflow: () => void;
  runCustom: (config: SimulationConfig) => void;
  setActiveField: (field: OverlayField | null) => void;
  clear: () => void;
}

export function useSimulation(): UseSimulationReturn {
  const extractedFeatures = useAppStore((s) => s.extractedFeatures);

  const [job, setJob] = useState<SimulationJob | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [activeField, setActiveFieldState] = useState<OverlayField | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeSimulation = useCallback(async (config: SimulationConfig) => {
    if (!extractedFeatures) {
      setError('No geometry loaded. Upload a CAD file and extract features first.');
      return;
    }

    const jobId = crypto.randomUUID();
    const newJob: SimulationJob = {
      id: jobId,
      config,
      status: 'queued',
      progress: 0,
      result: null,
      error: null,
      createdAt: new Date(),
      completedAt: null,
      durationMs: null,
    };

    setJob(newJob);
    setResult(null);
    setError(null);
    setIsRunning(true);
    setActiveFieldState(null);

    // Simulate progressive status updates
    const updateStatus = (status: SimulationStatus, progress: number) => {
      setJob((j) => j ? { ...j, status, progress } : null);
    };

    try {
      const start = performance.now();

      updateStatus('meshing', 10);
      await delay(300);

      updateStatus('solving', 40);
      await delay(500);

      // Run the actual solver
      const simResult = runSimulation(extractedFeatures, config);

      updateStatus('post-processing', 80);
      await delay(200);

      const durationMs = Math.round(performance.now() - start);

      setResult(simResult);
      setJob((j) => j ? {
        ...j,
        status: 'completed',
        progress: 100,
        result: simResult,
        completedAt: new Date(),
        durationMs,
      } : null);

      // Auto-select the first overlay
      if (simResult.overlays.length > 0) {
        setActiveFieldState(simResult.overlays[0].field);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Simulation failed';
      setError(msg);
      setJob((j) => j ? { ...j, status: 'failed', error: msg } : null);
    } finally {
      setIsRunning(false);
    }
  }, [extractedFeatures]);

  const runStructural = useCallback((fixedFaces?: number[]) => {
    executeSimulation(defaultStructuralConfig(fixedFaces));
  }, [executeSimulation]);

  const runAirflow = useCallback(() => {
    executeSimulation(defaultAirflowConfig());
  }, [executeSimulation]);

  const setActiveField = useCallback((field: OverlayField | null) => {
    setActiveFieldState(field);
  }, []);

  const clear = useCallback(() => {
    setJob(null);
    setResult(null);
    setActiveFieldState(null);
    setError(null);
    setIsRunning(false);
  }, []);

  const activeOverlay = result?.overlays.find((o) => o.field === activeField) ?? null;
  const availableOverlays = result?.overlays ?? [];

  return {
    job,
    result,
    activeOverlay,
    activeField,
    availableOverlays,
    isRunning,
    error,
    runStructural,
    runAirflow,
    runCustom: executeSimulation,
    setActiveField,
    clear,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
