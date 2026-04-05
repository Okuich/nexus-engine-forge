
-- Helper function for updated_at timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Fabrication Jobs
CREATE TABLE public.fabrication_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority TEXT NOT NULL DEFAULT 'normal',
  supplier_id UUID NOT NULL,
  rfq_id UUID REFERENCES public.rfqs(id) ON DELETE SET NULL,
  material TEXT NOT NULL,
  process TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  due_date DATE,
  notes TEXT,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fabrication_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Suppliers can view their own fab jobs"
  ON public.fabrication_jobs FOR SELECT TO authenticated
  USING (supplier_id = auth.uid());

CREATE POLICY "Suppliers can insert their own fab jobs"
  ON public.fabrication_jobs FOR INSERT TO authenticated
  WITH CHECK (supplier_id = auth.uid());

CREATE POLICY "Suppliers can update their own fab jobs"
  ON public.fabrication_jobs FOR UPDATE TO authenticated
  USING (supplier_id = auth.uid());

CREATE INDEX idx_fab_jobs_supplier ON public.fabrication_jobs(supplier_id);
CREATE INDEX idx_fab_jobs_status ON public.fabrication_jobs(status);

-- Fabrication Schedules
CREATE TABLE public.fabrication_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.fabrication_jobs(id) ON DELETE CASCADE,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  resource_name TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'planned',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fabrication_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Suppliers can view their job schedules"
  ON public.fabrication_schedules FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fabrication_jobs
    WHERE fabrication_jobs.id = fabrication_schedules.job_id
      AND fabrication_jobs.supplier_id = auth.uid()
  ));

CREATE POLICY "Suppliers can insert their job schedules"
  ON public.fabrication_schedules FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.fabrication_jobs
    WHERE fabrication_jobs.id = fabrication_schedules.job_id
      AND fabrication_jobs.supplier_id = auth.uid()
  ));

CREATE POLICY "Suppliers can update their job schedules"
  ON public.fabrication_schedules FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fabrication_jobs
    WHERE fabrication_jobs.id = fabrication_schedules.job_id
      AND fabrication_jobs.supplier_id = auth.uid()
  ));

CREATE INDEX idx_fab_schedules_job ON public.fabrication_schedules(job_id);
CREATE INDEX idx_fab_schedules_dates ON public.fabrication_schedules(start_date, end_date);

-- Fabrication Quotes
CREATE TABLE public.fabrication_quotes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.fabrication_jobs(id) ON DELETE SET NULL,
  rfq_id UUID REFERENCES public.rfqs(id) ON DELETE SET NULL,
  supplier_id UUID NOT NULL,
  unit_price_usd NUMERIC(12,2) NOT NULL,
  total_price_usd NUMERIC(12,2) NOT NULL,
  lead_time_days INTEGER NOT NULL,
  breakdown JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  notes TEXT,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fabrication_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Suppliers can view their own fab quotes"
  ON public.fabrication_quotes FOR SELECT TO authenticated
  USING (supplier_id = auth.uid());

CREATE POLICY "Suppliers can insert their own fab quotes"
  ON public.fabrication_quotes FOR INSERT TO authenticated
  WITH CHECK (supplier_id = auth.uid());

CREATE POLICY "Suppliers can update their own fab quotes"
  ON public.fabrication_quotes FOR UPDATE TO authenticated
  USING (supplier_id = auth.uid());

CREATE INDEX idx_fab_quotes_supplier ON public.fabrication_quotes(supplier_id);
CREATE INDEX idx_fab_quotes_rfq ON public.fabrication_quotes(rfq_id);

-- Timestamp triggers
CREATE TRIGGER update_fab_jobs_updated_at
  BEFORE UPDATE ON public.fabrication_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fab_schedules_updated_at
  BEFORE UPDATE ON public.fabrication_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fab_quotes_updated_at
  BEFORE UPDATE ON public.fabrication_quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
