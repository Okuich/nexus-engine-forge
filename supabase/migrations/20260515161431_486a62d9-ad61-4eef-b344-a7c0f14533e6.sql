
-- Async simplification jobs
CREATE TABLE IF NOT EXISTS public.simplification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid,
  job_type text NOT NULL DEFAULT 'lods',
  status text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  message text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_triangles integer,
  output_triangles integer,
  result_path text,
  result_size_bytes integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT simplification_jobs_status_chk
    CHECK (status IN ('queued','running','completed','failed','cancelled')),
  CONSTRAINT simplification_jobs_progress_chk
    CHECK (progress BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS simplification_jobs_user_idx
  ON public.simplification_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS simplification_jobs_status_idx
  ON public.simplification_jobs (status);

ALTER TABLE public.simplification_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own simplification jobs"
  ON public.simplification_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Owner creates simplification jobs"
  ON public.simplification_jobs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owner updates own simplification jobs"
  ON public.simplification_jobs FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER simplification_jobs_set_updated_at
  BEFORE UPDATE ON public.simplification_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage: private bucket for result artifacts
INSERT INTO storage.buckets (id, name, public)
VALUES ('simplification-results', 'simplification-results', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read own simplification results"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'simplification-results'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users write own simplification results"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'simplification-results'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users delete own simplification results"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'simplification-results'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
