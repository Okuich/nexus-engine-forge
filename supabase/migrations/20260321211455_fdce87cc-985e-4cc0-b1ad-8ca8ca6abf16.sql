
CREATE TABLE public.supplier_trust_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  avg_response_time_hrs numeric NOT NULL DEFAULT 0,
  on_time_delivery_rate numeric NOT NULL DEFAULT 1.0,
  quote_accuracy_rate numeric NOT NULL DEFAULT 1.0,
  avg_quality_rating numeric NOT NULL DEFAULT 0.8,
  total_orders integer NOT NULL DEFAULT 0,
  total_quotes integer NOT NULL DEFAULT 0,
  disputes integer NOT NULL DEFAULT 0,
  trust_score numeric NOT NULL DEFAULT 50,
  tier text NOT NULL DEFAULT 'bronze',
  last_recalculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id)
);

ALTER TABLE public.supplier_trust_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read trust scores"
  ON public.supplier_trust_scores FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System insert trust scores"
  ON public.supplier_trust_scores FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.supplier_profiles
      WHERE id = supplier_trust_scores.supplier_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "System update trust scores"
  ON public.supplier_trust_scores FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supplier_profiles
      WHERE id = supplier_trust_scores.supplier_id
        AND user_id = auth.uid()
    )
  );
