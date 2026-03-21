/**
 * Supplier Reviews — Type Definitions
 */

import { z } from 'zod';

// ─── Schemas ────────────────────────────────────────────────────

export const createReviewSchema = z.object({
  supplierId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(200).optional(),
  comment: z.string().trim().max(2000).optional(),
});

export const respondToReviewSchema = z.object({
  reviewId: z.string().uuid(),
  response: z.string().trim().min(1).max(2000),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type RespondToReviewInput = z.infer<typeof respondToReviewSchema>;

// ─── Models ─────────────────────────────────────────────────────

export interface SupplierReview {
  id: string;
  supplierId: string;
  reviewerId: string;
  orderId: string | null;
  rating: number;
  title: string | null;
  comment: string | null;
  response: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewAggregation {
  supplierId: string;
  averageRating: number;
  totalReviews: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}
