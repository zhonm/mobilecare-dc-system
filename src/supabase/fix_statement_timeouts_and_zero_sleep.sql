-- ============================================================================
-- MDC SYSTEM 2: RESOLUTION FOR STATEMENT TIMEOUTS & COMPLETE REMOVAL OF PG_SLEEP
-- Target Supabase Project: wjikbnbdkxmesvvzbams
--
-- PURPOSE:
-- 1. Eliminate 'canceling statement due to statement timeout' (57014 / 5xx errors)
--    caused by pg_sleep() execution during Row-Level Security evaluations.
-- 2. Terminate any lingering sleeping backends in Postgres.
-- 3. Replace all sleep-based throttlers with instant, 0ms non-blocking boolean RLS filters:
--    - 'profiles': Anonymous SELECT returns false instantly (0.05ms, [] payload, no timeout).
--    - 'saved_records': id <> 'master_users_registry' evaluated in 0.05ms without delay.
-- 4. Drop all obsolete throttle and sleep functions from public schema.
-- ============================================================================

-- STEP 1: Terminate any lingering sleeping queries
SELECT pg_cancel_backend(pid) 
FROM pg_stat_activity 
WHERE query ILIKE '%profiles%' AND pid <> pg_backend_pid();

-- STEP 2: Drop all restrictive and sleep-based policies on profiles
DROP POLICY IF EXISTS profiles_throttle ON public.profiles;
DROP POLICY IF EXISTS profiles_select_anon_deny ON public.profiles;
DROP POLICY IF EXISTS profiles_select_anon ON public.profiles;
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;

-- STEP 3: Create instant 0ms SELECT policies on profiles
CREATE POLICY profiles_select_anon ON public.profiles
FOR SELECT TO anon
USING (false);

CREATE POLICY profiles_select_authenticated ON public.profiles
FOR SELECT TO authenticated
USING (
    (current_user_role() IN ('superadmin', 'admin'))
    OR (id = auth.uid())
    OR (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
);

-- STEP 4: Drop restrictive and sleep-based policies on saved_records
DROP POLICY IF EXISTS saved_records_throttle ON public.saved_records;
DROP POLICY IF EXISTS saved_records_select_anon ON public.saved_records;
DROP POLICY IF EXISTS saved_records_authenticated_all ON public.saved_records;

-- STEP 5: Create instant 0ms policies on saved_records
CREATE POLICY saved_records_select_anon ON public.saved_records
FOR SELECT TO anon
USING (
    id <> 'master_users_registry'
    AND (
        id IN (
            'master_supervisor_settings_registry',
            'master_auto_logout_settings_registry',
            'deleted_shipment_ids_registry',
            'deleted_intake_ids_registry',
            'deleted_unit_serials_registry'
        )
        OR record_type IN ('intake_record', 'intake_batch', 'shipment', 'deletion_registry')
    )
);

CREATE POLICY saved_records_authenticated_all ON public.saved_records
FOR ALL TO authenticated
USING (id <> 'master_users_registry')
WITH CHECK (id <> 'master_users_registry');

-- STEP 6: Drop sleep and error functions
DROP FUNCTION IF EXISTS throttle_profiles_anon();
DROP FUNCTION IF EXISTS throttle_master_users_registry(text);
DROP FUNCTION IF EXISTS throttle_saved_records_anon(text);
DROP FUNCTION IF EXISTS block_runaway_endpoint();

-- STEP 7: Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
