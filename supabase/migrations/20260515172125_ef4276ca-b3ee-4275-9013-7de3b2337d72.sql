
CREATE TABLE IF NOT EXISTS public.simplify_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  prefix text NOT NULL,                       -- first 8 chars of the raw key, for display/lookup
  key_hash text NOT NULL,                     -- sha256(raw_key) hex
  scopes text[] NOT NULL DEFAULT ARRAY['jobs:read','jobs:write']::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key_hash),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS simplify_api_keys_prefix_idx ON public.simplify_api_keys (prefix);
CREATE INDEX IF NOT EXISTS simplify_api_keys_user_idx ON public.simplify_api_keys (user_id, created_at DESC);

ALTER TABLE public.simplify_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner creates api keys"
  ON public.simplify_api_keys FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Owner reads own api keys"
  ON public.simplify_api_keys FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Owner updates own api keys"
  ON public.simplify_api_keys FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER simplify_api_keys_set_updated_at
  BEFORE UPDATE ON public.simplify_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
