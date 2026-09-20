-- ============================================================================
-- MDC SYSTEM 2: FIX SAVED PERIOD RECORDS & PERMANENT STORAGE PERSISTENCE
-- Target Supabase Project: wjikbnbdkxmesvvzbams
--
-- PURPOSE:
-- 1. Eliminate the silent drop trigger that was cancelling INSERT/UPDATE queries
--    on 'public.saved_records' when clients connect without an active native
--    auth JWT (public.current_user_role() = 'anon').
-- 2. Update RLS policies to allow anon and authenticated roles to SELECT, INSERT,
--    UPDATE, and DELETE period snapshots ('both', 'forecast', 'allocation', or rec-%).
-- 3. Maintain strict security on 'master_users_registry' (only modifiable via admin RPCs).
-- 4. Fix 'register_or_update_auth_user' RPC by removing 'confirmed_at' from the
--    explicit INSERT columns list into 'auth.users' (preventing PostgreSQL error:
--    'cannot insert a non-DEFAULT value into column "confirmed_at"').
-- ============================================================================

-- STEP 1: Fix trigger on saved_records to allow period records and operational saves
CREATE OR REPLACE FUNCTION public.silent_ignore_anon_saved_records_writes()
RETURNS trigger AS $$
BEGIN
    -- Only protect master_users_registry from direct raw writes.
    -- (User provisioning & deletion must go through admin RPCs: admin_provision_user, admin_delete_user).
    IF NEW.id = 'master_users_registry' THEN
        RETURN NULL; -- Silently skips row without raising 42501 exception
    END IF;

    -- All other operational records (period records, shipments, intakes, settings) are permitted
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reattach trigger
DROP TRIGGER IF EXISTS trg_silent_ignore_anon_saved_records_writes ON public.saved_records;
CREATE TRIGGER trg_silent_ignore_anon_saved_records_writes
BEFORE INSERT OR UPDATE ON public.saved_records
FOR EACH ROW
EXECUTE FUNCTION public.silent_ignore_anon_saved_records_writes();


-- STEP 2: Update Row Level Security (RLS) policies on public.saved_records

-- 2.1 SELECT policy for anon: allow reading period records, system registries, and operational batches
DROP POLICY IF EXISTS saved_records_select_anon ON public.saved_records;
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
            'deleted_unit_serials_registry',
            'deleted_period_record_ids_registry',
            'master_stock_transfers_report_registry',
            'master_masterlist_data_registry',
            'live_master_state_v1',
            'live_master_dc_inventory'
        )
        OR record_type IN ('intake_record', 'intake_batch', 'shipment', 'deletion_registry', 'both', 'forecast', 'allocation', 'live_master_state', 'masterlist_registry', 'stock_transfer_report')
        OR id LIKE 'rec-%'
    )
);

-- 2.2 INSERT policy for anon
DROP POLICY IF EXISTS saved_records_insert_anon ON public.saved_records;
CREATE POLICY saved_records_insert_anon ON public.saved_records
FOR INSERT TO anon
WITH CHECK (
    id <> 'master_users_registry'
    AND (
        record_type IN ('both', 'forecast', 'allocation', 'shipment', 'intake_batch', 'intake_record', 'deletion_registry', 'live_master_state', 'masterlist_registry', 'stock_transfer_report')
        OR id LIKE 'rec-%'
    )
);

-- 2.3 UPDATE policy for anon
DROP POLICY IF EXISTS saved_records_update_anon ON public.saved_records;
CREATE POLICY saved_records_update_anon ON public.saved_records
FOR UPDATE TO anon
USING (
    id <> 'master_users_registry'
    AND (
        record_type IN ('both', 'forecast', 'allocation', 'shipment', 'intake_batch', 'intake_record', 'deletion_registry', 'live_master_state', 'masterlist_registry', 'stock_transfer_report')
        OR id LIKE 'rec-%'
    )
)
WITH CHECK (
    id <> 'master_users_registry'
    AND (
        record_type IN ('both', 'forecast', 'allocation', 'shipment', 'intake_batch', 'intake_record', 'deletion_registry', 'live_master_state', 'masterlist_registry', 'stock_transfer_report')
        OR id LIKE 'rec-%'
    )
);

-- 2.4 DELETE policy for anon (allowing deletion of period records and operational batches)
DROP POLICY IF EXISTS saved_records_delete_anon ON public.saved_records;
CREATE POLICY saved_records_delete_anon ON public.saved_records
FOR DELETE TO anon
USING (
    id <> 'master_users_registry'
    AND (
        record_type IN ('both', 'forecast', 'allocation', 'shipment', 'deleted_snapshot')
        OR id LIKE 'rec-%'
    )
);


