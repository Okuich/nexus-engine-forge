
-- Cost feedback table for storing predicted vs actual costs
CREATE TABLE public.cost_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id TEXT NOT NULL,
  predicted_cost DOUBLE PRECISION NOT NULL,
  actual_cost DOUBLE PRECISION NOT NULL,
  material TEXT NOT NULL,
  process TEXT NOT NULL,
  complexity_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  correction_factor DOUBLE PRECISION,
  notes TEXT,
  tenant_id UUID REFERENCES public.tenants(id),
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cost_feedback ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Tenant members read cost_feedback"
  ON public.cost_feedback FOR SELECT
  USING (tenant_id IS NULL OR is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "Tenant members insert cost_feedback"
  ON public.cost_feedback FOR INSERT
  WITH CHECK (tenant_id IS NULL OR is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "Tenant members update cost_feedback"
  ON public.cost_feedback FOR UPDATE
  USING (tenant_id IS NULL OR is_tenant_member(auth.uid(), tenant_id));

-- Index for correction factor queries
CREATE INDEX idx_cost_feedback_material ON public.cost_feedback(material);
CREATE INDEX idx_cost_feedback_process ON public.cost_feedback(process);

-- Enable realtime for live correction factor updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.cost_feedback;
