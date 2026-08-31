-- ============================================================================
-- MDC SYSTEM 2: Distribution Center Parts Allocation, Inventory & Reporting
-- Supabase / PostgreSQL Schema Definition with Hardened Security, RBAC & RPCs
-- ============================================================================

-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Custom Enums
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff', 'technician', 'site_staff', 'management_viewer', 'parts_management', 'user');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE inventory_status AS ENUM ('in_stock', 'allocated', 'packed', 'shipped', 'delivered', 'received', 'damaged', 'returned');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE po_status AS ENUM ('draft', 'submitted', 'partially_received', 'received', 'closed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE shipment_status AS ENUM ('draft', 'packing', 'ready_for_dispatch', 'shipped', 'in_transit', 'delivered', 'received_confirmed', 'discrepancy', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE allocation_status AS ENUM ('draft', 'approved', 'in_progress', 'completed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 3. CORE & REFERENCE TABLES
-- ============================================================================

-- 3.1 Profiles Table (Linked with Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'warehouse_staff',
    role_position TEXT,
    site_id UUID,
    password_hash TEXT,
    has_set_password BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role_position TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_set_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON public.profiles(updated_at DESC);

-- 3.2 User Page Permissions Table (Normalized Access Control)
CREATE TABLE IF NOT EXISTS public.user_page_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_user_page_perm ON public.user_page_permissions(user_id, page_id);

-- 3.3 Part Categories Table
CREATE TABLE IF NOT EXISTS public.part_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    has_imei BOOLEAN NOT NULL DEFAULT false,
    is_serialized BOOLEAN NOT NULL DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.4 Parts Catalog Table
CREATE TABLE IF NOT EXISTS public.parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.part_categories(id) ON DELETE RESTRICT,
    part_number TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    iphone_model TEXT,
    stocking_price NUMERIC(10,2) DEFAULT 0,
    safety_stock_pct NUMERIC(5,2) DEFAULT 0.05,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_parts_category ON public.parts(category_id);
CREATE INDEX IF NOT EXISTS idx_parts_pn ON public.parts(part_number);
CREATE INDEX IF NOT EXISTS idx_parts_updated_at ON public.parts(updated_at DESC);

-- 3.5 Sites Table (Warehouses and ASP Service Centers)
CREATE TABLE IF NOT EXISTS public.sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'Metro Manila',
    address TEXT,
    full_address TEXT,
    city TEXT,
    ship_to TEXT,
    sold_to TEXT,
    invoice_prefix TEXT,
    contact_email TEXT,
    contact_person TEXT,
    contact_phone TEXT,
    is_dc BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS full_address TEXT;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS ship_to TEXT;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS sold_to TEXT;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS invoice_prefix TEXT;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS contact_email TEXT;

CREATE INDEX IF NOT EXISTS idx_sites_region ON public.sites(region);
CREATE INDEX IF NOT EXISTS idx_sites_code ON public.sites(code);
CREATE INDEX IF NOT EXISTS idx_sites_updated_at ON public.sites(updated_at DESC);

-- ============================================================================
-- 4. OPERATIONAL & TRANSACTION TABLES
-- ============================================================================

-- 4.1 Repair Usage Records (GSX / Fixably Imports)
CREATE TABLE IF NOT EXISTS public.repair_usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_batch_id UUID NOT NULL,
    month_name TEXT NOT NULL,
    closed_date DATE,
    site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    part_id UUID REFERENCES public.parts(id) ON DELETE SET NULL,
    raw_part_number TEXT,
    raw_part_description TEXT,
    raw_site_name TEXT,
    repair_number TEXT,
    order_id TEXT,
    kgb_kbb_number TEXT,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repair_usage_part_month ON public.repair_usage_records(part_id, closed_date);
CREATE INDEX IF NOT EXISTS idx_repair_usage_site ON public.repair_usage_records(site_id);

-- 4.2 Forecast Cycles & Entries
CREATE TABLE IF NOT EXISTS public.forecast_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_year INT NOT NULL,
    period_month INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(period_year, period_month)
);

CREATE TABLE IF NOT EXISTS public.forecast_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forecast_cycle_id UUID NOT NULL REFERENCES public.forecast_cycles(id) ON DELETE CASCADE,
    part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
    ytd_monthly_counts JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_forecast INT NOT NULL DEFAULT 0,
    admin_override INT,
    final_forecast INT NOT NULL DEFAULT 0,
    safety_stock_units INT NOT NULL DEFAULT 0,
    recommended_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(forecast_cycle_id, part_id)
);
CREATE INDEX IF NOT EXISTS idx_forecast_entries_cycle ON public.forecast_entries(forecast_cycle_id);
CREATE INDEX IF NOT EXISTS idx_forecast_entries_part ON public.forecast_entries(part_id);

-- 4.3 Purchase Orders & Items
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number TEXT UNIQUE NOT NULL,
    forecast_cycle_id UUID REFERENCES public.forecast_cycles(id) ON DELETE SET NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date DATE,
    status po_status NOT NULL DEFAULT 'draft',
    remarks TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.po_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
    quantity_ordered INT NOT NULL,
    quantity_received INT NOT NULL DEFAULT 0,
    unit_price NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(po_id, part_id)
);
CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON public.po_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_part_id ON public.po_items(part_id);

