/**
 * Agent Memory Service — CRUD, search, and feedback
 *
 * Persists to the agent_memory table, provides similarity search
 * across stored issues/resolutions, and tracks success/failure rates.
 */

import { supabase } from '@/integrations/supabase/client';
import { combinedSimilarity, generateLocalEmbedding } from './embeddingEngine';
import type {
  MemoryRecord,
  MemorySearchOptions,
  MemorySearchResult,
  StoreMemoryInput,
  MemoryFeedback,
  MemoryStats,
  IssueResolution,
} from './types';

// ─── Helpers ────────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): MemoryRecord {
  const val = row.value as Record<string, unknown>;
  return {
    id: row.id as string,
    tenantId: (row.tenant_id as string) ?? null,
    category: (row.memory_type as MemoryRecord['category']),
    key: row.key as string,
    value: val,
    embedding: (val?.__embedding as number[]) ?? null,
    successCount: (val?.__success_count as number) ?? 0,
    failureCount: (val?.__failure_count as number) ?? 0,
    lastAccessedAt: (val?.__last_accessed as string) ?? (row.created_at as string),
    ttlSeconds: (row.ttl_seconds as number) ?? null,
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string) ?? null,
  };
}

function extractTextForSearch(value: Record<string, unknown>): string {
  const ir = value as Partial<IssueResolution>;
  const parts: string[] = [];
  if (ir.issue) parts.push(ir.issue);
  if (ir.resolution) parts.push(ir.resolution);
  if (ir.tags) parts.push(ir.tags.join(' '));
  if (parts.length === 0 && value.key) parts.push(String(value.key));
  return parts.join(' ');
}

function extractTags(value: Record<string, unknown>): string[] {
  const ir = value as Partial<IssueResolution>;
  const tags: string[] = [];
  if (ir.tags) tags.push(...ir.tags);
  if (ir.agent_types) tags.push(...ir.agent_types);
  if (ir.tools_used) tags.push(...ir.tools_used);
  return tags;
}

// ─── Store ──────────────────────────────────────────────────────

export async function storeMemory(input: StoreMemoryInput): Promise<MemoryRecord | null> {
  const value: Record<string, unknown> = {
    ...(input.value as Record<string, unknown>),
    __success_count: 0,
    __failure_count: 0,
    __last_accessed: new Date().toISOString(),
    __tags: input.tags ?? [],
  };

  // Generate embedding if requested
  if (input.generateEmbedding !== false) {
    const text = extractTextForSearch(input.value as Record<string, unknown>);
    if (text.length > 0) {
      value.__embedding = generateLocalEmbedding(text);
    }
  }

  const expiresAt = input.ttlSeconds
    ? new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
    : null;

  const { data, error } = await supabase
    .from('agent_memory')
    .insert({
      tenant_id: input.tenantId ?? null,
      memory_type: input.category,
      key: input.key,
      value: value as any,
      ttl_seconds: input.ttlSeconds ?? null,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Failed to store memory:', error?.message);
    return null;
  }

  return rowToRecord(data as Record<string, unknown>);
}

// ─── Search ─────────────────────────────────────────────────────

export async function searchMemory(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
  const { query, category, tenantId, limit = 10, minSimilarity = 0.1, successOnly = false } = options;

  let dbQuery = supabase
    .from('agent_memory')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200); // fetch a pool, rank client-side

  if (category) dbQuery = dbQuery.eq('memory_type', category);
  if (tenantId) dbQuery = dbQuery.eq('tenant_id', tenantId);

  const { data, error } = await dbQuery;

  if (error || !data) {
    console.error('Memory search failed:', error?.message);
    return [];
  }

  const queryEmbedding = generateLocalEmbedding(query);
  const queryTags = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored: MemorySearchResult[] = [];

  for (const row of data) {
    const record = rowToRecord(row as Record<string, unknown>);

    // Filter expired entries
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) continue;

    // Filter by success if requested
    if (successOnly && record.failureCount >= record.successCount) continue;

    const candidateText = extractTextForSearch(record.value as Record<string, unknown>);
    const candidateTags = extractTags(record.value as Record<string, unknown>);

    const { similarity, matchType } = combinedSimilarity(
      query,
      candidateText,
      queryTags,
      candidateTags,
      queryEmbedding,
      record.embedding,
    );

    if (similarity >= minSimilarity) {
      scored.push({ record, similarity, matchType });
    }
  }

  // Sort by similarity descending
  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, limit);
}

