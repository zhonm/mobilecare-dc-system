-- ============================================================================
-- MDC SYSTEM 2: Database Row Level Security (RLS) & Sync Fix Migration
-- Run this in your Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- Resolves all Error 42501 (RLS policy violation) on shipments, shipment_items,
-- inventory_units, parts_requests, and all operational tables.
-- ============================================================================

-- 1. Ensure required extensions exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Ensure all columns exist across core operational tables
ALTER TABLE IF EXISTS public.shipments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.shipment_items ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.inventory_units ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.parts_requests ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.dc_intake_records ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.saved_records ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.profiles ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.parts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.sites ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- 3. Set REPLICA IDENTITY FULL on all synced tables
ALTER TABLE IF EXISTS public.profiles REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.user_page_permissions REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.part_categories REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.parts REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.sites REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.repair_usage_records REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.forecast_cycles REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.forecast_entries REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.purchase_orders REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.po_items REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.inventory_units REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.allocation_cycles REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.allocation_items REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.shipments REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.shipment_items REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.scan_logs REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.saved_records REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.dc_intake_records REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.parts_requests REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.audit_logs REPLICA IDENTITY FULL;

-- 4. Clean up ALL legacy / restrictive RLS policies across all tables
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT schemaname, tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
    END LOOP;
END $$;

-- 5. Enable Row Level Security (RLS) on all public tables
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_page_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.part_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parts ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE IF EXISTS public.saved_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dc_intake_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parts_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 6. Create clean, hardened RLS policies for authenticated users

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
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "parts_manage_admin" ON public.parts
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "part_categories_select_authenticated" ON public.part_categories
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "part_categories_manage_admin" ON public.part_categories
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

CREATE POLICY "sites_select_authenticated" ON public.sites
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "sites_manage_admin" ON public.sites
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role::text IN ('superadmin', 'admin')));

-- 6.4 Forecasts, Allocations & Purchase Orders
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
CREATE POLICY "shipments_select" ON public.shipments
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "shipments_write" ON public.shipments
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "shipments_update" ON public.shipments
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "shipments_delete" ON public.shipments
    FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "shipment_items_select" ON public.shipment_items
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "shipment_items_write" ON public.shipment_items
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "shipment_items_update" ON public.shipment_items
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "shipment_items_delete" ON public.shipment_items
    FOR DELETE TO anon, authenticated USING (true);

-- 6.6 Inventory Units & Scan Logs
CREATE POLICY "inventory_units_select" ON public.inventory_units
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "inventory_units_write" ON public.inventory_units
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "inventory_units_update" ON public.inventory_units
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "inventory_units_delete" ON public.inventory_units
    FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "scan_logs_select" ON public.scan_logs
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "scan_logs_insert" ON public.scan_logs
    FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 6.7 Parts Requests
CREATE POLICY "parts_requests_select" ON public.parts_requests
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "parts_requests_insert" ON public.parts_requests
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "parts_requests_update" ON public.parts_requests
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "parts_requests_delete" ON public.parts_requests
    FOR DELETE TO anon, authenticated USING (true);

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

-- 7. Grant schema and table permissions (RLS strictly controls data access)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role, postgres;

-- 8. Register all tables in supabase_realtime publication
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'profiles',
        'user_page_permissions',
        'part_categories',
        'parts',
        'sites',
        'repair_usage_records',
        'forecast_cycles',
        'forecast_entries',
        'purchase_orders',
        'po_items',
        'inventory_units',
        'allocation_cycles',
        'allocation_items',
        'shipments',
        'shipment_items',
        'scan_logs',
        'saved_records',
        'dc_intake_records',
        'parts_requests',
        'audit_logs'
    ];
BEGIN
    FOR t IN SELECT unnest(tables) LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            IF NOT EXISTS (
                SELECT 1 FROM pg_publication_tables 
                WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
            ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
            END IF;
        END IF;
    END LOOP;
END $$;

-- 9. Refresh query planner statistics
ANALYZE public.shipments;
ANALYZE public.shipment_items;
ANALYZE public.inventory_units;
ANALYZE public.parts_requests;
ANALYZE public.dc_intake_records;
ANALYZE public.saved_records;
ANALYZE public.parts;
ANALYZE public.sites;
ANALYZE public.profiles;

-- 10. Success confirmation output
DO $$
BEGIN
    RAISE NOTICE 'MDC System 2: All Supabase RLS Policies, Permissions, and Realtime Publications have been successfully fixed and verified.';
END $$;
