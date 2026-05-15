
-- Batch grouping for queue-backed bulk simplification
ALTER TABLE public.simplification_jobs
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS batch_index integer,
  ADD COLUMN IF NOT EXISTS batch_label text;

CREATE INDEX IF NOT EXISTS simplification_jobs_batch_idx
  ON public.simplification_jobs (batch_id, batch_index);

CREATE TABLE IF NOT EXISTS public.simplification_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid,
  name text,
  total_jobs integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','cancelled','partial')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS simplification_batches_user_idx
  ON public.simplification_batches (user_id, created_at DESC);

ALTER TABLE public.simplification_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner creates simplification batches"
  ON public.simplification_batches FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Owner reads own simplification batches"
  ON public.simplification_batches FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Owner updates own simplification batches"
  ON public.simplification_batches FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER simplification_batches_set_updated_at
  BEFORE UPDATE ON public.simplification_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
