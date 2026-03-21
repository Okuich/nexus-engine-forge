import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub;

    const { name, slug } = await req.json();
    if (!name || !slug) {
      return new Response(JSON.stringify({ error: 'name and slug required' }), { status: 400, headers: corsHeaders });
    }

    // Use service role to create tenant + membership atomically
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: tenant, error: tenantError } = await adminClient
      .from('tenants')
      .insert({ name, slug })
      .select()
      .single();

    if (tenantError) {
      return new Response(JSON.stringify({ error: tenantError.message }), { status: 400, headers: corsHeaders });
    }

    // Add creator as owner
    await adminClient.from('tenant_members').insert({
      tenant_id: tenant.id,
      user_id: userId,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    // Audit log
    await adminClient.from('audit_logs').insert({
      tenant_id: tenant.id,
      user_id: userId,
      action: 'tenant.created',
      resource_type: 'tenant',
      resource_id: tenant.id,
      metadata: { name, slug },
    });

    return new Response(JSON.stringify({ tenant }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