-- 4.4 Serialized Inventory Units
CREATE TABLE IF NOT EXISTS public.inventory_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE RESTRICT,
    serial_number TEXT UNIQUE NOT NULL,
    imei_number TEXT,
    current_site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
    po_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
    status inventory_status NOT NULL DEFAULT 'in_stock',
    box_number INT DEFAULT 1,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    allocated_at TIMESTAMPTZ,
    allocated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    shipped_at TIMESTAMPTZ,
    shipped_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    received_confirmed_at TIMESTAMPTZ,
    received_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_serial ON public.inventory_units(serial_number);
CREATE INDEX IF NOT EXISTS idx_inventory_part_status ON public.inventory_units(part_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_site ON public.inventory_units(current_site_id);
CREATE INDEX IF NOT EXISTS idx_inventory_units_updated_at ON public.inventory_units(updated_at DESC);

-- 4.5 Allocation Cycles & Per-Site Allocation Items
CREATE TABLE IF NOT EXISTS public.allocation_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forecast_cycle_id UUID REFERENCES public.forecast_cycles(id) ON DELETE SET NULL,
    period_year INT NOT NULL,
    period_month INT NOT NULL,
    status allocation_status NOT NULL DEFAULT 'draft',
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.allocation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    allocation_cycle_id UUID NOT NULL REFERENCES public.allocation_cycles(id) ON DELETE CASCADE,
    part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    forecasted_share_pct NUMERIC(6,4) NOT NULL DEFAULT 0,
    monthly_allocated_qty INT NOT NULL DEFAULT 0,
    week1_qty INT NOT NULL DEFAULT 0,
    week2_qty INT NOT NULL DEFAULT 0,
    week3_qty INT NOT NULL DEFAULT 0,
    week4_qty INT NOT NULL DEFAULT 0,
    scanned_packed_qty INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(allocation_cycle_id, part_id, site_id)
);
CREATE INDEX IF NOT EXISTS idx_allocation_items_cycle_site ON public.allocation_items(allocation_cycle_id, site_id);
CREATE INDEX IF NOT EXISTS idx_allocation_items_part ON public.allocation_items(part_id);

-- 4.6 Shipments & Shipment Items
CREATE TABLE IF NOT EXISTS public.shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_number TEXT UNIQUE NOT NULL,
    invoice_ref TEXT,
    site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
    allocation_cycle_id UUID REFERENCES public.allocation_cycles(id) ON DELETE SET NULL,
    week_number INT DEFAULT 1,
    shipment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    carrier TEXT DEFAULT 'Lite Express',
    tracking_number TEXT,
    total_boxes INT DEFAULT 1,
    status shipment_status NOT NULL DEFAULT 'draft',
    prepared_by_name TEXT DEFAULT 'Warehouse Staff',
    verified_by_name TEXT DEFAULT 'Supervisor',
    receiving_signature TEXT,
    remarks TEXT DEFAULT 'KGB PARTS',
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipments_shipment_number ON public.shipments(shipment_number);
CREATE INDEX IF NOT EXISTS idx_shipments_site_status ON public.shipments(site_id, status);
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON public.shipments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_updated_at ON public.shipments(updated_at DESC);

