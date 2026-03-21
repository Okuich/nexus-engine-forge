
-- Agent execution history / memory
CREATE TABLE public.agent_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  goal TEXT NOT NULL,
  plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  total_duration_ms INTEGER,
  model_used TEXT,
  token_usage JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read executions" ON public.agent_executions FOR SELECT
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "Authenticated insert executions" ON public.agent_executions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Agent memory: stores learned patterns and cached results
CREATE TABLE public.agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL, -- 'tool_result_cache', 'learned_pattern', 'user_preference'
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  ttl_seconds INTEGER DEFAULT 3600,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE(tenant_id, memory_type, key)
);
ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read memory" ON public.agent_memory FOR SELECT
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "Authenticated insert memory" ON public.agent_memory FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX idx_agent_memory_lookup ON public.agent_memory(tenant_id, memory_type, key);
CREATE INDEX idx_agent_executions_tenant ON public.agent_executions(tenant_id, created_at DESC);
