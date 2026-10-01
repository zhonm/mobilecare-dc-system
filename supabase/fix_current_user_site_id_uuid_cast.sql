-- Prevent JWT metadata values such as 'site-dc' from being cast to UUID.
-- Run this migration in the Supabase SQL Editor for the active project.

CREATE OR REPLACE FUNCTION public.current_user_site_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
  SELECT COALESCE(
    CASE
      WHEN (auth.jwt() -> 'user_metadata' ->> 'site_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (auth.jwt() -> 'user_metadata' ->> 'site_id')::UUID
      ELSE NULL
    END,
    (SELECT site_id
     FROM public.profiles
     WHERE id = auth.uid() AND is_active = true
     LIMIT 1)
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_site_id() TO anon, authenticated;