-- STEP 3: Ensure authenticated users continue to have full access to saved_records (except master_users_registry)
DROP POLICY IF EXISTS saved_records_authenticated_all ON public.saved_records;
CREATE POLICY saved_records_authenticated_all ON public.saved_records
FOR ALL TO authenticated
USING (id <> 'master_users_registry')
WITH CHECK (id <> 'master_users_registry');


-- STEP 4: Fix register_or_update_auth_user RPC (remove generated column 'confirmed_at')
CREATE OR REPLACE FUNCTION public.register_or_update_auth_user(
    p_email TEXT,
    p_password TEXT DEFAULT NULL,
    p_full_name TEXT DEFAULT NULL,
    p_role TEXT DEFAULT 'parts_management',
    p_site_id UUID DEFAULT NULL,
    p_role_position TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_clean_email TEXT := LOWER(TRIM(p_email));
    v_encrypted_password TEXT;
    v_raw_meta JSONB;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF v_clean_email IS NULL OR v_clean_email = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Email address is required');
    END IF;

    -- Build user metadata payload
    v_raw_meta := jsonb_build_object(
        'full_name', COALESCE(p_full_name, SPLIT_PART(v_clean_email, '@', 1)),
        'role', p_role,
        'site_id', p_site_id,
        'role_position', p_role_position
    );

    -- Check if user already exists in auth.users
    SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = v_clean_email LIMIT 1;

    IF p_password IS NOT NULL AND LENGTH(p_password) >= 6 THEN
        v_encrypted_password := extensions.crypt(p_password, extensions.gen_salt('bf'));
    END IF;

    IF v_user_id IS NULL THEN
        -- Generate new UUID
        v_user_id := gen_random_uuid();

        -- Insert new auth user into auth.users (omits confirmed_at which is a GENERATED column in Postgres)
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            invited_at,
            confirmation_token,
            confirmation_sent_at,
            recovery_token,
            recovery_sent_at,
            email_change_token_new,
            email_change,
            email_change_sent_at,
            last_sign_in_at,
            raw_app_meta_data,
            raw_user_meta_data,
            is_super_admin,
            created_at,
            updated_at,
            phone,
            phone_confirmed_at,
            phone_change,
            phone_change_token,
            phone_change_sent_at,
            email_change_confirm_status,
            banned_until,
            reauthentication_token,
            reauthentication_sent_at,
            is_sso_user,
            deleted_at
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            v_user_id,
            'authenticated',
            'authenticated',
            v_clean_email,
            COALESCE(v_encrypted_password, extensions.crypt('MobileCare@2026', extensions.gen_salt('bf'))),
            v_now,
            NULL, '', NULL, '', NULL, '', '', NULL, NULL,
            '{"provider": "email", "providers": ["email"]}'::jsonb,
            v_raw_meta,
            (p_role = 'superadmin'),
            v_now,
            v_now,
            NULL, NULL, '', '', NULL, 0,
            CASE WHEN p_is_active = FALSE THEN v_now + INTERVAL '100 years' ELSE NULL END,
            '', NULL, false, NULL
        );

        -- Insert identity into auth.identities
        INSERT INTO auth.identities (
            id,
            user_id,
            identity_data,
            provider,
            provider_id,
            last_sign_in_at,
            created_at,
            updated_at
        ) VALUES (
            gen_random_uuid(),
            v_user_id,
            jsonb_build_object('sub', v_user_id::text, 'email', v_clean_email),
            'email',
            v_clean_email,
            NULL,
            v_now,
            v_now
        ) ON CONFLICT (provider, provider_id) DO NOTHING;

    ELSE
        -- Update existing auth user
        UPDATE auth.users
        SET 
            encrypted_password = COALESCE(v_encrypted_password, encrypted_password),
            raw_user_meta_data = v_raw_meta,
            is_super_admin = (p_role = 'superadmin'),
            updated_at = v_now,
            banned_until = CASE WHEN p_is_active = FALSE THEN v_now + INTERVAL '100 years' ELSE NULL END
        WHERE id = v_user_id;
    END IF;

    -- Upsert profile in public.profiles
    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        role,
        site_id,
        role_position,
        has_set_password,
        is_active,
        is_deleted,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        v_clean_email,
        COALESCE(p_full_name, SPLIT_PART(v_clean_email, '@', 1)),
        p_role,
        p_site_id,
        p_role_position,
        (p_password IS NOT NULL),
        p_is_active,
        false,
        v_now,
        v_now
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        site_id = COALESCE(EXCLUDED.site_id, public.profiles.site_id),
        role_position = COALESCE(EXCLUDED.role_position, public.profiles.role_position),
        has_set_password = CASE WHEN p_password IS NOT NULL THEN true ELSE public.profiles.has_set_password END,
        is_active = EXCLUDED.is_active,
        is_deleted = false,
        updated_at = v_now;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'email', v_clean_email,
        'role', p_role
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_or_update_auth_user TO anon, authenticated;

-- STEP 5: Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
