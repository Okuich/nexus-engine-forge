/**
 * React hook for the self-learning loop.
 *
 * Provides feedback submission, learning context retrieval,
 * and stats for the reinforcement system.
 */

import { useState, useCallback } from 'react';
import {
  submitFeedback,
  buildLearningContext,
  getLearningStats,
} from '@/lib/learning';
import type { RewardSignal, LearningStats } from '@/lib/learning';
import { useAuth } from './useAuth';

export function useLearningLoop() {
  const { activeTenantId } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [lastReward, setLastReward] = useState<RewardSignal | null>(null);

  /** Submit explicit user feedback for a past agent execution. */
  const sendFeedback = useCallback(async (
    executionId: string,
    rating: number,
    satisfied: boolean,
    notes?: string,
  ) => {
    setSubmitting(true);
    try {
      const reward = await submitFeedback(
        executionId, rating, satisfied, notes,
        activeTenantId ?? undefined,
      );
      if (reward) setLastReward(reward);
      return reward;
    } finally {
      setSubmitting(false);
    }
  }, [activeTenantId]);

  /** Get learning-enhanced context for a new query. */
  const getContext = useCallback(async (query: string) => {
    return buildLearningContext(query, activeTenantId ?? undefined);
  }, [activeTenantId]);

  /** Load learning performance stats. */
  const loadStats = useCallback(async () => {
    const s = await getLearningStats(activeTenantId ?? undefined);
    setStats(s);
    return s;
  }, [activeTenantId]);

  return {
    sendFeedback,
    getContext,
    loadStats,
    submitting,
    stats,
    lastReward,
  };
}
