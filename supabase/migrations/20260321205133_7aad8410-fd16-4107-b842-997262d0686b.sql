
-- Supplier profiles (extends the built-in catalog with DB-backed suppliers)
CREATE TABLE public.supplier_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_name text NOT NULL,
  materials text[] NOT NULL DEFAULT '{}',
  processes text[] NOT NULL DEFAULT '{}',
  max_complexity numeric NOT NULL DEFAULT 0.8,
  advanced_surfaces text[] NOT NULL DEFAULT '{}',
  lead_time_days integer NOT NULL DEFAULT 10,
  quality_rating numeric NOT NULL DEFAULT 0.8,
  region text NOT NULL DEFAULT 'US-East',
  min_order_usd numeric NOT NULL DEFAULT 100,
  pricing_multiplier numeric NOT NULL DEFAULT 1.0,
  certifications text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  tenant_id uuid REFERENCES public.tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Suppliers read own profile" ON public.supplier_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR (tenant_id IS NULL) OR is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "Suppliers manage own profile" ON public.supplier_profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Suppliers update own profile" ON public.supplier_profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- RFQs (Request for Quotation)
CREATE TABLE public.rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  part_name text NOT NULL,
  material text NOT NULL,
  process text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  complexity_score numeric NOT NULL DEFAULT 0.5,
  surface_classes text[] NOT NULL DEFAULT '{}',
  required_certifications text[] NOT NULL DEFAULT '{}',
  max_lead_time_days integer,
  region text,
  target_cost_usd numeric,
  geometry_stats jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'open',
  created_by uuid NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id),
  deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read rfqs" ON public.rfqs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated create rfqs" ON public.rfqs
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "Creator update rfqs" ON public.rfqs
  FOR UPDATE TO authenticated USING (created_by = auth.uid());

-- RFQ Quotes (supplier responses to RFQs)
CREATE TABLE public.rfq_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  unit_price_usd numeric NOT NULL,
  total_price_usd numeric NOT NULL,
  lead_time_days integer NOT NULL,
  notes text,
  adjustments jsonb DEFAULT '[]',
  confidence numeric NOT NULL DEFAULT 0.8,
  status text NOT NULL DEFAULT 'submitted',
  rank integer,
  score numeric,
  score_breakdown jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rfq_id, supplier_id)
);

ALTER TABLE public.rfq_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "RFQ creator and supplier read quotes" ON public.rfq_quotes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.rfqs WHERE rfqs.id = rfq_id AND rfqs.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.supplier_profiles WHERE supplier_profiles.id = supplier_id AND supplier_profiles.user_id = auth.uid())
  );

CREATE POLICY "Suppliers submit quotes" ON public.rfq_quotes
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.supplier_profiles WHERE supplier_profiles.id = supplier_id AND supplier_profiles.user_id = auth.uid())
  );

CREATE POLICY "Suppliers update own quotes" ON public.rfq_quotes
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.supplier_profiles WHERE supplier_profiles.id = supplier_id AND supplier_profiles.user_id = auth.uid())
  );

-- Indexes for performance
CREATE INDEX idx_rfqs_status ON public.rfqs(status);
CREATE INDEX idx_rfqs_material ON public.rfqs(material);
CREATE INDEX idx_rfqs_created_by ON public.rfqs(created_by);
CREATE INDEX idx_rfq_quotes_rfq_id ON public.rfq_quotes(rfq_id);
CREATE INDEX idx_rfq_quotes_supplier_id ON public.rfq_quotes(supplier_id);
CREATE INDEX idx_supplier_profiles_user_id ON public.supplier_profiles(user_id);
