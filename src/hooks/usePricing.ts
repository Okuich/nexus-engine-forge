/**
 * usePricing — React hook for the enterprise pricing engine.
 */

import { useState, useCallback } from 'react';
import { pricingService } from '@/lib/pricing';
import type {
  PricingAccount,
  PricingRule,
  PriceQuote,
  PriceCalculationResult,
  CreateAccountRequest,
  CreateRuleRequest,
  CalculatePriceRequest,
} from '@/lib/pricing';

export function usePricing() {
  const [accounts, setAccounts] = useState<PricingAccount[]>([]);
  const [activeAccount, setActiveAccount] = useState<PricingAccount | null>(null);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [quotes, setQuotes] = useState<PriceQuote[]>([]);
  const [lastResult, setLastResult] = useState<PriceCalculationResult | null>(null);
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

  const loadAccounts = useCallback(async () => {
    await withLoading(async () => {
      const data = await pricingService.listAccounts();
      setAccounts(data);
    });
  }, [withLoading]);

  const createAccount = useCallback(async (req: CreateAccountRequest) => {
    return withLoading(async () => {
      const account = await pricingService.createAccount(req);
      setAccounts((prev) => [account, ...prev]);
      return account;
    });
  }, [withLoading]);

  const selectAccount = useCallback(async (id: string) => {
    await withLoading(async () => {
      const account = await pricingService.getAccount(id);
      setActiveAccount(account);
      const accountRules = await pricingService.listRules(id);
      setRules(accountRules);
    });
  }, [withLoading]);

  const createRule = useCallback(async (req: CreateRuleRequest) => {
    return withLoading(async () => {
      const rule = await pricingService.createRule(req);
      setRules((prev) => [...prev, rule].sort((a, b) => b.priority - a.priority));
      return rule;
    });
  }, [withLoading]);

  const toggleRule = useCallback(async (ruleId: string, active: boolean) => {
    await withLoading(async () => {
      await pricingService.toggleRule(ruleId, active);
      setRules((prev) => prev.map((r) => r.id === ruleId ? { ...r, active } : r));
    });
  }, [withLoading]);

  const calculatePrice = useCallback(async (req: CalculatePriceRequest) => {
    return withLoading(async () => {
      const result = await pricingService.calculatePrice(req);
      setLastResult(result);
      return result;
    });
  }, [withLoading]);

  const loadQuotes = useCallback(async (accountId?: string) => {
    await withLoading(async () => {
      const data = await pricingService.listQuotes(accountId);
      setQuotes(data);
    });
  }, [withLoading]);

  return {
    accounts,
    activeAccount,
    rules,
    quotes,
    lastResult,
    loading,
    error,
    loadAccounts,
    createAccount,
    selectAccount,
    createRule,
    toggleRule,
    calculatePrice,
    loadQuotes,
    clearError: () => setError(null),
  };
}
