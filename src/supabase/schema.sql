-- ============================================================================
-- MDC SYSTEM 2: Distribution Center Parts Allocation & Reporting System
-- Supabase / PostgreSQL Schema Definition with Authentication & RBAC
-- ============================================================================

-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Custom Enums
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'warehouse_staff', 'site_staff', 'management_viewer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE inventory_status AS ENUM ('in_stock', 'allocated', 'packed', 'shipped', 'received', 'damaged', 'returned');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE po_status AS ENUM ('draft', 'submitted', 'partially_received', 'received', 'closed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE shipment_status AS ENUM ('draft', 'packing', 'shipped', 'delivered', 'received_confirmed', 'discrepancy');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE allocation_status AS ENUM ('draft', 'approved', 'in_progress', 'completed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Profiles Table (Linked with Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'warehouse_staff',
    site_id UUID,
    has_set_password BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Ensure columns exist if table was previously created
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_set_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- 4. User Page Permissions Table (Normalized Access Control)
CREATE TABLE IF NOT EXISTS user_page_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL, -- e.g. 'dashboard', 'import', 'forecast', 'orders', 'scan-in', 'allocation', 'scan-out', 'shipments', 'audit', 'settings', 'user-access'
    granted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_user_page_perm ON user_page_permissions(user_id, page_id);

-- 5. Part Categories Table
CREATE TABLE IF NOT EXISTS part_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    has_imei BOOLEAN NOT NULL DEFAULT false,
    is_serialized BOOLEAN NOT NULL DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Parts Catalog Table
CREATE TABLE IF NOT EXISTS parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID NOT NULL REFERENCES part_categories(id) ON DELETE RESTRICT,
    part_number TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    iphone_model TEXT,
    stocking_price NUMERIC(10,2) DEFAULT 0,
    safety_stock_pct NUMERIC(5,2) DEFAULT 0.05,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category_id);
CREATE INDEX IF NOT EXISTS idx_parts_pn ON parts(part_number);

-- 7. Sites Table
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'Metro Manila',
    address TEXT,
    contact_person TEXT,
    contact_phone TEXT,
    is_dc BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sites_region ON sites(region);

-- 8. Repair Usage Records (GSX / Fixably Imports)
CREATE TABLE IF NOT EXISTS repair_usage_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_batch_id UUID NOT NULL,
    month_name TEXT NOT NULL,
    closed_date DATE,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    part_id UUID REFERENCES parts(id) ON DELETE SET NULL,
    raw_part_number TEXT,
    raw_part_description TEXT,
    raw_site_name TEXT,
    repair_number TEXT,
    order_id TEXT,
    kgb_kbb_number TEXT,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repair_usage_part_month ON repair_usage_records(part_id, closed_date);
CREATE INDEX IF NOT EXISTS idx_repair_usage_site ON repair_usage_records(site_id);

-- 9. Forecast Cycles & Entries
CREATE TABLE IF NOT EXISTS forecast_cycles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_year INT NOT NULL,
    period_month INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(period_year, period_month)
);

CREATE TABLE IF NOT EXISTS forecast_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    forecast_cycle_id UUID NOT NULL REFERENCES forecast_cycles(id) ON DELETE CASCADE,
    part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    ytd_monthly_counts JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_forecast INT NOT NULL DEFAULT 0,
    admin_override INT,
    final_forecast INT NOT NULL DEFAULT 0,
    safety_stock_units INT NOT NULL DEFAULT 0,
    recommended_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(forecast_cycle_id, part_id)
);

-- 10. Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_number TEXT UNIQUE NOT NULL,
    forecast_cycle_id UUID REFERENCES forecast_cycles(id) ON DELETE SET NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date DATE,
    status po_status NOT NULL DEFAULT 'draft',
    remarks TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS po_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    quantity_ordered INT NOT NULL,
    quantity_received INT NOT NULL DEFAULT 0,
    unit_price NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(po_id, part_id)
);

-- 11. Serialized Inventory Units
CREATE TABLE IF NOT EXISTS inventory_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    part_id UUID NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
    serial_number TEXT UNIQUE NOT NULL,
    imei_number TEXT,
    current_site_id UUID NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    status inventory_status NOT NULL DEFAULT 'in_stock',
    box_number INT DEFAULT 1,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    allocated_at TIMESTAMPTZ,
    allocated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    shipped_at TIMESTAMPTZ,
    shipped_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    received_confirmed_at TIMESTAMPTZ,
    received_confirmed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_serial ON inventory_units(serial_number);
CREATE INDEX IF NOT EXISTS idx_inventory_part_status ON inventory_units(part_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_site ON inventory_units(current_site_id);

-- 12. Allocation Cycles & Per-Site Allocations
CREATE TABLE IF NOT EXISTS allocation_cycles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    forecast_cycle_id UUID REFERENCES forecast_cycles(id) ON DELETE SET NULL,
    period_year INT NOT NULL,
    period_month INT NOT NULL,
    status allocation_status NOT NULL DEFAULT 'draft',
    approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS allocation_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    allocation_cycle_id UUID NOT NULL REFERENCES allocation_cycles(id) ON DELETE CASCADE,
    part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
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

-- 13. Shipments & Packing Lists
CREATE TABLE IF NOT EXISTS shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_number TEXT UNIQUE NOT NULL,
    invoice_ref TEXT,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    allocation_cycle_id UUID REFERENCES allocation_cycles(id) ON DELETE SET NULL,
    week_number INT DEFAULT 1,
    shipment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    carrier TEXT DEFAULT 'Lite Express',
    tracking_number TEXT,
    total_boxes INT DEFAULT 1,
    status shipment_status NOT NULL DEFAULT 'draft',
    prepared_by_name TEXT DEFAULT 'Joshua Juvida',
    verified_by_name TEXT DEFAULT 'Zhon Manaois',
    receiving_signature TEXT,
    remarks TEXT DEFAULT 'KGB PARTS',
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipment_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    inventory_unit_id UUID NOT NULL REFERENCES inventory_units(id) ON DELETE CASCADE,
    part_id UUID NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
    serial_number TEXT NOT NULL,
    box_number INT NOT NULL DEFAULT 1,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scanned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    UNIQUE(shipment_id, inventory_unit_id)
);

