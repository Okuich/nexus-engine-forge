
CREATE TABLE public.training_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','preprocessing','training','evaluating','completed','failed','cancelled')),
  model_type TEXT NOT NULL DEFAULT 'gat',
  dataset_id TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  metrics JSONB DEFAULT '{}',
  progress INTEGER NOT NULL DEFAULT 0,
  epochs_completed INTEGER NOT NULL DEFAULT 0,
  epochs_total INTEGER NOT NULL DEFAULT 100,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.training_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.training_jobs(id) ON DELETE CASCADE NOT NULL,
  epoch INTEGER NOT NULL,
  train_loss DOUBLE PRECISION,
  val_loss DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  f1_score DOUBLE PRECISION,
  learning_rate DOUBLE PRECISION,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.model_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.training_jobs(id) ON DELETE CASCADE NOT NULL,
  version TEXT NOT NULL,
  model_type TEXT NOT NULL,
  metrics JSONB DEFAULT '{}',
  artifact_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.training_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on training_jobs" ON public.training_jobs FOR SELECT USING (true);
CREATE POLICY "Allow public insert on training_jobs" ON public.training_jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on training_jobs" ON public.training_jobs FOR UPDATE USING (true);

CREATE POLICY "Allow public read on training_metrics" ON public.training_metrics FOR SELECT USING (true);
CREATE POLICY "Allow public insert on training_metrics" ON public.training_metrics FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read on model_versions" ON public.model_versions FOR SELECT USING (true);
CREATE POLICY "Allow public insert on model_versions" ON public.model_versions FOR INSERT WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.training_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.training_metrics;
