DROP TABLE IF EXISTS public.fabrication_quotes CASCADE;
DROP TABLE IF EXISTS public.fabrication_schedules CASCADE;
DROP TABLE IF EXISTS public.fabrication_jobs CASCADE;

ALTER TABLE public.tenant_members
  ALTER COLUMN licensed_products SET DEFAULT ARRAY['midwater']::text[];

UPDATE public.tenant_members
SET licensed_products = ARRAY(
  SELECT DISTINCT unnest(licensed_products) EXCEPT SELECT 'fabrication_os'
)
WHERE 'fabrication_os' = ANY(licensed_products);

UPDATE public.tenant_members
SET licensed_products = ARRAY['midwater']::text[]
WHERE licensed_products IS NULL OR array_length(licensed_products, 1) IS NULL;