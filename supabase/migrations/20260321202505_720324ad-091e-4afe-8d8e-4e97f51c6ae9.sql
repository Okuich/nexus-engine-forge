
CREATE TABLE public.model_benchmarks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.training_jobs(id) ON DELETE CASCADE,
  model_version_id UUID REFERENCES public.model_versions(id) ON DELETE SET NULL,
  model_type TEXT NOT NULL DEFAULT 'gat',
  dataset_name TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  mae DOUBLE PRECISION NOT NULL,
  mse DOUBLE PRECISION,
  rmse DOUBLE PRECISION,
  mape DOUBLE PRECISION,
  val_loss DOUBLE PRECISION,
  train_loss DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  f1_score DOUBLE PRECISION,
  latency_mean_ms DOUBLE PRECISION NOT NULL,
  latency_p50_ms DOUBLE PRECISION,
  latency_p95_ms DOUBLE PRECISION,
  latency_p99_ms DOUBLE PRECISION,
  throughput_rps DOUBLE PRECISION,
  gpu_memory_mb DOUBLE PRECISION,
  metadata JSONB DEFAULT '{}'::jsonb,
  tenant_id UUID REFERENCES public.tenants(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.model_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read benchmarks"
  ON public.model_benchmarks FOR SELECT
  USING (tenant_id IS NULL OR is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "Tenant members insert benchmarks"
  ON public.model_benchmarks FOR INSERT
  WITH CHECK (tenant_id IS NULL OR is_tenant_member(auth.uid(), tenant_id));

CREATE INDEX idx_benchmarks_model_type ON public.model_benchmarks(model_type);
CREATE INDEX idx_benchmarks_job_id ON public.model_benchmarks(job_id);
CREATE INDEX idx_benchmarks_created ON public.model_benchmarks(created_at DESC);
