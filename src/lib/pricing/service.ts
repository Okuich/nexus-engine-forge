/**
 * Enterprise Pricing Engine — Service Layer
 *
 * Orchestrates account management, rule CRUD, and price calculation
 * with Supabase persistence.
 */

import { supabase } from '@/integrations/supabase/client';
import { evaluatePricingRules } from './rulesEngine';
import type {
  PricingAccount,
  PricingRule,
  PriceQuote,
  CreateAccountRequest,
  CreateRuleRequest,
  CalculatePriceRequest,
  PriceCalculationResult,
  PriceLineItem,
  AppliedRule,
} from './types';

// ─── Data Mappers ────────────────────────────────────────────────

function mapAccount(row: Record<string, unknown>): PricingAccount {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    accountName: row.account_name as string,
    accountType: row.account_type as PricingAccount['accountType'],
    baseMarginPct: Number(row.base_margin_pct),
    preferredSupplierIds: (row.preferred_supplier_ids as string[]) ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    active: row.active as boolean,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapRule(row: Record<string, unknown>): PricingRule {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    ruleType: row.rule_type as PricingRule['ruleType'],
    priority: row.priority as number,
    conditions: (row.conditions as any) ?? {},
    adjustments: (row.adjustments as any) ?? {},
    active: row.active as boolean,
    description: row.description as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapQuote(row: Record<string, unknown>): PriceQuote {
  return {
    id: row.id as string,
    accountId: row.account_id as string | null,
    baseCostUsd: Number(row.base_cost_usd),
    finalPriceUsd: Number(row.final_price_usd),
    marginPct: Number(row.margin_pct),
    quantity: row.quantity as number,
    material: row.material as string,
    process: row.process as string,
    appliedRules: (row.applied_rules as AppliedRule[]) ?? [],
    lineItems: (row.line_items as PriceLineItem[]) ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
  };
}

// ─── Pricing Service ────────────────────────────────────────────

export class PricingService {
  // ── Accounts ──

  async createAccount(req: CreateAccountRequest): Promise<PricingAccount> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Authentication required');

    const payload = {
      account_name: req.accountName,
      account_type: req.accountType ?? 'standard',
      base_margin_pct: req.baseMarginPct ?? 15.0,
      preferred_supplier_ids: req.preferredSupplierIds ?? [],
      metadata: req.metadata ?? {},
      created_by: user.id,
    };

    const { data, error } = await (supabase.from('pricing_accounts') as any)
      .insert(payload).select().single();

    if (error) throw new Error(`Failed to create account: ${error.message}`);
    return mapAccount(data as any);
  }

  async listAccounts(): Promise<PricingAccount[]> {
    const { data, error } = await supabase
      .from('pricing_accounts')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list accounts: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(mapAccount);
  }

  async getAccount(id: string): Promise<PricingAccount> {
    const { data, error } = await supabase
      .from('pricing_accounts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(`Failed to get account: ${error.message}`);
    return mapAccount(data as any);
  }

  // ── Rules ──

  async createRule(req: CreateRuleRequest): Promise<PricingRule> {
    const payload = {
      account_id: req.accountId,
      rule_type: req.ruleType,
      priority: req.priority ?? 0,
      conditions: req.conditions,
      adjustments: req.adjustments,
      description: req.description ?? null,
    };

    const { data, error } = await (supabase.from('pricing_rules') as any)
      .insert(payload).select().single();

    if (error) throw new Error(`Failed to create rule: ${error.message}`);
    return mapRule(data as any);
  }

  async listRules(accountId: string): Promise<PricingRule[]> {
    const { data, error } = await supabase
      .from('pricing_rules')
      .select('*')
      .eq('account_id', accountId)
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to list rules: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(mapRule);
  }

  async toggleRule(ruleId: string, active: boolean): Promise<void> {
    const { error } = await (supabase.from('pricing_rules') as any)
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', ruleId);

    if (error) throw new Error(`Failed to toggle rule: ${error.message}`);
  }

  // ── Price Calculation ──

  async calculatePrice(req: CalculatePriceRequest): Promise<PriceCalculationResult> {
    let baseMarginPct = 15.0;
    let preferredSupplierIds: string[] = [];
    let rules: PricingRule[] = [];

    // Load account config if specified
    if (req.accountId) {
      const account = await this.getAccount(req.accountId);
      baseMarginPct = account.baseMarginPct;
      preferredSupplierIds = account.preferredSupplierIds;
      rules = await this.listRules(req.accountId);
    }

    // Evaluate rules
    const result = evaluatePricingRules(rules, req, baseMarginPct, preferredSupplierIds);

    // Persist quote if requested
    if (req.persist) {
      await this.persistQuote(req, result);
    }

    return result;
  }

  private async persistQuote(
    req: CalculatePriceRequest,
    result: PriceCalculationResult,
  ): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload = {
      account_id: req.accountId ?? null,
      base_cost_usd: result.baseCostUsd,
      final_price_usd: result.totalPriceUsd,
      margin_pct: result.marginPct,
      quantity: req.quantity,
      material: req.material,
      process: req.process,
      applied_rules: result.appliedRules as any,
      line_items: result.lineItems as any,
      metadata: { supplierId: req.supplierId, region: req.region },
      created_by: user.id,
    };

    await (supabase.from('price_quotes') as any).insert(payload);
  }

  // ── Quote History ──

  async listQuotes(accountId?: string): Promise<PriceQuote[]> {
    let query = supabase
      .from('price_quotes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (accountId) query = query.eq('account_id', accountId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list quotes: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[]).map(mapQuote);
  }
}

/** Singleton */
export const pricingService = new PricingService();
