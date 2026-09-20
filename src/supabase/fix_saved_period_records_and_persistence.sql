-- ============================================================================
-- MDC SYSTEM 2: RESTORE SAVED PERIOD RECORDS & PERMANENT STORAGE PERSISTENCE
-- File: src/supabase/fix_saved_period_records_and_persistence.sql
--
-- PURPOSE:
-- 1. Fix RLS policy on 'public.saved_records' that previously restricted anon to
--    only operational batches ('intake_record', 'intake_batch', 'shipment'),
--    blocking all saved period records ('both', 'forecast', 'allocation')
--    from being read or upserted by clients.
-- 2. Allow anon to SELECT, INSERT, UPDATE, and DELETE period snapshots and registries.
-- 3. Install SECURITY DEFINER RPC 'get_saved_period_records()' and 'save_period_record()'
--    to guarantee that period records can always be saved and loaded with 0 friction.
-- 4. Clean up 'deleted_period_record_ids_registry' so active historical snapshots
--    are never accidentally tombstoned on client sync.
-- 5. Ensure the 3 historical snapshots (August 2026 - Master and September 2026 - Master)
--    are permanently stored in public.saved_records.
-- ============================================================================

-- STEP 1: Fix trigger on saved_records (eliminate silent drops for operational and period records)
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

DROP TRIGGER IF EXISTS trg_silent_ignore_anon_saved_records_writes ON public.saved_records;
CREATE TRIGGER trg_silent_ignore_anon_saved_records_writes
BEFORE INSERT OR UPDATE ON public.saved_records
FOR EACH ROW
EXECUTE FUNCTION public.silent_ignore_anon_saved_records_writes();


-- STEP 2: Update Row Level Security (RLS) policies on public.saved_records

DROP POLICY IF EXISTS saved_records_throttle ON public.saved_records;
DROP POLICY IF EXISTS saved_records_select_anon ON public.saved_records;
DROP POLICY IF EXISTS saved_records_select_authenticated ON public.saved_records;
DROP POLICY IF EXISTS "saved_records_select_authenticated" ON public.saved_records;
DROP POLICY IF EXISTS saved_records_authenticated_all ON public.saved_records;
DROP POLICY IF EXISTS "saved_records_authenticated_all" ON public.saved_records;
DROP POLICY IF EXISTS "saved_records_select_anon" ON public.saved_records;
DROP POLICY IF EXISTS "saved_records_select_scoped" ON public.saved_records;
DROP POLICY IF EXISTS saved_records_insert_anon ON public.saved_records;
DROP POLICY IF EXISTS "saved_records_insert_anon" ON public.saved_records;
DROP POLICY IF EXISTS saved_records_update_anon ON public.saved_records;
DROP POLICY IF EXISTS "saved_records_update_anon" ON public.saved_records;
DROP POLICY IF EXISTS saved_records_delete_anon ON public.saved_records;
DROP POLICY IF EXISTS "saved_records_delete_anon" ON public.saved_records;


-- 2.1 SELECT policy: allow reading all period records, system registries, and operational records
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
        OR record_type IN ('both', 'forecast', 'allocation', 'period_record', 'historical_archive', 'shipment', 'intake_batch', 'intake_record', 'deletion_registry', 'live_master_state', 'masterlist_registry', 'stock_transfer_report')
        OR id LIKE 'rec-%'
    )
);

CREATE POLICY saved_records_select_authenticated ON public.saved_records
FOR SELECT TO authenticated
USING (true);

-- 2.2 INSERT policy for anon
CREATE POLICY saved_records_insert_anon ON public.saved_records
FOR INSERT TO anon
WITH CHECK (
    id <> 'master_users_registry'
    AND (
        record_type IN ('both', 'forecast', 'allocation', 'period_record', 'historical_archive', 'shipment', 'intake_batch', 'intake_record', 'deletion_registry', 'live_master_state', 'masterlist_registry', 'stock_transfer_report')
        OR id LIKE 'rec-%'
    )
);

