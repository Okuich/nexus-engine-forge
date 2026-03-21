
CREATE TABLE public.supplier_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  order_id uuid REFERENCES public.marketplace_orders(id) ON DELETE SET NULL,
  rating integer NOT NULL,
  title text,
  comment text,
  response text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_review_rating()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_review_rating
  BEFORE INSERT OR UPDATE ON public.supplier_reviews
  FOR EACH ROW EXECUTE FUNCTION public.validate_review_rating();

ALTER TABLE public.supplier_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read reviews"
  ON public.supplier_reviews FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Reviewer create review"
  ON public.supplier_reviews FOR INSERT
  TO authenticated
  WITH CHECK (reviewer_id = auth.uid());

CREATE POLICY "Reviewer update own review"
  ON public.supplier_reviews FOR UPDATE
  TO authenticated
  USING (reviewer_id = auth.uid());

CREATE POLICY "Supplier respond to review"
  ON public.supplier_reviews FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supplier_profiles
      WHERE id = supplier_reviews.supplier_id
        AND user_id = auth.uid()
    )
  );
