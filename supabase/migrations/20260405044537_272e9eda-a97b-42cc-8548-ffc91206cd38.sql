
ALTER TABLE public.tenant_members
ADD COLUMN licensed_products text[] NOT NULL DEFAULT ARRAY['midwater', 'fabrication_os'];
