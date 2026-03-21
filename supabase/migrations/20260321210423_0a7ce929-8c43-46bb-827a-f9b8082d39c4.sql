
-- Pricing accounts: per-customer/tenant configuration
CREATE TABLE public.pricing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_name text NOT NULL,
  account_type text NOT NULL DEFAULT 'standard',
  base_margin_pct numeric NOT NULL DEFAULT 15.0,
  preferred_supplier_ids uuid[] NOT NULL DEFAULT '{}',
  metadata jsonb DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read pricing_accounts"
  ON public.pricing_accounts FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Creator manage pricing_accounts"
  ON public.pricing_accounts FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Creator update pricing_accounts"
  ON public.pricing_accounts FOR UPDATE TO authenticated
  USING (created_by = auth.uid());

-- Pricing rules: volume discounts, margin overrides, supplier preferences
CREATE TABLE public.pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.pricing_accounts(id) ON DELETE CASCADE NOT NULL,
  rule_type text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  conditions jsonb NOT NULL DEFAULT '{}',
  adjustments jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_rule_type CHECK (rule_type IN ('volume_discount', 'margin_override', 'preferred_supplier', 'material_markup', 'process_markup', 'certification_surcharge', 'region_adjustment'))
);

ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read pricing_rules"
  ON public.pricing_rules FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Account owner insert pricing_rules"
  ON public.pricing_rules FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.pricing_accounts
    WHERE id = pricing_rules.account_id AND created_by = auth.uid()
  ));

CREATE POLICY "Account owner update pricing_rules"
  ON public.pricing_rules FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pricing_accounts
    WHERE id = pricing_rules.account_id AND created_by = auth.uid()
  ));

-- Price quotes log: audit trail
CREATE TABLE public.price_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.pricing_accounts(id) ON DELETE SET NULL,
  base_cost_usd numeric NOT NULL,
  final_price_usd numeric NOT NULL,
  margin_pct numeric NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  material text NOT NULL,
  process text NOT NULL,
  applied_rules jsonb NOT NULL DEFAULT '[]',
  line_items jsonb NOT NULL DEFAULT '[]',
  metadata jsonb DEFAULT '{}',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creator read price_quotes"
  ON public.price_quotes FOR SELECT TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Authenticated insert price_quotes"
  ON public.price_quotes FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Indexes
CREATE INDEX idx_pricing_rules_account ON public.pricing_rules(account_id);
CREATE INDEX idx_pricing_rules_type ON public.pricing_rules(rule_type);
CREATE INDEX idx_price_quotes_account ON public.price_quotes(account_id);
CREATE INDEX idx_price_quotes_created ON public.price_quotes(created_at DESC);