-- 2.3 UPDATE policy for anon
CREATE POLICY saved_records_update_anon ON public.saved_records
FOR UPDATE TO anon
USING (
    id <> 'master_users_registry'
    AND (
        record_type IN ('both', 'forecast', 'allocation', 'period_record', 'historical_archive', 'shipment', 'intake_batch', 'intake_record', 'deletion_registry', 'live_master_state', 'masterlist_registry', 'stock_transfer_report')
        OR id LIKE 'rec-%'
    )
)
WITH CHECK (
    id <> 'master_users_registry'
    AND (
        record_type IN ('both', 'forecast', 'allocation', 'period_record', 'historical_archive', 'shipment', 'intake_batch', 'intake_record', 'deletion_registry', 'live_master_state', 'masterlist_registry', 'stock_transfer_report')
        OR id LIKE 'rec-%'
    )
);

-- 2.4 DELETE policy for anon
CREATE POLICY saved_records_delete_anon ON public.saved_records
FOR DELETE TO anon
USING (
    id <> 'master_users_registry'
    AND (
        record_type IN ('both', 'forecast', 'allocation', 'period_record', 'historical_archive', 'shipment', 'deleted_snapshot')
        OR id LIKE 'rec-%'
    )
);

-- 2.5 Authenticated full access
CREATE POLICY saved_records_authenticated_all ON public.saved_records
FOR ALL TO authenticated
USING (id <> 'master_users_registry')
WITH CHECK (id <> 'master_users_registry');


-- STEP 3: Provide secure RPC functions for period records (bypasses RLS safely)

