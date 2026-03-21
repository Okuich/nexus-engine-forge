import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Fee calculation (mirrored from feeEngine.ts for edge function context)
const DEFAULT_FEE_SCHEDULE = {
  basePlatformFeePct: 5.0,
  volumeTiers: [
    { minSubtotalUsd: 50_000, feePct: 4.0 },
    { minSubtotalUsd: 100_000, feePct: 3.5 },
    { minSubtotalUsd: 250_000, feePct: 3.0 },
    { minSubtotalUsd: 500_000, feePct: 2.5 },
  ],
  minFeeUsd: 25,
  maxFeeUsd: null as number | null,
  taxRatePct: 0,
};

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function calculateFees(unitPrice: number, quantity: number, schedule = DEFAULT_FEE_SCHEDULE) {
  const subtotal = round(unitPrice * quantity);

  const sorted = [...schedule.volumeTiers].sort((a, b) => b.minSubtotalUsd - a.minSubtotalUsd);
  let feePct = schedule.basePlatformFeePct;
  let tierLabel = `Base rate ${schedule.basePlatformFeePct}%`;
  for (const tier of sorted) {
    if (subtotal >= tier.minSubtotalUsd) {
      feePct = tier.feePct;
      tierLabel = `Volume ≥$${tier.minSubtotalUsd.toLocaleString()} → ${tier.feePct}%`;
      break;
    }
  }

  let platformFee = round(subtotal * (feePct / 100));
  platformFee = Math.max(platformFee, schedule.minFeeUsd);
  if (schedule.maxFeeUsd != null) platformFee = Math.min(platformFee, schedule.maxFeeUsd);

  const tax = round(subtotal * (schedule.taxRatePct / 100));
  const supplierPayout = round(subtotal - platformFee);
  const total = round(subtotal + tax);

  return { subtotalUsd: subtotal, platformFeePct: feePct, platformFeeUsd: platformFee, taxUsd: tax, totalUsd: total, supplierPayoutUsd: supplierPayout, tierApplied: tierLabel };
}

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
      case 'preview-fees': {
        result = calculateFees(body.unitPriceUsd, body.quantity);
        break;
      }

      case 'create-order': {
        const fees = calculateFees(body.unitPriceUsd, body.quantity);
        const { data, error } = await supabase
          .from('marketplace_orders')
          .insert({
            rfq_id: body.rfqId ?? null,
            quote_id: body.quoteId ?? null,
            buyer_id: user.id,
            supplier_id: body.supplierId,
            unit_price_usd: body.unitPriceUsd,
            quantity: body.quantity,
            subtotal_usd: fees.subtotalUsd,
            platform_fee_usd: fees.platformFeeUsd,
            platform_fee_pct: fees.platformFeePct,
            supplier_payout_usd: fees.supplierPayoutUsd,
            tax_usd: fees.taxUsd,
            total_usd: fees.totalUsd,
            metadata: body.metadata ?? {},
            status: 'pending',
          })
          .select()
          .single();
        if (error) throw error;
        result = { order: data, fees };
        break;
      }

      case 'list-orders': {
        const status = url.searchParams.get('status');
        let query = supabase
          .from('marketplace_orders')
          .select('*')
          .order('created_at', { ascending: false });
        if (status) query = query.eq('status', status);
        const { data, error } = await query;
        if (error) throw error;
        result = data;
        break;
      }

      case 'process-payment': {
        const { data: order, error: orderErr } = await supabase
          .from('marketplace_orders')
          .select('*')
          .eq('id', body.orderId)
          .single();
        if (orderErr) throw orderErr;

        const { data: payment, error: payErr } = await supabase
          .from('marketplace_payments')
          .insert({
            order_id: body.orderId,
            payer_id: user.id,
            amount_usd: order.total_usd,
            platform_fee_usd: order.platform_fee_usd,
            supplier_payout_usd: order.supplier_payout_usd,
            payment_method: body.paymentMethod ?? 'platform_balance',
            external_payment_id: body.externalPaymentId ?? null,
            status: 'completed',
            paid_at: new Date().toISOString(),
            metadata: body.metadata ?? {},
          })
          .select()
          .single();
        if (payErr) throw payErr;

        // Update order status
        await supabase
          .from('marketplace_orders')
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .eq('id', body.orderId);

        // Create supplier payout
        await supabase
          .from('supplier_payouts')
          .insert({
            supplier_id: order.supplier_id,
            payment_id: payment.id,
            order_id: order.id,
            amount_usd: order.supplier_payout_usd,
            status: 'pending',
            payout_method: 'platform_balance',
            metadata: {},
          });

        result = payment;
        break;
      }

      case 'list-payments': {
        const orderId = url.searchParams.get('orderId');
        let query = supabase
          .from('marketplace_payments')
          .select('*')
          .order('created_at', { ascending: false });
        if (orderId) query = query.eq('order_id', orderId);
        const { data, error } = await query;
        if (error) throw error;
        result = data;
        break;
      }

      case 'list-payouts': {
        const supplierId = url.searchParams.get('supplierId');
        let query = supabase
          .from('supplier_payouts')
          .select('*')
          .order('created_at', { ascending: false });
        if (supplierId) query = query.eq('supplier_id', supplierId);
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