-- 14. Audit & Barcode Scan Logs
CREATE TABLE IF NOT EXISTS scan_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scan_type TEXT NOT NULL,
    part_number TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,
    po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    is_valid BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scan_logs_serial ON scan_logs(serial_number);
CREATE INDEX IF NOT EXISTS idx_scan_logs_created_at ON scan_logs(created_at DESC);

-- 15. Tightened Row Level Security (RLS) Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_page_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;

-- Helper RLS function: Check current role
CREATE OR REPLACE FUNCTION current_user_role() RETURNS user_role AS $$
    SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Profiles Policies
CREATE POLICY "Users can view own profile or admins view all" ON profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = id OR current_user_role() IN ('superadmin', 'admin'));

CREATE POLICY "Superadmins can manage profiles" ON profiles
    FOR ALL TO authenticated
    USING (current_user_role() = 'superadmin');

-- User Page Permissions Policies
CREATE POLICY "Users can read own page permissions" ON user_page_permissions
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR current_user_role() IN ('superadmin', 'admin'));

CREATE POLICY "Superadmins can manage page permissions" ON user_page_permissions
    FOR ALL TO authenticated
    USING (current_user_role() = 'superadmin');

-- Operational Tables (Authenticated Access Only)
CREATE POLICY "Authenticated users read parts" ON parts
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage parts" ON parts
    FOR ALL TO authenticated USING (current_user_role() IN ('superadmin', 'admin'));

CREATE POLICY "Authenticated users read sites" ON sites
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage sites" ON sites
    FOR ALL TO authenticated USING (current_user_role() IN ('superadmin', 'admin'));

CREATE POLICY "Staff read inventory" ON inventory_units
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff manage inventory" ON inventory_units
    FOR ALL TO authenticated USING (current_user_role() IN ('superadmin', 'admin', 'warehouse_staff'));

CREATE POLICY "Staff read shipments" ON shipments
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff manage shipments" ON shipments
    FOR ALL TO authenticated USING (current_user_role() IN ('superadmin', 'admin', 'warehouse_staff'));

CREATE POLICY "Staff read forecast" ON forecast_entries
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage forecast" ON forecast_entries
    FOR ALL TO authenticated USING (current_user_role() IN ('superadmin', 'admin'));

-- 16. Seed Superadmin Profiles & Default Page Permissions
-- PREREQUISITE: Create users in Supabase Auth first (Dashboard → Authentication → Users).
-- profiles.id references auth.users(id); do NOT use gen_random_uuid() here.

DO $$ BEGIN
    ALTER TABLE profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
EXCEPTION
    WHEN duplicate_table THEN null;
    WHEN duplicate_object THEN null;
END $$;

INSERT INTO profiles (id, email, full_name, role, has_set_password, is_active)
SELECT u.id, u.email, 'Zhon Manaois', 'superadmin', true, true
FROM auth.users u
WHERE u.email = 'zhon@mobilecare.com.ph'
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    has_set_password = EXCLUDED.has_set_password,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

INSERT INTO profiles (id, email, full_name, role, has_set_password, is_active)
SELECT u.id, u.email, 'Joshua Juvida', 'superadmin', true, true
FROM auth.users u
WHERE u.email = 'joshua@mobilecare.com.ph'
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    has_set_password = EXCLUDED.has_set_password,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- Grant all page permissions to both superadmins
DO $$
DECLARE
    uid UUID;
    pages TEXT[] := ARRAY['dashboard', 'import', 'forecast', 'records', 'orders', 'scan-in', 'allocation', 'scan-out', 'shipments', 'audit', 'settings', 'user-access'];
    p TEXT;
BEGIN
    FOR uid IN SELECT id FROM profiles WHERE role = 'superadmin' LOOP
        FOREACH p IN ARRAY pages LOOP
            INSERT INTO user_page_permissions (user_id, page_id)
            VALUES (uid, p)
            ON CONFLICT (user_id, page_id) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

-- 17. Period-Based Saved Records Snapshots Table
CREATE TABLE IF NOT EXISTS saved_records (
    id TEXT PRIMARY KEY,
    record_type TEXT NOT NULL DEFAULT 'both',
    period_label TEXT NOT NULL,
    period_year INT NOT NULL,
    period_month INT NOT NULL,
    period_week INT,
    notes TEXT,
    saved_by_name TEXT,
    saved_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    snapshot_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_records_created_at ON saved_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_records_type ON saved_records(record_type);
CREATE INDEX IF NOT EXISTS idx_saved_records_period ON saved_records(period_year, period_month);

ALTER TABLE saved_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read of saved_records" ON saved_records FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert of saved_records" ON saved_records FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update of saved_records" ON saved_records FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete of saved_records" ON saved_records FOR DELETE TO public USING (true);