-- 3.1 Fetch all active saved period records
CREATE OR REPLACE FUNCTION public.get_saved_period_records()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_records JSONB;
BEGIN
    SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at DESC)
    INTO v_records
    FROM public.saved_records r
    WHERE (r.record_type IN ('both', 'forecast', 'allocation', 'period_record', 'historical_archive') OR r.id LIKE 'rec-%')
      AND r.notes <> '__DELETED__'
      AND COALESCE((r.snapshot_data->>'isDeleted')::boolean, false) = false;

    RETURN COALESCE(v_records, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_saved_period_records() TO anon, authenticated;


-- 3.2 Save/Upsert a period record
CREATE OR REPLACE FUNCTION public.save_period_record(
    p_id TEXT,
    p_record_type TEXT,
    p_period_label TEXT,
    p_period_year INT,
    p_period_month INT,
    p_period_week INT DEFAULT NULL,
    p_notes TEXT DEFAULT '',
    p_saved_by_name TEXT DEFAULT 'Warehouse Operations',
    p_saved_by_user_id UUID DEFAULT NULL,
    p_snapshot_data JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.saved_records (
        id, record_type, period_label, period_year, period_month, period_week,
        notes, saved_by_name, saved_by_user_id, snapshot_data, created_at, updated_at
    ) VALUES (
        p_id, p_record_type, p_period_label, p_period_year, p_period_month, p_period_week,
        p_notes, p_saved_by_name, p_saved_by_user_id, p_snapshot_data, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        record_type = EXCLUDED.record_type,
        period_label = EXCLUDED.period_label,
        period_year = EXCLUDED.period_year,
        period_month = EXCLUDED.period_month,
        period_week = EXCLUDED.period_week,
        notes = EXCLUDED.notes,
        saved_by_name = EXCLUDED.saved_by_name,
        snapshot_data = EXCLUDED.snapshot_data,
        updated_at = NOW();

    RETURN jsonb_build_object('success', true, 'id', p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_period_record(TEXT, TEXT, TEXT, INT, INT, INT, TEXT, TEXT, UUID, JSONB) TO anon, authenticated;


-- STEP 4: Clean up deleted_period_record_ids_registry so active snapshots are not suppressed
UPDATE public.saved_records
SET snapshot_data = jsonb_set(
    snapshot_data,
    '{deletedIds}',
    (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements_text(COALESCE(snapshot_data->'deletedIds', '[]'::jsonb)) elem
        WHERE elem NOT IN ('rec-1788159614868-wapjlr', 'rec-1788159311497-j6bza1')
    )
),
updated_at = NOW()
WHERE id = 'deleted_period_record_ids_registry';


-- STEP 5: Backfill/Ensure the 3 authoritative historical period records exist in saved_records
INSERT INTO public.saved_records (
    id, record_type, period_label, period_year, period_month, period_week,
    notes, saved_by_name, saved_by_user_id, snapshot_data, created_at, updated_at
) VALUES
(
    'rec-1788159614868-wapjlr', 'both', 'August 2026 - Master', 2026, 8, NULL,
    '', 'Zhon Manaois', '1b0e9f43-c2d5-4eb4-acef-2ea5d9d21280'::uuid,
    '{"summary": {"totalForecastParts": 41, "totalForecastUnits": 464, "totalAllocatedParts": 41, "totalAllocatedUnits": 464, "totalSites": 27, "grandTotalValue": 74666}}'::jsonb,
    '2026-08-31T07:00:14.868Z'::timestamptz, NOW()
),
(
    'rec-1788159311497-j6bza1', 'both', 'September 2026 - Master', 2026, 9, NULL,
    '', 'Zhon Manaois', '1b0e9f43-c2d5-4eb4-acef-2ea5d9d21280'::uuid,
    '{"summary": {"totalForecastParts": 41, "totalForecastUnits": 587, "totalAllocatedParts": 41, "totalAllocatedUnits": 587, "totalSites": 27, "grandTotalValue": 90273}}'::jsonb,
    '2026-08-31T06:55:11.497Z'::timestamptz, NOW()
),
(
    'rec-1787203380000-master', 'both', 'September 2026 - Master', 2026, 9, NULL,
    '', 'Zhon Manaois', '1b0e9f43-c2d5-4eb4-acef-2ea5d9d21280'::uuid,
    '{"summary": {"totalForecastParts": 40, "totalForecastUnits": 586, "totalAllocatedParts": 40, "totalAllocatedUnits": 591, "totalSites": 26, "grandTotalValue": 91199}}'::jsonb,
    '2026-08-20T10:43:00.000Z'::timestamptz, NOW()
)
ON CONFLICT (id) DO UPDATE SET
    period_label = EXCLUDED.period_label,
    period_year = EXCLUDED.period_year,
    period_month = EXCLUDED.period_month,
    saved_by_name = EXCLUDED.saved_by_name,
    snapshot_data = EXCLUDED.snapshot_data,
    updated_at = NOW();


-- STEP 6: Ensure register_or_update_auth_user omits generated confirmed_at column
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

        -- Insert new auth user into auth.users (omits generated confirmed_at column)
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
            v_user_id::text,
            v_now,
            v_now,
            v_now
        )
        ON CONFLICT (provider, provider_id) DO UPDATE
        SET identity_data = EXCLUDED.identity_data,
            updated_at = v_now;
    ELSE
        -- Update existing auth user
        UPDATE auth.users
        SET encrypted_password = COALESCE(v_encrypted_password, encrypted_password),
            email_confirmed_at = COALESCE(email_confirmed_at, v_now),
            raw_user_meta_data = raw_user_meta_data || v_raw_meta,
            banned_until = CASE WHEN p_is_active = FALSE THEN v_now + INTERVAL '100 years' ELSE NULL END,
            updated_at = v_now
        WHERE id = v_user_id;
    END IF;

    -- Synchronize with public.profiles
    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        role,
        role_position,
        site_id,
        has_set_password,
        is_active,
        is_deleted,
        updated_at
    ) VALUES (
        v_user_id,
        v_clean_email,
        COALESCE(p_full_name, SPLIT_PART(v_clean_email, '@', 1)),
        p_role,
        p_role_position,
        p_site_id,
        (p_password IS NOT NULL AND LENGTH(p_password) >= 6),
        p_is_active,
        false,
        v_now
    )
    ON CONFLICT (email) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        role = EXCLUDED.role,
        role_position = COALESCE(EXCLUDED.role_position, public.profiles.role_position),
        site_id = COALESCE(EXCLUDED.site_id, public.profiles.site_id),
        has_set_password = CASE WHEN p_password IS NOT NULL THEN true ELSE public.profiles.has_set_password END,
        is_active = EXCLUDED.is_active,
        is_deleted = false,
        updated_at = v_now;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'email', v_clean_email,
        'role', p_role,
        'site_id', p_site_id
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_or_update_auth_user(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) TO anon, authenticated;