CREATE TABLE IF NOT EXISTS public.shipment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
    inventory_unit_id UUID NOT NULL REFERENCES public.inventory_units(id) ON DELETE CASCADE,
    part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE RESTRICT,
    serial_number TEXT NOT NULL,
    box_number INT NOT NULL DEFAULT 1,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scanned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    UNIQUE(shipment_id, inventory_unit_id)
);
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment_id ON public.shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_inventory_unit_id ON public.shipment_items(inventory_unit_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_part_id ON public.shipment_items(part_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_serial ON public.shipment_items(serial_number);

-- 4.7 Barcode Scan Logs
CREATE TABLE IF NOT EXISTS public.scan_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_type TEXT NOT NULL,
    part_number TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    shipment_id UUID REFERENCES public.shipments(id) ON DELETE SET NULL,
    po_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
    is_valid BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scan_logs_serial ON public.scan_logs(serial_number);
CREATE INDEX IF NOT EXISTS idx_scan_logs_created_at ON public.scan_logs(created_at DESC);

-- 4.8 DC Intake Batch Records
CREATE TABLE IF NOT EXISTS public.dc_intake_records (
    id TEXT PRIMARY KEY,
    record_name TEXT NOT NULL,
    intake_date DATE NOT NULL DEFAULT CURRENT_DATE,
    po_id UUID,
    po_number TEXT,
    supplier TEXT,
    total_units INT NOT NULL DEFAULT 0,
    saved_by_name TEXT NOT NULL,
    saved_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    notes TEXT,
    category_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dc_intake_records_created_at ON public.dc_intake_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dc_intake_records_date ON public.dc_intake_records(intake_date DESC);
CREATE INDEX IF NOT EXISTS idx_dc_intake_records_name ON public.dc_intake_records(record_name);

-- 4.9 Period-Based Saved Records Snapshots Table
CREATE TABLE IF NOT EXISTS public.saved_records (
    id TEXT PRIMARY KEY,
    record_type TEXT NOT NULL DEFAULT 'both',
    period_label TEXT NOT NULL,
    period_year INT NOT NULL,
    period_month INT NOT NULL,
    period_week INT,
    notes TEXT,
    saved_by_name TEXT,
    saved_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    snapshot_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_records_created_at ON public.saved_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_records_type ON public.saved_records(record_type);
CREATE INDEX IF NOT EXISTS idx_saved_records_period ON public.saved_records(period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_saved_records_updated_at ON public.saved_records(updated_at DESC);

-- 4.10 Append-Only Audit Logs Table (Tamper-Proof)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_label TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_name TEXT,
    user_email TEXT,
    user_role TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

-- 4.11 Parts Requests Table
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
CREATE INDEX IF NOT EXISTS idx_parts_requests_site_status ON public.parts_requests(site_id, status);
CREATE INDEX IF NOT EXISTS idx_parts_requests_part_id ON public.parts_requests(part_id);
CREATE INDEX IF NOT EXISTS idx_parts_requests_created_at ON public.parts_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_requests_requested_by ON public.parts_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_parts_requests_number ON public.parts_requests(request_number);
CREATE INDEX IF NOT EXISTS idx_parts_requests_open ON public.parts_requests(site_id, created_at DESC) WHERE status IN ('pending', 'approved', 'partially_fulfilled');

-- ============================================================================
-- 5. FUNCTIONS & ATOMIC TRANSACTION RPCS
-- ============================================================================

-- 5.1 Helper Functions: Role & Site Resolvers (Public Schema, Security Definer)
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

-- 5.2 Atomic Transaction RPC: Parts Request Creation
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
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Requested quantity must be greater than zero (received %)', p_quantity;
    END IF;

    IF p_priority NOT IN ('normal', 'urgent', 'critical') THEN
        p_priority := 'normal';
    END IF;

    SELECT * INTO v_caller_profile
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Authenticated user profile not found or account is deactivated';
    END IF;

    SELECT * INTO v_target_site
    FROM public.sites
    WHERE id = p_site_id AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target site % not found or inactive', p_site_id;
    END IF;

    SELECT * INTO v_target_part
    FROM public.parts
    WHERE id = p_part_id AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target part % not found or inactive', p_part_id;
    END IF;

    v_is_fulfillment_role := v_caller_profile.role IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff');
    
    IF NOT v_is_fulfillment_role THEN
        IF v_caller_profile.site_id IS NULL OR v_caller_profile.site_id <> p_site_id THEN
            RAISE EXCEPTION 'Permission Denied: Staff accounts can only submit parts requests for their assigned branch site';
        END IF;
    END IF;

    v_prefix := 'PR-' || TO_CHAR(NOW(), 'YYYYMM') || '-';

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

-- 5.2 Atomic Transaction RPC: Shipment Header + Items Creation
CREATE OR REPLACE FUNCTION public.create_or_update_shipment_with_items(
    p_shipment JSONB,
    p_items JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_shipment_id UUID;
    v_item JSONB;
BEGIN
    -- 1. Insert or update shipment header using shipment_number
    INSERT INTO public.shipments (
        id,
        shipment_number,
        invoice_ref,
        site_id,
        allocation_cycle_id,
        week_number,
        shipment_date,
        carrier,
        tracking_number,
        total_boxes,
        status,
        prepared_by_name,
        verified_by_name,
        receiving_signature,
        remarks,
        created_by,
        updated_at
    ) VALUES (
        COALESCE(NULLIF(p_shipment->>'id', '')::UUID, gen_random_uuid()),
        p_shipment->>'shipment_number',
        p_shipment->>'invoice_ref',
        (p_shipment->>'site_id')::UUID,
        NULLIF(p_shipment->>'allocation_cycle_id', '')::UUID,
        COALESCE((p_shipment->>'week_number')::INT, 1),
        COALESCE((p_shipment->>'shipment_date')::DATE, CURRENT_DATE),
        COALESCE(p_shipment->>'carrier', 'Lite Express'),
        p_shipment->>'tracking_number',
        COALESCE((p_shipment->>'total_boxes')::INT, 1),
        COALESCE(p_shipment->>'status', 'draft')::shipment_status,
        p_shipment->>'prepared_by_name',
        p_shipment->>'verified_by_name',
        p_shipment->>'receiving_signature',
        p_shipment->>'remarks',
        NULLIF(p_shipment->>'created_by', '')::UUID,
        NOW()
    )
    ON CONFLICT (shipment_number) DO UPDATE SET
        status = EXCLUDED.status,
        total_boxes = EXCLUDED.total_boxes,
        carrier = EXCLUDED.carrier,
        tracking_number = EXCLUDED.tracking_number,
        remarks = EXCLUDED.remarks,
        updated_at = NOW()
    RETURNING id INTO v_shipment_id;

    -- 2. Insert items only after header exists
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            INSERT INTO public.shipment_items (
                id,
                shipment_id,
                inventory_unit_id,
                part_id,
                serial_number,
                box_number,
                scanned_at,
                scanned_by
            ) VALUES (
                COALESCE(NULLIF(v_item->>'id', '')::UUID, gen_random_uuid()),
                v_shipment_id,
                NULLIF(v_item->>'inventory_unit_id', '')::UUID,
                (v_item->>'part_id')::UUID,
                v_item->>'serial_number',
                COALESCE((v_item->>'box_number')::INT, 1),
                COALESCE((v_item->>'scanned_at')::TIMESTAMPTZ, NOW()),
                NULLIF(v_item->>'scanned_by', '')::UUID
            )
            ON CONFLICT (id) DO UPDATE SET
                box_number = EXCLUDED.box_number,
                scanned_at = EXCLUDED.scanned_at;
        END LOOP;
    END IF;

    RETURN v_shipment_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_or_update_shipment_with_items(JSONB, JSONB) TO authenticated;

-- ============================================================================
-- 6. UNIVERSAL ROW LEVEL SECURITY (RLS) POLICIES & PERMISSIONS
-- ============================================================================

ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_page_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.part_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.repair_usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.forecast_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.forecast_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.allocation_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.allocation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dc_intake_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saved_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parts_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 6.1 Profiles Policies
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

-- 6.2 User Page Permissions Policies
CREATE POLICY "user_page_permissions_select" ON public.user_page_permissions
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'));

CREATE POLICY "user_page_permissions_manage_superadmin" ON public.user_page_permissions
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'superadmin'));

-- 6.3 Catalog & Master Data (Parts, Categories, Sites)
CREATE POLICY "parts_select_authenticated" ON public.parts
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "parts_manage_admin" ON public.parts
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "part_categories_select_authenticated" ON public.part_categories
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "part_categories_manage_admin" ON public.part_categories
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "sites_select_authenticated" ON public.sites
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "sites_manage_admin" ON public.sites
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

-- 6.4 Forecasts, Allocations, Purchase Orders & Repair Usage
CREATE POLICY "forecast_cycles_select_authenticated" ON public.forecast_cycles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "forecast_cycles_manage_planner" ON public.forecast_cycles
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')));

CREATE POLICY "forecast_entries_select_authenticated" ON public.forecast_entries
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "forecast_entries_manage_planner" ON public.forecast_entries
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')));

CREATE POLICY "allocation_cycles_select_authenticated" ON public.allocation_cycles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "allocation_cycles_manage_planner" ON public.allocation_cycles
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')));

CREATE POLICY "allocation_items_select_authenticated" ON public.allocation_items
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "allocation_items_manage_planner" ON public.allocation_items
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')));

CREATE POLICY "purchase_orders_select_authenticated" ON public.purchase_orders
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "purchase_orders_manage_planner" ON public.purchase_orders
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')));

CREATE POLICY "po_items_select_authenticated" ON public.po_items
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "po_items_manage_planner" ON public.po_items
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')));

CREATE POLICY "repair_usage_records_select_authenticated" ON public.repair_usage_records
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "repair_usage_records_manage_planner" ON public.repair_usage_records
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin', 'planner')));

-- 6.5 Shipments & Shipment Items
CREATE POLICY "shipments_select_authenticated" ON public.shipments
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "shipments_write_authenticated" ON public.shipments
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "shipments_update_authenticated" ON public.shipments
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "shipments_delete_admin" ON public.shipments
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "shipment_items_select_authenticated" ON public.shipment_items
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "shipment_items_write_authenticated" ON public.shipment_items
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "shipment_items_update_authenticated" ON public.shipment_items
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "shipment_items_delete_admin" ON public.shipment_items
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

-- 6.6 Inventory Units & Scan Logs
CREATE POLICY "inventory_units_select_authenticated" ON public.inventory_units
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "inventory_units_write_authenticated" ON public.inventory_units
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "inventory_units_update_authenticated" ON public.inventory_units
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "inventory_units_delete_admin" ON public.inventory_units
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "scan_logs_select_authenticated" ON public.scan_logs
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "scan_logs_insert_authenticated" ON public.scan_logs
    FOR INSERT TO authenticated WITH CHECK (true);

-- 6.7 Parts Requests
CREATE POLICY "parts_requests_select_authenticated" ON public.parts_requests
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "parts_requests_insert_authenticated" ON public.parts_requests
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "parts_requests_delete_admin" ON public.parts_requests
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

-- 6.8 Saved Records & DC Intake Records (Accessible to authenticated & anon client)
CREATE POLICY "saved_records_select" ON public.saved_records
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "saved_records_write" ON public.saved_records
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "saved_records_update" ON public.saved_records
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "saved_records_delete" ON public.saved_records
    FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "dc_intake_records_select" ON public.dc_intake_records
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "dc_intake_records_write" ON public.dc_intake_records
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "dc_intake_records_update" ON public.dc_intake_records
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "dc_intake_records_delete" ON public.dc_intake_records
    FOR DELETE TO anon, authenticated USING (true);

-- 6.9 Append-Only Audit Logs (Tamper-Proof)
CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "audit_logs_insert_authenticated" ON public.audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

-- Grant privileges (RLS strictly controls data access)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role, postgres;

-- ============================================================================
-- 7. SEED SUPERADMIN PROFILES & DEFAULT PERMISSIONS
-- ============================================================================

DO $$ BEGIN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
EXCEPTION
    WHEN duplicate_table THEN null;
    WHEN duplicate_object THEN null;
END $$;

INSERT INTO public.profiles (id, email, full_name, role, has_set_password, is_active)
SELECT u.id, u.email, 'Super Admin', 'superadmin'::user_role, true, true
FROM auth.users u
WHERE u.email = 'superadmin@mobilecareph.com'
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    has_set_password = EXCLUDED.has_set_password,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

INSERT INTO public.profiles (id, email, full_name, role, has_set_password, is_active)
SELECT u.id, u.email, 'System Admin', 'superadmin'::user_role, true, true
FROM auth.users u
WHERE u.email = 'admin@mobilecareph.com'
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    has_set_password = EXCLUDED.has_set_password,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- Grant all page permissions to superadmins
DO $$
DECLARE
    uid UUID;
    pages TEXT[] := ARRAY['dashboard', 'import', 'forecast', 'records', 'orders', 'scan-in', 'allocation', 'scan-out', 'shipments', 'audit', 'settings', 'user-access'];
    p TEXT;
BEGIN
    FOR uid IN SELECT id FROM public.profiles WHERE role = 'superadmin' LOOP
        FOREACH p IN ARRAY pages LOOP
            INSERT INTO public.user_page_permissions (user_id, page_id)
            VALUES (uid, p)
            ON CONFLICT (user_id, page_id) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;
