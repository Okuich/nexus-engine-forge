/**
 * Supplier Reviews — Service Layer
 *
 * CRUD + aggregation for supplier reviews.
 * Integrates with trust scoring on review creation.
 */

import { supabase } from '@/integrations/supabase/client';
import { trustService } from '@/lib/trust';
import {
  createReviewSchema,
  respondToReviewSchema,
  type CreateReviewInput,
  type RespondToReviewInput,
  type SupplierReview,
  type ReviewAggregation,
} from './types';

// ─── Helpers ────────────────────────────────────────────────────

function rowToReview(row: Record<string, unknown>): SupplierReview {
  return {
    id: row.id as string,
    supplierId: row.supplier_id as string,
    reviewerId: row.reviewer_id as string,
    orderId: (row.order_id as string) ?? null,
    rating: Number(row.rating),
    title: (row.title as string) ?? null,
    comment: (row.comment as string) ?? null,
    response: (row.response as string) ?? null,
    respondedAt: (row.responded_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── Service ────────────────────────────────────────────────────

export const reviewService = {
  /** Submit a review for a supplier. */
  async createReview(input: CreateReviewInput): Promise<SupplierReview> {
    const validated = createReviewSchema.parse(input);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data, error } = await supabase
      .from('supplier_reviews')
      .insert({
        supplier_id: validated.supplierId,
        reviewer_id: user.id,
        order_id: validated.orderId ?? null,
        rating: validated.rating,
        title: validated.title ?? null,
        comment: validated.comment ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create review: ${error.message}`);

    // Update trust score with new rating
    try {
      await trustService.recordEvent({
        supplierId: validated.supplierId,
        event: { type: 'rating_received', rating: validated.rating / 5 },
      });
    } catch {
      // Non-blocking: trust update failure shouldn't fail review creation
    }

    return rowToReview(data as Record<string, unknown>);
  },

  /** Supplier responds to a review. */
  async respondToReview(input: RespondToReviewInput): Promise<SupplierReview> {
    const validated = respondToReviewSchema.parse(input);

    const { data, error } = await supabase
      .from('supplier_reviews')
      .update({
        response: validated.response,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', validated.reviewId)
      .select()
      .single();

    if (error) throw new Error(`Failed to respond to review: ${error.message}`);
    return rowToReview(data as Record<string, unknown>);
  },

  /** Get reviews for a supplier with pagination. */
  async getReviews(
    supplierId: string,
    opts: { limit?: number; offset?: number; sortBy?: 'newest' | 'highest' | 'lowest' } = {},
  ): Promise<{ reviews: SupplierReview[]; total: number }> {
    const { limit = 20, offset = 0, sortBy = 'newest' } = opts;

    let query = supabase
      .from('supplier_reviews')
      .select('*', { count: 'exact' })
      .eq('supplier_id', supplierId)
      .range(offset, offset + limit - 1);

    switch (sortBy) {
      case 'highest':
        query = query.order('rating', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'lowest':
        query = query.order('rating', { ascending: true }).order('created_at', { ascending: false });
        break;
      default:
        query = query.order('created_at', { ascending: false });
    }

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch reviews: ${error.message}`);

    return {
      reviews: (data ?? []).map((r) => rowToReview(r as Record<string, unknown>)),
      total: count ?? 0,
    };
  },

  /** Compute aggregate ratings for a supplier. */
  async getAggregation(supplierId: string): Promise<ReviewAggregation> {
    const { data, error } = await supabase
      .from('supplier_reviews')
      .select('rating')
      .eq('supplier_id', supplierId);

    if (error) throw new Error(`Failed to aggregate reviews: ${error.message}`);

    const reviews = data ?? [];
    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;

    for (const r of reviews) {
      const rating = Number(r.rating) as 1 | 2 | 3 | 4 | 5;
      distribution[rating] = (distribution[rating] || 0) + 1;
      sum += rating;
    }

    return {
      supplierId,
      averageRating: reviews.length > 0 ? Math.round((sum / reviews.length) * 100) / 100 : 0,
      totalReviews: reviews.length,
      distribution,
    };
  },
};
