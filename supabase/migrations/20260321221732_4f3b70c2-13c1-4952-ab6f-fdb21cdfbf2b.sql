
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_tenant_id uuid;
  tenant_slug text;
  display_name text;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );

  -- Generate a unique slug from email
  tenant_slug := LOWER(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', '-')) || '-' || SUBSTR(NEW.id::text, 1, 8);
  display_name := COALESCE(
    NULLIF(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''), ''),
    SPLIT_PART(NEW.email, '@', 1)
  );

  -- Create tenant
  INSERT INTO public.tenants (name, slug)
  VALUES (display_name || '''s Workspace', tenant_slug)
  RETURNING id INTO new_tenant_id;

  -- Add user as owner
  INSERT INTO public.tenant_members (tenant_id, user_id, role, joined_at)
  VALUES (new_tenant_id, NEW.id, 'owner', NOW());

  -- Add to user_roles table
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'owner');

  -- Audit log
  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, metadata)
  VALUES (new_tenant_id, NEW.id, 'tenant.auto_created', 'tenant', new_tenant_id::text, jsonb_build_object('slug', tenant_slug));

  RETURN NEW;
END;
$$;
