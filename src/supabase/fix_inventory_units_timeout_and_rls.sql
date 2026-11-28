-- ==============================================================================
-- MDC SYSTEM 2: Fix inventory_units 57014 Statement Timeouts & Duplicate RLS
-- Root Causes Identified from Postgres Logs (supabase_logs (3).csv):
--   1. Duplicate permissive SELECT RLS policies on public.inventory_units caused
--      PostgreSQL to evaluate the entire RLS filter TWICE per row.
--   2. Unwrapped public.current_user_role() and public.is_central_dc_site() calls
--      inside RLS prevented InitPlan caching, executing per-row across 30,000+ rows.
--   3. Missing B-tree index on public.inventory_units(created_at ASC) forced full
--      Seq Scan + Sort (~10.5s per page), causing 57014 timeouts, PostgREST Warp
--      thread kills, collateral 500s on saved_records, and Realtime slot stalls.
--
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/wjikbnbdkxmesvvzbams/sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. DROP ALL EXISTING / DUPLICATE RLS POLICIES ON public.inventory_units
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'inventory_units'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.inventory_units;', pol.policyname);
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 2. RECREATE SINGLE, INITPLAN-OPTIMIZED RLS POLICIES ON public.inventory_units
-- Wrapping functions in (SELECT ...) forces PostgreSQL to evaluate them ONCE per
-- query (InitPlan) instead of once per scanned row.
-- ------------------------------------------------------------------------------
ALTER TABLE public.inventory_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_units_select" ON public.inventory_units
    FOR SELECT TO anon, authenticated
    USING (
        (SELECT public.current_user_role()) IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff', 'anon')
        OR (
            (SELECT public.current_user_role()) = 'parts_management'
            AND NOT COALESCE(
                current_site_id = ANY (ARRAY(SELECT id FROM public.sites WHERE is_dc = true)),
                false
            )
        )
    );

CREATE POLICY "inventory_units_insert" ON public.inventory_units
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.current_user_role()) IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            (SELECT public.current_user_role()) = 'parts_management'
            AND current_site_id = (SELECT public.current_user_site_id())
            AND NOT COALESCE(
                current_site_id = ANY (ARRAY(SELECT id FROM public.sites WHERE is_dc = true)),
                false
            )
        )
    );

CREATE POLICY "inventory_units_update" ON public.inventory_units
    FOR UPDATE TO authenticated
    USING (
        (SELECT public.current_user_role()) IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            (SELECT public.current_user_role()) = 'parts_management'
            AND current_site_id = (SELECT public.current_user_site_id())
            AND NOT COALESCE(
                current_site_id = ANY (ARRAY(SELECT id FROM public.sites WHERE is_dc = true)),
                false
            )
        )
    )
    WITH CHECK (
        (SELECT public.current_user_role()) IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            (SELECT public.current_user_role()) = 'parts_management'
            AND current_site_id = (SELECT public.current_user_site_id())
            AND NOT COALESCE(
                current_site_id = ANY (ARRAY(SELECT id FROM public.sites WHERE is_dc = true)),
                false
            )
        )
    );

CREATE POLICY "inventory_units_delete_admin_only" ON public.inventory_units
    FOR DELETE TO authenticated
    USING ((SELECT public.current_user_role()) IN ('superadmin', 'admin'));

-- ------------------------------------------------------------------------------
-- 3. ADD MISSING PAGINATION & DELTA-SYNC INDEXES ON public.inventory_units
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inventory_units_created_at
    ON public.inventory_units (created_at ASC);

CREATE INDEX IF NOT EXISTS idx_inventory_units_updated_at
    ON public.inventory_units (updated_at DESC);

-- ------------------------------------------------------------------------------
-- 4. REFRESH PLANNER STATISTICS & RELOAD POSTGREST SCHEMA CACHE
-- ------------------------------------------------------------------------------
ANALYZE public.inventory_units;
ANALYZE public.saved_records;
ANALYZE public.sites;

NOTIFY pgrst, 'reload schema';
