/**
 * React hook for agent memory operations.
 */

import { useState, useCallback } from 'react';
import {
  storeIssueResolution,
  findSimilarIssues,
  recordFeedback,
  getMemoryStats,
} from '@/lib/memory';
import type { MemorySearchResult, MemoryStats, MemoryFeedback } from '@/lib/memory';
import { useAuth } from './useAuth';

export function useAgentMemory() {
  const { activeTenantId } = useAuth();
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);

  const search = useCallback(async (query: string, successOnly = false) => {
    setSearching(true);
    try {
      const found = await findSimilarIssues(query, {
        tenantId: activeTenantId ?? undefined,
        successOnly,
      });
      setResults(found);
      return found;
    } finally {
      setSearching(false);
    }
  }, [activeTenantId]);

  const store = useCallback(async (
    issue: string,
    resolution: string,
    meta?: { toolsUsed?: string[]; agentTypes?: string[]; tags?: string[]; success?: boolean },
  ) => {
    return storeIssueResolution(issue, resolution, {
      ...meta,
      tenantId: activeTenantId ?? undefined,
    });
  }, [activeTenantId]);

  const feedback = useCallback(async (fb: MemoryFeedback) => {
    return recordFeedback(fb);
  }, []);

  const loadStats = useCallback(async () => {
    const s = await getMemoryStats(activeTenantId ?? undefined);
    setStats(s);
    return s;
  }, [activeTenantId]);

  return { search, store, feedback, loadStats, results, searching, stats };
}
