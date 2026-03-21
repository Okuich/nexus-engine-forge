/**
 * useTrustScore — React hook for supplier trust scoring.
 */

import { useState, useCallback } from 'react';
import { trustService } from '@/lib/trust';
import type { TrustScoreResult, SupplierTrustScore, RecordEventInput } from '@/lib/trust';

export function useTrustScore() {
  const [score, setScore] = useState<TrustScoreResult | null>(null);
  const [scores, setScores] = useState<SupplierTrustScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getScore = useCallback(async (supplierId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await trustService.getScore(supplierId);
      setScore(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to get trust score';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const recordEvent = useCallback(async (input: RecordEventInput) => {
    setLoading(true);
    setError(null);
    try {
      const result = await trustService.recordEvent(input);
      setScore(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to record event';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const listScores = useCallback(async (tier?: string) => {
    setLoading(true);
    setError(null);
    try {
      const results = await trustService.listScores(tier);
      setScores(results);
      return results;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list scores';
      setError(msg);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const recalculate = useCallback(async (supplierId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await trustService.recalculate(supplierId);
      setScore(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to recalculate';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { score, scores, loading, error, getScore, recordEvent, listScores, recalculate };
}
