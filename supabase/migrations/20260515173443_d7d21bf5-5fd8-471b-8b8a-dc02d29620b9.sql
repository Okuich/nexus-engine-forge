CREATE INDEX IF NOT EXISTS idx_simplification_jobs_user_created_at
  ON public.simplification_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_simplification_jobs_user_status
  ON public.simplification_jobs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_simplification_jobs_batch_index
  ON public.simplification_jobs (batch_id, batch_index)
  WHERE batch_id IS NOT NULL;