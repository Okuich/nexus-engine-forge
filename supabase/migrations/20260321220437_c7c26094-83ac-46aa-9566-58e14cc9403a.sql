
-- Add new roles to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'engineer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'procurement';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supplier';
