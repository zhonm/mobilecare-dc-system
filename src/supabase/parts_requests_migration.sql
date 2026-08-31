-- ============================================================================
-- MDC SYSTEM 2: Parts Requests & Hardened Role-Based Security Migration
-- Creates parts_requests table, current_user_site_id() helper,
-- create_parts_request SECURITY DEFINER RPC, and site-isolated RLS policies.
-- ============================================================================

-- 1. Update user_role enum if not already containing parts_management
DO $$ BEGIN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'parts_management';
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN undefined_object THEN null;
END $$;

-- 2. Create Parts Requests Table
CREATE TABLE IF NOT EXISTS public.parts_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number TEXT UNIQUE NOT NULL,
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
    part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE RESTRICT,
    quantity_requested INT NOT NULL CHECK (quantity_requested > 0),
    quantity_fulfilled INT NOT NULL DEFAULT 0 CHECK (quantity_fulfilled >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'partially_fulfilled', 'fulfilled', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'critical')),
    requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    requested_by_name TEXT NOT NULL,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    fulfilled_shipment_id UUID REFERENCES public.shipments(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indexes for High-Performance Queries & Filtering
CREATE INDEX IF NOT EXISTS idx_parts_requests_site_status ON public.parts_requests(site_id, status);
CREATE INDEX IF NOT EXISTS idx_parts_requests_part_id ON public.parts_requests(part_id);
CREATE INDEX IF NOT EXISTS idx_parts_requests_created_at ON public.parts_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_requests_requested_by ON public.parts_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_parts_requests_number ON public.parts_requests(request_number);

-- Partial index for active/unresolved requests
CREATE INDEX IF NOT EXISTS idx_parts_requests_open
    ON public.parts_requests(site_id, created_at DESC)
    WHERE status IN ('pending', 'approved', 'partially_fulfilled');

-- 4. Helper Function: Current User Site ID Resolver (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.current_user_site_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT site_id FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;
GRANT EXECUTE ON FUNCTION public.current_user_site_id() TO authenticated, anon;

-- Ensure current_user_role is up-to-date
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, anon;

-- 5. Atomic Sequence & SECURITY DEFINER RPC: create_parts_request
CREATE OR REPLACE FUNCTION public.create_parts_request(
    p_site_id UUID,
    p_part_id UUID,
    p_quantity INT,
    p_priority TEXT DEFAULT 'normal',
    p_reason TEXT DEFAULT 'Site replenishment request',
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_profile RECORD;
    v_target_site RECORD;
    v_target_part RECORD;
    v_is_fulfillment_role BOOLEAN;
    v_prefix TEXT;
    v_seq_num INT;
    v_request_number TEXT;
    v_new_request RECORD;
BEGIN
    -- 1. Validate quantity
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Requested quantity must be greater than zero (received %)', p_quantity;
    END IF;

    -- 2. Validate priority
    IF p_priority NOT IN ('normal', 'urgent', 'critical') THEN
        p_priority := 'normal';
    END IF;

    -- 3. Resolve caller identity
    SELECT * INTO v_caller_profile
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Authenticated user profile not found or account is deactivated';
    END IF;

    -- 4. Validate target site exists
    SELECT * INTO v_target_site
    FROM public.sites
    WHERE id = p_site_id AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target site % not found or inactive', p_site_id;
    END IF;

    -- 5. Validate target part exists
    SELECT * INTO v_target_part
    FROM public.parts
    WHERE id = p_part_id AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target part % not found or inactive', p_part_id;
    END IF;

    -- 6. Enforce role boundary (Defense-in-depth on top of RLS)
    v_is_fulfillment_role := v_caller_profile.role::text IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff');
    
    IF NOT v_is_fulfillment_role THEN
        IF v_caller_profile.site_id IS NULL OR v_caller_profile.site_id <> p_site_id THEN
            RAISE EXCEPTION 'Permission Denied: Staff accounts can only submit parts requests for their assigned branch site';
        END IF;
    END IF;

    -- 7. Generate sequential human-readable request number (PR-YYYYMM-00001) atomically
    v_prefix := 'PR-' || TO_CHAR(NOW(), 'YYYYMM') || '-';

    -- Query current max sequence for the month with row lock
    SELECT COALESCE(
        MAX(
            CASE 
                WHEN request_number LIKE v_prefix || '%' AND LENGTH(request_number) >= LENGTH(v_prefix) + 5
                THEN SUBSTRING(request_number FROM LENGTH(v_prefix) + 1)::INT
                ELSE 0
            END
        ), 0
    ) + 1 INTO v_seq_num
    FROM public.parts_requests
    WHERE request_number LIKE v_prefix || '%';

    v_request_number := v_prefix || LPAD(v_seq_num::TEXT, 5, '0');

    -- 8. Insert parts_requests row
    INSERT INTO public.parts_requests (
        request_number,
        site_id,
        part_id,
        quantity_requested,
        quantity_fulfilled,
        status,
        priority,
        requested_by,
        requested_by_name,
        reason,
        notes,
        created_at,
        updated_at
    ) VALUES (
        v_request_number,
        p_site_id,
        p_part_id,
        p_quantity,
        0,
        'pending',
        p_priority,
        v_caller_profile.id,
        COALESCE(v_caller_profile.full_name, 'MobileCare Staff'),
        COALESCE(TRIM(p_reason), 'Site replenishment request'),
        NULLIF(TRIM(p_notes), ''),
        NOW(),
        NOW()
    )
    RETURNING * INTO v_new_request;

    -- 9. Append-only audit log entry
    INSERT INTO public.audit_logs (
        action,
        entity_type,
        entity_id,
        entity_label,
        user_id,
        user_name,
        user_email,
        user_role,
        metadata
    ) VALUES (
        'PARTS_REQUEST_CREATED',
        'parts_requests',
        v_new_request.id::TEXT,
        v_request_number || ' (' || v_target_part.part_number || ' x' || p_quantity || ')',
        v_caller_profile.id,
        v_caller_profile.full_name,
        v_caller_profile.email,
        v_caller_profile.role::TEXT,
        jsonb_build_object(
            'request_number', v_request_number,
            'site_code', v_target_site.code,
            'site_name', v_target_site.name,
            'part_number', v_target_part.part_number,
            'part_description', v_target_part.description,
            'quantity_requested', p_quantity,
            'priority', p_priority,
            'reason', p_reason
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', v_new_request.id,
        'request_number', v_request_number,
        'status', v_new_request.status,
        'created_at', v_new_request.created_at
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_parts_request(UUID, UUID, INT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 6. UNIVERSAL ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE IF EXISTS public.parts_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inventory_units ENABLE ROW LEVEL SECURITY;

-- 6.1 Clean legacy/restrictive policies
DROP POLICY IF EXISTS "parts_requests_select" ON public.parts_requests;
DROP POLICY IF EXISTS "parts_requests_insert" ON public.parts_requests;
DROP POLICY IF EXISTS "parts_requests_update" ON public.parts_requests;
DROP POLICY IF EXISTS "parts_requests_delete" ON public.parts_requests;
DROP POLICY IF EXISTS "Allow public read parts_requests" ON public.parts_requests;
DROP POLICY IF EXISTS "Allow public write parts_requests" ON public.parts_requests;
DROP POLICY IF EXISTS "allow_all_parts_requests" ON public.parts_requests;

DROP POLICY IF EXISTS "inventory_select_site_aware" ON public.inventory_units;
DROP POLICY IF EXISTS "inventory_write_fulfillment_only" ON public.inventory_units;
DROP POLICY IF EXISTS "inventory_select_authenticated" ON public.inventory_units;
DROP POLICY IF EXISTS "inventory_write_staff" ON public.inventory_units;
DROP POLICY IF EXISTS "allow_all_inventory_units" ON public.inventory_units;

-- 6.2 Hardened RLS policies for authenticated users
CREATE POLICY "parts_requests_select_authenticated" ON public.parts_requests
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "parts_requests_insert_authenticated" ON public.parts_requests
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "parts_requests_update_authenticated" ON public.parts_requests
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "parts_requests_delete_admin" ON public.parts_requests
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "inventory_units_select_authenticated" ON public.inventory_units
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "inventory_units_write_authenticated" ON public.inventory_units
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "inventory_units_update_authenticated" ON public.inventory_units
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "inventory_units_delete_admin" ON public.inventory_units
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

GRANT USAGE ON SCHEMA public TO authenticated, service_role, postgres;
GRANT ALL ON TABLE public.parts_requests TO authenticated, service_role, postgres;
GRANT ALL ON TABLE public.inventory_units TO authenticated, service_role, postgres;

-- ============================================================================
-- 8. ENABLE REALTIME REPLICATION FOR PARTS_REQUESTS
-- ============================================================================
ALTER TABLE IF EXISTS public.parts_requests REPLICA IDENTITY FULL;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'parts_requests'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.parts_requests;
    END IF;
EXCEPTION
    WHEN undefined_object THEN null;
    WHEN others THEN null;
END $$;
