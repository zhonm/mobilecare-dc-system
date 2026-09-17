-- ============================================================================
-- MDC SYSTEM 2: EMERGENCY RUNAWAY API KILL SWITCH & REALTIME LOOP REMEDIATION
-- Target Supabase Project: wjikbnbdkxmesvvzbams
--
-- PURPOSE:
-- 1. Sever all runaway browser client request loops across remote branch PCs.
-- 2. Drop 'profiles', 'user_page_permissions', and 'saved_records' from supabase_realtime
--    publication so PostgreSQL stops broadcasting change events to old client bundles.
-- 3. Restrict anonymous (anon) direct table dumps on 'profiles' and 'master_users_registry'.
-- 4. Terminate all active pooler connections to reset database RAM and connection slots.
-- ============================================================================

-- STEP 1: Remove loop-prone tables from Supabase Realtime publication
DO $$
DECLARE
    tbl text;
    unwanted_realtime_tables text[] := ARRAY[
        'profiles',
        'user_page_permissions',
        'saved_records'
    ];
BEGIN
    FOR tbl IN SELECT unnest(unwanted_realtime_tables) LOOP
        IF EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I;', tbl);
            RAISE NOTICE 'Dropped table public.% from publication supabase_realtime', tbl;
        ELSE
            RAISE NOTICE 'Table public.% is already not in supabase_realtime', tbl;
        END IF;
    END LOOP;
END $$;

-- STEP 2: Prevent anonymous users from querying master_users_registry in saved_records
DROP POLICY IF EXISTS "saved_records_select_anon" ON public.saved_records;
CREATE POLICY "saved_records_select_anon" ON public.saved_records
    FOR SELECT TO anon
    USING (
        id IN (
            'master_supervisor_settings_registry',
            'master_auto_logout_settings_registry',
            'deleted_shipment_ids_registry',
            'deleted_intake_ids_registry',
            'deleted_unit_serials_registry'
        )
        OR record_type IN ('intake_record', 'intake_batch', 'shipment', 'deletion_registry')
    );

-- STEP 3: Prevent anonymous users from bulk-dumping profiles table directly
-- (Login authentication continues to operate via verify_login_credentials SECURITY DEFINER RPC)
DROP POLICY IF EXISTS "profiles_select_anon" ON public.profiles;
CREATE POLICY "profiles_select_anon" ON public.profiles
    FOR SELECT TO anon
    USING (false);

-- STEP 4: Forcibly terminate all active client pooler connections
-- This severs existing websocket loops and idle keep-alive connections immediately.
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND usename IN ('anon', 'authenticated');

-- STEP 5: Verification Output
SELECT 
    schemaname, 
    tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
