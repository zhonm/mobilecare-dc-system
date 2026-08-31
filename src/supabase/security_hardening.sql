-- ============================================================================
-- MDC SYSTEM 2: Security Hardening & Exploit Prevention Migration
-- Tightens Row Level Security (RLS), restricts unauthorized drops/deletions,
-- and protects User Accounts and Core Database Tables.
-- ============================================================================

-- 1. Ensure RLS is active on all core tables
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_page_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecast_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS allocation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS saved_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dc_intake_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory_units ENABLE ROW LEVEL SECURITY;

-- 2. Clean up legacy overly permissive policies
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT schemaname, tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
    END LOOP;
END $$;

-- 3. Hardened Policies for Profiles & User Permissions
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "profiles_insert_own_or_superadmin" ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "profiles_update_own_or_superadmin" ON public.profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'))
    WITH CHECK (auth.uid() = id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "profiles_delete_superadmin_only" ON public.profiles
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "user_page_permissions_select" ON public.user_page_permissions
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "user_page_permissions_manage_superadmin" ON public.user_page_permissions
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'));

-- 4. Hardened Policies for Saved Period Records & Intake Records
CREATE POLICY "saved_records_select_authenticated" ON public.saved_records
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "saved_records_write_authenticated" ON public.saved_records
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "saved_records_update_authenticated" ON public.saved_records
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "saved_records_delete_admin" ON public.saved_records
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "dc_intake_records_select_authenticated" ON public.dc_intake_records
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "dc_intake_records_write_authenticated" ON public.dc_intake_records
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "dc_intake_records_update_authenticated" ON public.dc_intake_records
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "dc_intake_records_delete_admin" ON public.dc_intake_records
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

-- 5. Inventory Units Security
CREATE POLICY "inventory_units_select_authenticated" ON public.inventory_units
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "inventory_units_write_authenticated" ON public.inventory_units
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "inventory_units_update_authenticated" ON public.inventory_units
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "inventory_units_delete_admin" ON public.inventory_units
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

-- 6. Grant schema and table permissions (RLS strictly controls data access)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role, postgres;