// ─── Feedback (success/failure tracking) ────────────────────────

export async function recordFeedback(feedback: MemoryFeedback): Promise<boolean> {
  // Fetch current record
  const { data, error } = await supabase
    .from('agent_memory')
    .select('*')
    .eq('id', feedback.memoryId)
    .maybeSingle();

  if (error || !data) return false;

  const value = (data.value ?? {}) as Record<string, unknown>;
  const successCount = ((value.__success_count as number) ?? 0) + (feedback.success ? 1 : 0);
  const failureCount = ((value.__failure_count as number) ?? 0) + (feedback.success ? 0 : 1);

  const updatedValue = {
    ...value,
    __success_count: successCount,
    __failure_count: failureCount,
    __last_accessed: new Date().toISOString(),
    __last_feedback: feedback.notes ?? null,
  };

  // agent_memory doesn't have UPDATE RLS — use insert of a new record
  // with the same key to supersede, or if the table gains UPDATE, use:
  // For now, we store feedback as a separate memory entry
  await supabase.from('agent_memory').insert({
    tenant_id: data.tenant_id,
    memory_type: 'learned_pattern',
    key: `feedback:${feedback.memoryId}`,
    value: {
      original_memory_id: feedback.memoryId,
      success: feedback.success,
      notes: feedback.notes ?? null,
      success_count: successCount,
      failure_count: failureCount,
      recorded_at: new Date().toISOString(),
    } as any,
    ttl_seconds: 86400 * 30, // 30 days
    expires_at: new Date(Date.now() + 86400 * 30 * 1000).toISOString(),
  });

  return true;
}

// ─── Stats ──────────────────────────────────────────────────────

export async function getMemoryStats(tenantId?: string): Promise<MemoryStats> {
  let query = supabase.from('agent_memory').select('*');
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;

  if (error || !data) {
    return { totalEntries: 0, byCategory: {}, avgSuccessRate: 0, cacheHitRate: 0 };
  }

  const byCategory: Record<string, number> = {};
  let totalSuccess = 0;
  let totalFailure = 0;
  let cacheEntries = 0;

  for (const row of data) {
    const type = row.memory_type as string;
    byCategory[type] = (byCategory[type] ?? 0) + 1;

    const val = (row.value ?? {}) as Record<string, unknown>;
    totalSuccess += (val.__success_count as number) ?? 0;
    totalFailure += (val.__failure_count as number) ?? 0;

    if (type === 'tool_result_cache') cacheEntries++;
  }

  const total = totalSuccess + totalFailure;

  return {
    totalEntries: data.length,
    byCategory,
    avgSuccessRate: total > 0 ? Math.round((totalSuccess / total) * 100) / 100 : 0,
    cacheHitRate: data.length > 0 ? Math.round((cacheEntries / data.length) * 100) / 100 : 0,
  };
}

// ─── Store Issue Resolution (convenience) ───────────────────────

export async function storeIssueResolution(
  issue: string,
  resolution: string,
  meta: {
    toolsUsed?: string[];
    agentTypes?: string[];
    tags?: string[];
    success?: boolean;
    confidence?: number;
    durationMs?: number;
    tenantId?: string;
  } = {},
): Promise<MemoryRecord | null> {
  const value: IssueResolution = {
    issue,
    resolution,
    tools_used: meta.toolsUsed ?? [],
    agent_types: meta.agentTypes ?? [],
    tags: meta.tags ?? [],
    success: meta.success ?? true,
    confidence: meta.confidence ?? 0.8,
    duration_ms: meta.durationMs ?? 0,
  };

  return storeMemory({
    tenantId: meta.tenantId ?? null,
    category: 'issue_resolution',
    key: `issue:${Date.now().toString(36)}`,
    value,
    tags: [...(meta.tags ?? []), ...(meta.agentTypes ?? [])],
    generateEmbedding: true,
  });
}

// ─── Find Similar Issues ────────────────────────────────────────

export async function findSimilarIssues(
  query: string,
  options: { tenantId?: string; limit?: number; successOnly?: boolean } = {},
): Promise<MemorySearchResult[]> {
  return searchMemory({
    query,
    category: 'issue_resolution',
    tenantId: options.tenantId,
    limit: options.limit ?? 5,
    successOnly: options.successOnly ?? false,
    minSimilarity: 0.15,
  });
}
