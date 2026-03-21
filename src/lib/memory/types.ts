/**
 * Agent Memory System — Type Definitions
 *
 * Stores past issues/resolutions, supports similarity search,
 * tracks success/failure, and provides embedding support.
 */

// ─── Memory Entry Types ─────────────────────────────────────────

export type MemoryCategory =
  | 'issue_resolution'
  | 'tool_result_cache'
  | 'learned_pattern'
  | 'user_preference'
  | 'execution_summary';

export interface IssueResolution {
  issue: string;
  resolution: string;
  tools_used: string[];
  agent_types: string[];
  tags: string[];
  success: boolean;
  confidence: number;
  duration_ms: number;
}

export interface MemoryRecord {
  id: string;
  tenantId: string | null;
  category: MemoryCategory;
  key: string;
  value: IssueResolution | Record<string, unknown>;
  embedding: number[] | null;
  successCount: number;
  failureCount: number;
  lastAccessedAt: string;
  ttlSeconds: number | null;
  createdAt: string;
  expiresAt: string | null;
}

// ─── Search ─────────────────────────────────────────────────────

export interface MemorySearchOptions {
  query: string;
  category?: MemoryCategory;
  tenantId?: string | null;
  limit?: number;
  minSimilarity?: number;
  successOnly?: boolean;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  similarity: number;
  matchType: 'embedding' | 'keyword' | 'tag';
}

// ─── Store ──────────────────────────────────────────────────────

export interface StoreMemoryInput {
  tenantId?: string | null;
  category: MemoryCategory;
  key: string;
  value: IssueResolution | Record<string, unknown>;
  tags?: string[];
  ttlSeconds?: number;
  generateEmbedding?: boolean;
}

// ─── Feedback ───────────────────────────────────────────────────

export interface MemoryFeedback {
  memoryId: string;
  success: boolean;
  notes?: string;
}

// ─── Stats ──────────────────────────────────────────────────────

export interface MemoryStats {
  totalEntries: number;
  byCategory: Record<string, number>;
  avgSuccessRate: number;
  cacheHitRate: number;
}
