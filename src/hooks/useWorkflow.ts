/**
 * useWorkflow — React hook for generating and managing execution plans.
 */

import { useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { generateExecutionPlan } from '@/lib/workflow';
import type { ExecutionPlan, AgentOutputs } from '@/lib/workflow';

interface UseWorkflowReturn {
  plan: ExecutionPlan | null;
  isGenerating: boolean;
  error: string | null;
  /** Generate plan from current analysis results in the store */
  generateFromAnalysis: () => void;
  /** Generate plan from custom agent outputs */
  generateFromOutputs: (outputs: AgentOutputs) => void;
  /** Clear current plan */
  clear: () => void;
}

export function useWorkflow(): UseWorkflowReturn {
  const analysisResult = useAppStore((s) => s.analysisResult);
  const uploadedFile = useAppStore((s) => s.uploadedFile);

  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateFromOutputs = useCallback((outputs: AgentOutputs) => {
    setIsGenerating(true);
    setError(null);

    try {
      const executionPlan = generateExecutionPlan(outputs);
      setPlan(executionPlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate execution plan');
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const generateFromAnalysis = useCallback(() => {
    if (!analysisResult) {
      setError('No analysis results available. Run an analysis first.');
      return;
    }

    const outputs: AgentOutputs = {
      partName: uploadedFile?.name?.replace(/\.\w+$/, '') ?? 'Part',
      material: 'Ti-6Al-4V',
      quantity: 1,
      priority: 'standard',
      geometry: {
        faceCount: analysisResult.geometry.faces,
        holeCount: analysisResult.geometry.holes,
        minThickness: analysisResult.geometry.minThickness,
        volume: analysisResult.geometry.volume,
        complexityScore: 100 - analysisResult.manufacturability,
        surfaceClasses: ['planar', 'cylindrical', 'freeform'],
      },
      cost: {
        materialCost: analysisResult.cost.material,
        machiningCost: analysisResult.cost.machining,
        toolingCost: analysisResult.cost.tooling,
        totalCost: analysisResult.cost.total,
      },
      simulation: {
        maxStress: 450,
        safetyFactor: analysisResult.manufacturability > 70 ? 2.1 : 1.3,
        criticalRegionCount: analysisResult.risks.filter((r) => r.severity === 'high' || r.severity === 'critical').length,
        requiresHeatTreatment: analysisResult.risks.some((r) => r.description.toLowerCase().includes('stress') || r.description.toLowerCase().includes('thermal')),
      },
    };

    generateFromOutputs(outputs);
  }, [analysisResult, uploadedFile, generateFromOutputs]);

  const clear = useCallback(() => {
    setPlan(null);
    setError(null);
  }, []);

  return {
    plan,
    isGenerating,
    error,
    generateFromAnalysis,
    generateFromOutputs,
    clear,
  };
}
