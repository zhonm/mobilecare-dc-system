-- Final parts catalog security migration.
-- Run this after any legacy RLS migration so permissive policies cannot remain active.

ALTER TABLE IF EXISTS public.parts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'parts'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.parts', policy_row.policyname);
  END LOOP;
END $$;

CREATE POLICY "parts_catalog_select_authenticated"
  ON public.parts
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "parts_catalog_manage_admin"
  ON public.parts
  FOR ALL
  TO authenticated
  USING (public.current_user_role() IN ('superadmin', 'admin'))
  WITH CHECK (public.current_user_role() IN ('superadmin', 'admin'));

REVOKE ALL ON public.parts FROM anon;
GRANT SELECT ON public.parts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.parts TO authenticated;