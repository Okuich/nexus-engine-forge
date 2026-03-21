import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader ?? '' } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const path = url.pathname.split('/').filter(Boolean);
    const action = path[path.length - 1] || '';
    const body = req.method !== 'GET' ? await req.json() : {};

    let result: unknown;

    switch (action) {
      // ── Accounts ──
      case 'list-accounts': {
        const { data, error } = await supabase
          .from('pricing_accounts')
          .select('*')
          .eq('active', true)
          .order('created_at', { ascending: false });
        if (error) throw error;
        result = data;
        break;
      }

      case 'create-account': {
        const { data, error } = await supabase
          .from('pricing_accounts')
          .insert({
            account_name: body.accountName,
            account_type: body.accountType ?? 'standard',
            base_margin_pct: body.baseMarginPct ?? 15.0,
            preferred_supplier_ids: body.preferredSupplierIds ?? [],
            metadata: body.metadata ?? {},
            created_by: user.id,
          })
          .select()
          .single();
        if (error) throw error;
        result = data;
        break;
      }

      // ── Rules ──
      case 'list-rules': {
        const accountId = url.searchParams.get('accountId');
        if (!accountId) throw new Error('accountId required');
        const { data, error } = await supabase
          .from('pricing_rules')
          .select('*')
          .eq('account_id', accountId)
          .order('priority', { ascending: false });
        if (error) throw error;
        result = data;
        break;
      }

      case 'create-rule': {
        const { data, error } = await supabase
          .from('pricing_rules')
          .insert({
            account_id: body.accountId,
            rule_type: body.ruleType,
            priority: body.priority ?? 0,
            conditions: body.conditions ?? {},
            adjustments: body.adjustments ?? {},
            description: body.description ?? null,
          })
          .select()
          .single();
        if (error) throw error;
        result = data;
        break;
      }

      case 'toggle-rule': {
        const { data, error } = await supabase
          .from('pricing_rules')
          .update({ active: body.active, updated_at: new Date().toISOString() })
          .eq('id', body.ruleId)
          .select()
          .single();
        if (error) throw error;
        result = data;
        break;
      }

      // ── Calculate ──
      case 'calculate': {
        let baseMarginPct = 15.0;
        let preferredSupplierIds: string[] = [];
        let rules: any[] = [];

        if (body.accountId) {
          const { data: account } = await supabase
            .from('pricing_accounts')
            .select('*')
            .eq('id', body.accountId)
            .single();

          if (account) {
            baseMarginPct = Number(account.base_margin_pct);
            preferredSupplierIds = (account.preferred_supplier_ids as string[]) ?? [];
          }

          const { data: ruleData } = await supabase
            .from('pricing_rules')
            .select('*')
            .eq('account_id', body.accountId)
            .eq('active', true)
            .order('priority', { ascending: false });

          rules = ruleData ?? [];
        }

        // Evaluate rules inline (mirroring rulesEngine logic)
        let unitCost = Number(body.baseCostUsd);
        let marginPct = baseMarginPct;
        let volumeDiscountPct = 0;
        let preferredDiscountPct = 0;
        const appliedRules: any[] = [];
        const lineItems: any[] = [{ label: 'Base Cost', amount: unitCost, type: 'base' }];

        for (const rule of rules) {
          const cond = rule.conditions ?? {};
          const adj = rule.adjustments ?? {};
          const qty = body.quantity ?? 1;

          // Condition checks
          if (cond.minQuantity != null && qty < cond.minQuantity) continue;
          if (cond.maxQuantity != null && qty > cond.maxQuantity) continue;
          if (cond.materials?.length && !cond.materials.includes(body.material)) continue;
          if (cond.processes?.length && !cond.processes.includes(body.process)) continue;

          // Margin override
          if (rule.rule_type === 'margin_override' && adj.marginOverridePct != null) {
            marginPct = adj.marginOverridePct;
            appliedRules.push({ ruleId: rule.id, ruleType: rule.rule_type, description: rule.description ?? `Margin → ${marginPct}%`, adjustmentUsd: 0, priority: rule.priority });
            continue;
          }

          // Preferred supplier
          if (rule.rule_type === 'preferred_supplier') {
            if (!body.supplierId || !preferredSupplierIds.includes(body.supplierId)) continue;
            if (adj.preferredDiscountPct) preferredDiscountPct = adj.preferredDiscountPct;
          }

          // Volume discount tracking
          if (rule.rule_type === 'volume_discount' && adj.percentagePct) {
            volumeDiscountPct = Math.abs(adj.percentagePct);
          }

          let delta = 0;
          if (adj.flatUsd) delta += adj.flatUsd;
          if (adj.percentagePct) delta += unitCost * (adj.percentagePct / 100);
          if (adj.multiplier) delta += unitCost * (adj.multiplier - 1);
          if (adj.preferredDiscountPct) delta -= unitCost * (adj.preferredDiscountPct / 100);

          delta = Math.round(delta * 100) / 100;
          unitCost += delta;

          appliedRules.push({ ruleId: rule.id, ruleType: rule.rule_type, description: rule.description ?? rule.rule_type, adjustmentUsd: delta, priority: rule.priority });
          lineItems.push({ label: rule.description ?? rule.rule_type, amount: delta, type: delta < 0 ? 'discount' : 'surcharge' });
        }

        const marginUsd = Math.round(unitCost * (marginPct / 100) * 100) / 100;
        const unitPrice = Math.round((unitCost + marginUsd) * 100) / 100;
        const totalPrice = Math.round(unitPrice * (body.quantity ?? 1) * 100) / 100;

        lineItems.push(
          { label: `Margin (${marginPct}%)`, amount: marginUsd, type: 'margin' },
          { label: 'Unit Price', amount: unitPrice, type: 'subtotal' },
          { label: `Total (×${body.quantity ?? 1})`, amount: totalPrice, type: 'total' },
        );

        // Persist if requested
        if (body.persist) {
          await supabase.from('price_quotes').insert({
            account_id: body.accountId ?? null,
            base_cost_usd: body.baseCostUsd,
            final_price_usd: totalPrice,
            margin_pct: marginPct,
            quantity: body.quantity ?? 1,
            material: body.material,
            process: body.process,
            applied_rules: appliedRules,
            line_items: lineItems,
            metadata: { supplierId: body.supplierId, region: body.region },
            created_by: user.id,
          });
        }

        result = {
          baseCostUsd: body.baseCostUsd,
          unitPriceUsd: unitPrice,
          totalPriceUsd: totalPrice,
          marginPct,
          marginUsd,
          appliedRules,
          lineItems,
          volumeDiscountPct,
          preferredSupplierDiscountPct: preferredDiscountPct,
        };
        break;
      }

      // ── Quote History ──
      case 'list-quotes': {
        const accountId = url.searchParams.get('accountId');
        let query = supabase
          .from('price_quotes')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        if (accountId) query = query.eq('account_id', accountId);
        const { data, error } = await query;
        if (error) throw error;
        result = data;
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
