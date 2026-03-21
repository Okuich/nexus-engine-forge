
-- Marketplace orders: links RFQ award to a payable order
CREATE TABLE public.marketplace_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid REFERENCES public.rfqs(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.rfq_quotes(id) ON DELETE SET NULL,
  buyer_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id),
  unit_price_usd numeric NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  subtotal_usd numeric NOT NULL,
  platform_fee_usd numeric NOT NULL DEFAULT 0,
  platform_fee_pct numeric NOT NULL DEFAULT 5.0,
  supplier_payout_usd numeric NOT NULL DEFAULT 0,
  tax_usd numeric NOT NULL DEFAULT 0,
  total_usd numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_order_status CHECK (status IN ('pending', 'confirmed', 'paid', 'processing', 'shipped', 'completed', 'cancelled', 'refunded', 'disputed'))
);

ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyer or supplier read orders"
  ON public.marketplace_orders FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.supplier_profiles
      WHERE id = marketplace_orders.supplier_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Buyer create orders"
  ON public.marketplace_orders FOR INSERT TO authenticated
  WITH CHECK (buyer_id = auth.uid());

CREATE POLICY "Buyer update orders"
  ON public.marketplace_orders FOR UPDATE TO authenticated
  USING (buyer_id = auth.uid());

-- Marketplace payments: tracks payment lifecycle
CREATE TABLE public.marketplace_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  payer_id uuid NOT NULL,
  amount_usd numeric NOT NULL,
  platform_fee_usd numeric NOT NULL DEFAULT 0,
  supplier_payout_usd numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'platform_balance',
  external_payment_id text,
  status text NOT NULL DEFAULT 'pending',
  failure_reason text,
  paid_at timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_payment_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded'))
);

ALTER TABLE public.marketplace_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payer or supplier read payments"
  ON public.marketplace_payments FOR SELECT TO authenticated
  USING (
    payer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.marketplace_orders o
      JOIN public.supplier_profiles sp ON sp.id = o.supplier_id
      WHERE o.id = marketplace_payments.order_id AND sp.user_id = auth.uid()
    )
  );

CREATE POLICY "Payer create payments"
  ON public.marketplace_payments FOR INSERT TO authenticated
  WITH CHECK (payer_id = auth.uid());

CREATE POLICY "Payer update payments"
  ON public.marketplace_payments FOR UPDATE TO authenticated
  USING (payer_id = auth.uid());

-- Supplier payouts: tracks disbursements to suppliers
CREATE TABLE public.supplier_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id),
  payment_id uuid NOT NULL REFERENCES public.marketplace_payments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  amount_usd numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payout_method text NOT NULL DEFAULT 'platform_balance',
  external_payout_id text,
  processed_at timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_payout_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

ALTER TABLE public.supplier_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Supplier read own payouts"
  ON public.supplier_payouts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supplier_profiles
      WHERE id = supplier_payouts.supplier_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "System insert payouts"
  ON public.supplier_payouts FOR INSERT TO authenticated
  WITH CHECK (true);

-- Indexes
CREATE INDEX idx_orders_buyer ON public.marketplace_orders(buyer_id);
CREATE INDEX idx_orders_supplier ON public.marketplace_orders(supplier_id);
CREATE INDEX idx_orders_status ON public.marketplace_orders(status);
CREATE INDEX idx_payments_order ON public.marketplace_payments(order_id);
CREATE INDEX idx_payments_status ON public.marketplace_payments(status);
CREATE INDEX idx_payouts_supplier ON public.supplier_payouts(supplier_id);
CREATE INDEX idx_payouts_status ON public.supplier_payouts(status);
