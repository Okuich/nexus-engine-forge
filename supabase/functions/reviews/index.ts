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
      case 'create': {
        if (!body.supplierId || !body.rating) throw new Error('supplierId and rating required');
        if (body.rating < 1 || body.rating > 5) throw new Error('Rating must be 1-5');

        const { data, error } = await supabase
          .from('supplier_reviews')
          .insert({
            supplier_id: body.supplierId,
            reviewer_id: user.id,
            order_id: body.orderId ?? null,
            rating: body.rating,
            title: body.title ?? null,
            comment: body.comment ?? null,
          })
          .select()
          .single();
        if (error) throw error;
        result = data;
        break;
      }

      case 'respond': {
        if (!body.reviewId || !body.response) throw new Error('reviewId and response required');
        const { data, error } = await supabase
          .from('supplier_reviews')
          .update({
            response: body.response,
            responded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.reviewId)
          .select()
          .single();
        if (error) throw error;
        result = data;
        break;
      }

      case 'list': {
        const supplierId = url.searchParams.get('supplierId');
        if (!supplierId) throw new Error('supplierId query param required');
        const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
        const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

        const { data, error, count } = await supabase
          .from('supplier_reviews')
          .select('*', { count: 'exact' })
          .eq('supplier_id', supplierId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);
        if (error) throw error;
        result = { reviews: data, total: count };
        break;
      }

      case 'aggregate': {
        const supplierId = url.searchParams.get('supplierId');
        if (!supplierId) throw new Error('supplierId query param required');

        const { data, error } = await supabase
          .from('supplier_reviews')
          .select('rating')
          .eq('supplier_id', supplierId);
        if (error) throw error;

        const reviews = data ?? [];
        const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;
        for (const r of reviews) {
          distribution[r.rating] = (distribution[r.rating] || 0) + 1;
          sum += r.rating;
        }

        result = {
          supplierId,
          averageRating: reviews.length > 0 ? Math.round((sum / reviews.length) * 100) / 100 : 0,
          totalReviews: reviews.length,
          distribution,
        };
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
