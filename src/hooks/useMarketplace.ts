/**
 * useMarketplace — React hook for the supplier marketplace.
 */

import { useState, useCallback } from 'react';
import { marketplaceService } from '@/lib/marketplace';
import type {
  RFQ,
  RFQQuote,
  MatchResult,
  CreateRFQRequest,
  SubmitQuoteRequest,
  RankingWeights,
} from '@/lib/marketplace';

interface UseMarketplaceReturn {
  // State
  rfqs: RFQ[];
  activeRFQ: RFQ | null;
  quotes: RFQQuote[];
  matchResult: MatchResult | null;
  loading: boolean;
  error: string | null;

  // RFQ Actions
  createRFQ: (req: CreateRFQRequest) => Promise<RFQ>;
  loadRFQs: (filters?: { status?: string; material?: string }) => Promise<void>;
  selectRFQ: (id: string) => Promise<void>;

  // Supplier Actions
  matchSuppliers: (rfqId: string) => Promise<MatchResult>;
  submitQuote: (supplierId: string, req: SubmitQuoteRequest) => Promise<RFQQuote>;

  // Evaluation Actions
  rankQuotes: (rfqId: string, weights?: RankingWeights) => Promise<RFQQuote[]>;
  awardQuote: (rfqId: string, quoteId: string) => Promise<void>;

  // Utility
  clearError: () => void;
}

export function useMarketplace(): UseMarketplaceReturn {
  const [rfqs, setRFQs] = useState<RFQ[]>([]);
  const [activeRFQ, setActiveRFQ] = useState<RFQ | null>(null);
  const [quotes, setQuotes] = useState<RFQQuote[]>([]);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withLoading = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const createRFQ = useCallback(async (req: CreateRFQRequest) => {
    return withLoading(async () => {
      const rfq = await marketplaceService.createRFQ(req);
      setRFQs((prev) => [rfq, ...prev]);
      return rfq;
    });
  }, [withLoading]);

  const loadRFQs = useCallback(async (filters?: { status?: string; material?: string }) => {
    await withLoading(async () => {
      const data = await marketplaceService.listRFQs(filters);
      setRFQs(data);
    });
  }, [withLoading]);

  const selectRFQ = useCallback(async (id: string) => {
    await withLoading(async () => {
      const rfq = await marketplaceService.getRFQ(id);
      setActiveRFQ(rfq);
      const rfqQuotes = await marketplaceService.getQuotesForRFQ(id);
      setQuotes(rfqQuotes);
    });
  }, [withLoading]);

  const matchSuppliers = useCallback(async (rfqId: string) => {
    return withLoading(async () => {
      const result = await marketplaceService.matchSuppliersForRFQ(rfqId);
      setMatchResult(result);
      return result;
    });
  }, [withLoading]);

  const submitQuote = useCallback(async (supplierId: string, req: SubmitQuoteRequest) => {
    return withLoading(async () => {
      const quote = await marketplaceService.submitQuoteAsSupplier(supplierId, req);
      setQuotes((prev) => [...prev, quote]);
      return quote;
    });
  }, [withLoading]);

  const doRankQuotes = useCallback(async (rfqId: string, weights?: RankingWeights) => {
    return withLoading(async () => {
      const ranked = await marketplaceService.rankQuotesForRFQ(rfqId, weights);
      setQuotes(ranked);
      return ranked;
    });
  }, [withLoading]);

  const awardQuote = useCallback(async (rfqId: string, quoteId: string) => {
    await withLoading(async () => {
      await marketplaceService.awardQuote(rfqId, quoteId);
      if (activeRFQ?.id === rfqId) {
        setActiveRFQ((prev) => prev ? { ...prev, status: 'awarded' } : null);
      }
      setQuotes((prev) =>
        prev.map((q) => ({
          ...q,
          status: q.id === quoteId ? 'accepted' : 'rejected',
        })),
      );
    });
  }, [withLoading, activeRFQ]);

  return {
    rfqs,
    activeRFQ,
    quotes,
    matchResult,
    loading,
    error,
    createRFQ,
    loadRFQs,
    selectRFQ,
    matchSuppliers,
    submitQuote,
    rankQuotes: doRankQuotes,
    awardQuote,
    clearError: () => setError(null),
  };
}
