
ALTER TABLE public.prospect_companies ADD COLUMN lead_status text NOT NULL DEFAULT 'new';

CREATE POLICY "Authenticated users can update prospect_companies"
ON public.prospect_companies
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);
