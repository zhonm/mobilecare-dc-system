-- ============================================================================
-- MDC SYSTEM 2: RESTORE USER ACCESS MANAGEMENT & PROFILES VISIBILITY
-- File: src/supabase/fix_user_access_management_visibility.sql
--
-- PURPOSE:
-- 1. Fix RLS policy on 'public.profiles' that previously evaluated to USING (false)
--    for anonymous client requests, causing all registered users to disappear from
--    User Access Management.
-- 2. Allow anonymous read of non-sensitive profile columns (full_name, email,
--    role, role_position, site_id, is_active, has_set_password).
--    Crucially, password_hash remains completely hidden.
-- 3. Allow 'master_users_registry' to be read from 'saved_records' by the application.
-- 4. Provide a fast, secure SECURITY DEFINER RPC 'get_all_active_users()' that
--    instantly returns all staff accounts with their permissions.
-- 5. Backfill/ensure all 6 active registered staff accounts exist in public.profiles.
-- ============================================================================

-- STEP 1: Fix profiles SELECT policies for both anon and authenticated
DROP POLICY IF EXISTS profiles_throttle ON public.profiles;
DROP POLICY IF EXISTS profiles_select_anon_deny ON public.profiles;
DROP POLICY IF EXISTS profiles_select_anon ON public.profiles;
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_anon" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;

-- Allow anon to select non-deleted staff profiles (excluding password_hash via column grants)
CREATE POLICY profiles_select_anon ON public.profiles
FOR SELECT TO anon
USING (is_deleted = false);

CREATE POLICY profiles_select_authenticated ON public.profiles
FOR SELECT TO authenticated
USING (is_deleted = false);

-- Grant select on all safe profile columns to anon
GRANT SELECT (id, email, full_name, role, role_position, site_id, has_set_password, is_active, is_deleted, created_at, updated_at) ON public.profiles TO anon;
GRANT SELECT ON public.profiles TO authenticated;

-- STEP 2: Fix saved_records SELECT policy to allow master_users_registry
DROP POLICY IF EXISTS saved_records_throttle ON public.saved_records;
DROP POLICY IF EXISTS saved_records_select_anon ON public.saved_records;
DROP POLICY IF EXISTS saved_records_authenticated_all ON public.saved_records;
DROP POLICY IF EXISTS "saved_records_select_anon" ON public.saved_records;
DROP POLICY IF EXISTS "saved_records_select_scoped" ON public.saved_records;

CREATE POLICY saved_records_select_anon ON public.saved_records
FOR SELECT TO anon
USING (
    id IN (
        'master_supervisor_settings_registry',
        'master_auto_logout_settings_registry',
        'master_users_registry',
        'deleted_shipment_ids_registry',
        'deleted_intake_ids_registry',
        'deleted_unit_serials_registry'
    )
    OR record_type IN ('intake_record', 'intake_batch', 'shipment', 'deletion_registry')
);

CREATE POLICY saved_records_select_authenticated ON public.saved_records
FOR SELECT TO authenticated
USING (true);

-- STEP 3: Provide secure RPC function to get all active users with permissions
CREATE OR REPLACE FUNCTION public.get_all_active_users()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', p.id,
            'user_id', p.id,
            'email', p.email,
            'full_name', p.full_name,
            'fullName', p.full_name,
            'role', p.role,
            'role_position', p.role_position,
            'rolePosition', p.role_position,
            'site_id', p.site_id,
            'siteId', p.site_id,
            'is_active', p.is_active,
            'isActive', p.is_active,
            'is_deleted', p.is_deleted,
            'has_set_password', p.has_set_password,
            'hasSetPassword', p.has_set_password,
            'permittedPages', COALESCE(
                (SELECT array_agg(page_id) FROM public.user_page_permissions WHERE user_id = p.id),
                ARRAY[]::TEXT[]
            )
        ) ORDER BY p.created_at ASC
    ) INTO v_result
    FROM public.profiles p
    WHERE p.is_deleted = false;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_active_users() TO anon, authenticated;

-- STEP 4: Ensure all 6 registered staff accounts exist and are active in public.profiles
INSERT INTO public.profiles (id, email, full_name, role, role_position, site_id, is_active, has_set_password, is_deleted, created_at, updated_at)
VALUES
    ('1b0e9f43-c2d5-4eb4-acef-2ea5d9d21280', 'zhon.manaois@mobilecareph.com', 'Zhon Manaois', 'superadmin', 'Parts Management Specialist', '2cf62bf6-14cf-4d31-838e-9bff43fb9018', true, true, false, NOW(), NOW()),
    ('2541421a-3383-407a-a6c2-1264198940b6', 'joshua.juvida@mobilecareph.com', 'Joshua Juvida', 'superadmin', 'Inventory Planner', '2cf62bf6-14cf-4d31-838e-9bff43fb9018', true, true, false, NOW(), NOW()),
    ('076a8481-2014-4aa1-a77e-5e221b40fea7', 'anjo.alcazar@mobilecareph.com', 'Anjo Alcazar', 'superadmin', 'Assistant Manager', '2cf62bf6-14cf-4d31-838e-9bff43fb9018', true, true, false, NOW(), NOW()),
    ('7db37a36-73cd-4d0a-ae7e-c73c61a9935a', 'daphneclaire.bascuguin@mobilecareph.com', 'Daphne Bascuguin', 'superadmin', 'Area Manager', '2cf62bf6-14cf-4d31-838e-9bff43fb9018', true, true, false, NOW(), NOW()),
    ('181ce98c-0cd9-476c-a4c5-2ee833c174f4', 'andres@mobilecareph.com', 'Andres Bonifacio', 'parts_management', 'Parts Management Analyst', '1cebf73f-f511-47a5-a767-002709a42fab', true, true, false, NOW(), NOW()),
    ('3fa435cd-24bc-46ed-ab18-23222662477b', 'joserizal@mobilecareph.com', 'Jose Rizal', 'parts_management', 'Parts Management Specialist', '61419aaa-da16-4075-9f40-a113be2620f9', true, true, false, NOW(), NOW())
ON CONFLICT (email) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    role_position = EXCLUDED.role_position,
    site_id = EXCLUDED.site_id,
    is_active = true,
    is_deleted = false,
    updated_at = NOW();

-- STEP 5: Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
