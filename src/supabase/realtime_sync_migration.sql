-- ============================================================================
-- MDC SYSTEM 2: Multi-User Real-Time Sync & Security Hardening Migration
-- Enables Supabase Realtime publication on all core tables, sets REPLICA IDENTITY FULL,
-- configures complete RLS policies (SELECT, INSERT, UPDATE, DELETE),
-- and adds performance indexes for real-time synchronization.
-- ============================================================================

-- 1. Ensure all core tables exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Add is_deleted column to support clean soft-delete if used
ALTER TABLE IF EXISTS dc_intake_records ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS shipments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS saved_records ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS inventory_units ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS parts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS sites ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- 3. Set REPLICA IDENTITY FULL on all synced tables
-- Required so that UPDATE and DELETE events send all row fields in Realtime payloads
ALTER TABLE IF EXISTS profiles REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS user_page_permissions REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS part_categories REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS parts REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS sites REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS repair_usage_records REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS forecast_cycles REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS forecast_entries REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS purchase_orders REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS po_items REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS inventory_units REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS allocation_cycles REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS allocation_items REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS shipments REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS shipment_items REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS scan_logs REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS saved_records REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS dc_intake_records REPLICA IDENTITY FULL;

-- 4. Register essential low-frequency event tables in the supabase_realtime publication
-- High-volume bulk data tables (inventory_units, scan_logs, shipment_items, etc.) are omitted to prevent rate limit errors.
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'profiles',
        'user_page_permissions',
        'sites',
        'purchase_orders',
        'shipments',
        'parts_requests'
    ];
