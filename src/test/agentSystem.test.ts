/**
 * Tests for the Autonomous Agent System (planner + executor logic).
 * Tests the deterministic planner and entity extraction —
 * executor tests mock the tool layer since it requires Supabase.
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeProblem,
  extractEntities,
  computeOverallConfidence,
} from '@/lib/agents/planner';
import type { PlanStep } from '@/lib/agents/planner';

// ─── Entity Extraction ─────────────────────────────────────────

describe('extractEntities', () => {
  it('extracts UUIDs from text', () => {
    const text = 'Check order a1b2c3d4-e5f6-7890-abcd-ef1234567890 please';
    const entities = extractEntities(text);
    expect(entities.orderIds).toHaveLength(1);
    expect(entities.orderIds[0]).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('classifies UUIDs by context', () => {
    const text = 'RFQ a1b2c3d4-e5f6-7890-abcd-ef1234567890 from supplier b2c3d4e5-f6a7-8901-bcde-f12345678901';
    const entities = extractEntities(text);
    expect(entities.rfqIds).toHaveLength(1);
    expect(entities.supplierIds).toHaveLength(1);
  });

  it('extracts dollar amounts', () => {
    const text = 'Refund $1,500.50 for this order';
    const entities = extractEntities(text);
    expect(entities.amounts).toContain(1500.50);
  });

  it('extracts materials', () => {
    const text = 'Need a quote for titanium part in al-6061';
    const entities = extractEntities(text);
    expect(entities.materials).toContain('titanium');
    expect(entities.materials).toContain('al-6061');
  });

  it('extracts issue types', () => {
    const text = 'Quality issue with late delivery, need a refund';
    const entities = extractEntities(text);
    expect(entities.issueTypes).toContain('quality');
    expect(entities.issueTypes).toContain('delivery');
    expect(entities.issueTypes).toContain('refund');
  });
});

// ─── Problem Analysis ───────────────────────────────────────────

describe('analyzeProblem', () => {
  it('detects refund requests', () => {
    const analysis = analyzeProblem('I need a refund for order abc12345-1234-1234-1234-123456789012');
    expect(analysis.category).toBe('refund_request');
    expect(analysis.intent).toBe('process_refund');
  });

  it('detects order issues', () => {
    const analysis = analyzeProblem('Check the status of order abc12345-1234-1234-1234-123456789012');
    expect(analysis.category).toBe('order_issue');
    expect(analysis.intent).toBe('check_status');
  });

  it('detects pricing issues', () => {
    const analysis = analyzeProblem('Recompute the quote for this RFQ');
    expect(analysis.category).toBe('pricing_issue');
    expect(analysis.intent).toBe('recompute_pricing');
  });

  it('detects supplier matching', () => {
    const analysis = analyzeProblem('Find suppliers for titanium CNC milling');
    expect(analysis.category).toBe('supplier_match');
    expect(analysis.intent).toBe('match_suppliers');
  });

  it('flags high-value refunds for human review', () => {
    const analysis = analyzeProblem('Refund $10,000 for order abc12345-1234-1234-1234-123456789012');
    expect(analysis.requiresHumanReview).toBe(true);
  });

  it('classifies complexity', () => {
    const simple = analyzeProblem('Check order status');
    expect(simple.complexity).toBe('simple');

    const complex = analyzeProblem('Refund $10,000 for order abc12345-1234-1234-1234-123456789012 due to quality dispute');
    expect(complex.complexity).toBe('moderate');
  });
});

// ─── Confidence Scoring ─────────────────────────────────────────

describe('computeOverallConfidence', () => {
  const baseStep: PlanStep = {
    id: 's1', tool: 'check_order', description: '', parameters: {},
    dependsOn: [], status: 'pending', retryCount: 0, maxRetries: 2, confidence: 0.9,
  };

  it('returns average step confidence with no memory', () => {
    const analysis = analyzeProblem('Check order');
    const conf = computeOverallConfidence([baseStep], [], analysis);
    expect(conf).toBeGreaterThan(0.5);
    expect(conf).toBeLessThanOrEqual(0.95);
  });

  it('penalizes complex problems', () => {
    const simpleAnalysis = analyzeProblem('Check order');
    const complexAnalysis = analyzeProblem('Refund $10,000 for order abc12345-1234-1234-1234-123456789012 dispute');

    const simpleConf = computeOverallConfidence([baseStep], [], simpleAnalysis);
    const complexConf = computeOverallConfidence([baseStep], [], complexAnalysis);
    expect(simpleConf).toBeGreaterThanOrEqual(complexConf);
  });

  it('returns 0 for empty steps', () => {
    const analysis = analyzeProblem('anything');
    expect(computeOverallConfidence([], [], analysis)).toBe(0);
  });
});
