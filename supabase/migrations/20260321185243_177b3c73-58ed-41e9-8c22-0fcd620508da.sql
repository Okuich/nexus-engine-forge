
-- Tighten training_jobs: scope to tenant members
DROP POLICY IF EXISTS "Allow public insert on training_jobs" ON public.training_jobs;
DROP POLICY IF EXISTS "Allow public read on training_jobs" ON public.training_jobs;
DROP POLICY IF EXISTS "Allow public update on training_jobs" ON public.training_jobs;

CREATE POLICY "Tenant members read training_jobs" ON public.training_jobs FOR SELECT
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "Tenant members insert training_jobs" ON public.training_jobs FOR INSERT
  WITH CHECK (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "Tenant members update training_jobs" ON public.training_jobs FOR UPDATE
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));

-- Tighten model_versions
DROP POLICY IF EXISTS "Allow public insert on model_versions" ON public.model_versions;
DROP POLICY IF EXISTS "Allow public read on model_versions" ON public.model_versions;

CREATE POLICY "Tenant members read model_versions" ON public.model_versions FOR SELECT
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "Tenant members insert model_versions" ON public.model_versions FOR INSERT
  WITH CHECK (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));

-- Tighten training_metrics
DROP POLICY IF EXISTS "Allow public insert on training_metrics" ON public.training_metrics;
DROP POLICY IF EXISTS "Allow public read on training_metrics" ON public.training_metrics;

CREATE POLICY "Tenant members read training_metrics" ON public.training_metrics FOR SELECT
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "Tenant members insert training_metrics" ON public.training_metrics FOR INSERT
  WITH CHECK (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));
