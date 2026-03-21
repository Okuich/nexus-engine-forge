CREATE TABLE public.prospect_companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  website TEXT,
  city TEXT,
  state TEXT,
  specialties TEXT,
  certifications TEXT,
  contact_name TEXT,
  contact_title TEXT,
  contact_linkedin TEXT,
  contact_email TEXT,
  employee_range TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.prospect_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read prospect companies"
  ON public.prospect_companies
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert"
  ON public.prospect_companies
  FOR INSERT
  TO authenticated
  WITH CHECK (true);