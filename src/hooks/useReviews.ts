/**
 * useReviews — React hook for supplier reviews.
 */

import { useState, useCallback } from 'react';
import { reviewService } from '@/lib/reviews';
import type {
  SupplierReview,
  ReviewAggregation,
  CreateReviewInput,
  RespondToReviewInput,
} from '@/lib/reviews';

export function useReviews(supplierId?: string) {
  const [reviews, setReviews] = useState<SupplierReview[]>([]);
  const [aggregation, setAggregation] = useState<ReviewAggregation | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReviews = useCallback(async (
    id?: string,
    opts?: { limit?: number; offset?: number; sortBy?: 'newest' | 'highest' | 'lowest' },
  ) => {
    const sid = id ?? supplierId;
    if (!sid) return;
    setLoading(true);
    setError(null);
    try {
      const result = await reviewService.getReviews(sid, opts);
      setReviews(result.reviews);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reviews');
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  const fetchAggregation = useCallback(async (id?: string) => {
    const sid = id ?? supplierId;
    if (!sid) return;
    setLoading(true);
    try {
      const agg = await reviewService.getAggregation(sid);
      setAggregation(agg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch aggregation');
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  const submitReview = useCallback(async (input: CreateReviewInput) => {
    setLoading(true);
    setError(null);
    try {
      const review = await reviewService.createReview(input);
      setReviews((prev) => [review, ...prev]);
      setTotal((prev) => prev + 1);
      return review;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit review';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const respondToReview = useCallback(async (input: RespondToReviewInput) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await reviewService.respondToReview(input);
      setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      return updated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to respond';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    reviews, aggregation, total, loading, error,
    fetchReviews, fetchAggregation, submitReview, respondToReview,
  };
}