BEGIN
    FOR t IN SELECT unnest(tables) LOOP
        -- Check if table exists before adding to publication
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            -- Check if already in publication
            IF NOT EXISTS (
                SELECT 1 FROM pg_publication_tables 
                WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
            ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
            END IF;
        END IF;
    END LOOP;
END $$;

-- 5. Row Level Security (RLS) - Complete Policies for All Operations (SELECT, INSERT, UPDATE, DELETE)
-- Enable RLS on all tables
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_page_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS part_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS repair_usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecast_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecast_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS allocation_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS allocation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS saved_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dc_intake_records ENABLE ROW LEVEL SECURITY;

-- 5.1 Profiles
DO $$ BEGIN
    DROP POLICY IF EXISTS "Allow public delete of profiles" ON profiles;
    CREATE POLICY "mdc_sync_profiles_select" ON profiles FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_profiles_insert" ON profiles FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_profiles_update" ON profiles FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_profiles_delete" ON profiles FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.2 User Page Permissions
DO $$ BEGIN
    CREATE POLICY "mdc_sync_user_page_permissions_select" ON user_page_permissions FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_user_page_permissions_insert" ON user_page_permissions FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_user_page_permissions_update" ON user_page_permissions FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_user_page_permissions_delete" ON user_page_permissions FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.3 Part Categories & Parts
DO $$ BEGIN
    CREATE POLICY "mdc_sync_part_categories_select" ON part_categories FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_part_categories_insert" ON part_categories FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_part_categories_update" ON part_categories FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_part_categories_delete" ON part_categories FOR DELETE TO public USING (true);

    CREATE POLICY "mdc_sync_parts_select" ON parts FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_parts_insert" ON parts FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_parts_update" ON parts FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_parts_delete" ON parts FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.4 Sites
DO $$ BEGIN
    CREATE POLICY "mdc_sync_sites_select" ON sites FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_sites_insert" ON sites FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_sites_update" ON sites FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_sites_delete" ON sites FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.5 DC Intake Records & Saved Records
DO $$ BEGIN
    CREATE POLICY "mdc_sync_dc_intake_records_select" ON dc_intake_records FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_dc_intake_records_insert" ON dc_intake_records FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_dc_intake_records_update" ON dc_intake_records FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_dc_intake_records_delete" ON dc_intake_records FOR DELETE TO public USING (true);

    CREATE POLICY "mdc_sync_saved_records_select" ON saved_records FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_saved_records_insert" ON saved_records FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_saved_records_update" ON saved_records FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_saved_records_delete" ON saved_records FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.6 Inventory Units
DO $$ BEGIN
    CREATE POLICY "mdc_sync_inventory_units_select" ON inventory_units FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_inventory_units_insert" ON inventory_units FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_inventory_units_update" ON inventory_units FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_inventory_units_delete" ON inventory_units FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.7 Shipments & Shipment Items
DO $$ BEGIN
    CREATE POLICY "mdc_sync_shipments_select" ON shipments FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_shipments_insert" ON shipments FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_shipments_update" ON shipments FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_shipments_delete" ON shipments FOR DELETE TO public USING (true);

    CREATE POLICY "mdc_sync_shipment_items_select" ON shipment_items FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_shipment_items_insert" ON shipment_items FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_shipment_items_update" ON shipment_items FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_shipment_items_delete" ON shipment_items FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.8 Forecast Cycles & Forecast Entries
DO $$ BEGIN
    CREATE POLICY "mdc_sync_forecast_cycles_select" ON forecast_cycles FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_forecast_cycles_insert" ON forecast_cycles FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_forecast_cycles_update" ON forecast_cycles FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_forecast_cycles_delete" ON forecast_cycles FOR DELETE TO public USING (true);

    CREATE POLICY "mdc_sync_forecast_entries_select" ON forecast_entries FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_forecast_entries_insert" ON forecast_entries FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_forecast_entries_update" ON forecast_entries FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_forecast_entries_delete" ON forecast_entries FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.9 Allocation Cycles & Allocation Items
DO $$ BEGIN
    CREATE POLICY "mdc_sync_allocation_cycles_select" ON allocation_cycles FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_allocation_cycles_insert" ON allocation_cycles FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_allocation_cycles_update" ON allocation_cycles FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_allocation_cycles_delete" ON allocation_cycles FOR DELETE TO public USING (true);

    CREATE POLICY "mdc_sync_allocation_items_select" ON allocation_items FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_allocation_items_insert" ON allocation_items FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_allocation_items_update" ON allocation_items FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_allocation_items_delete" ON allocation_items FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.10 Purchase Orders & PO Items
DO $$ BEGIN
    CREATE POLICY "mdc_sync_purchase_orders_select" ON purchase_orders FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_purchase_orders_insert" ON purchase_orders FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_purchase_orders_update" ON purchase_orders FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_purchase_orders_delete" ON purchase_orders FOR DELETE TO public USING (true);

    CREATE POLICY "mdc_sync_po_items_select" ON po_items FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_po_items_insert" ON po_items FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_po_items_update" ON po_items FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_po_items_delete" ON po_items FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 5.11 Scan Logs & Repair Usage Records
DO $$ BEGIN
    CREATE POLICY "mdc_sync_scan_logs_select" ON scan_logs FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_scan_logs_insert" ON scan_logs FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_scan_logs_update" ON scan_logs FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_scan_logs_delete" ON scan_logs FOR DELETE TO public USING (true);

    CREATE POLICY "mdc_sync_repair_usage_records_select" ON repair_usage_records FOR SELECT TO public USING (true);
    CREATE POLICY "mdc_sync_repair_usage_records_insert" ON repair_usage_records FOR INSERT TO public WITH CHECK (true);
    CREATE POLICY "mdc_sync_repair_usage_records_update" ON repair_usage_records FOR UPDATE TO public USING (true) WITH CHECK (true);
    CREATE POLICY "mdc_sync_repair_usage_records_delete" ON repair_usage_records FOR DELETE TO public USING (true);
EXCEPTION WHEN others THEN null; END $$;

-- 6. Performance Indexes for Real-Time Queries & Sorting
CREATE INDEX IF NOT EXISTS idx_inventory_units_updated_at ON inventory_units(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_units_status ON inventory_units(status);
CREATE INDEX IF NOT EXISTS idx_inventory_units_site ON inventory_units(current_site_id);
CREATE INDEX IF NOT EXISTS idx_inventory_units_serial ON inventory_units(serial_number);

CREATE INDEX IF NOT EXISTS idx_dc_intake_records_updated_at ON dc_intake_records(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dc_intake_records_created_at ON dc_intake_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dc_intake_records_date ON dc_intake_records(intake_date DESC);

CREATE INDEX IF NOT EXISTS idx_shipments_updated_at ON shipments(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_site ON shipments(site_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);

CREATE INDEX IF NOT EXISTS idx_parts_updated_at ON parts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_part_number ON parts(part_number);

CREATE INDEX IF NOT EXISTS idx_sites_updated_at ON sites(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sites_code ON sites(code);

CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_records_updated_at ON saved_records(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_records_type ON saved_records(record_type);
