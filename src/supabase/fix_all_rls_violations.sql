-- ============================================================================
-- MDC SYSTEM 2: COMPLETE DATABASE RLS & PERMISSION UNBLOCK MIGRATION
-- Run this in Supabase SQL Editor (Dashboard -> SQL Editor -> New Query -> Run)
-- Resolves all Error 42501: "new row violates row-level security policy for table ..."
-- for repair_usage_records, parts, sites, part_categories, forecast, allocation,
-- purchase orders, inventory units, shipments, and all operational tables.
-- ============================================================================

-- 1. Grant full schema, table, sequence, and routine privileges to anon and authenticated
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role, postgres;

-- 2. Drop all existing RLS policies on public schema to prevent conflicts
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

-- 3. Ensure Row Level Security is enabled on all tables
ALTER TABLE IF EXISTS public.repair_usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.part_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.forecast_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.forecast_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.allocation_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.allocation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saved_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dc_intake_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parts_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_page_permissions ENABLE ROW LEVEL SECURITY;

-- 4. Create universal ALL (SELECT, INSERT, UPDATE, DELETE) policies for anon & authenticated

-- 4.1 Masterlist Ingestion & Catalog Tables
CREATE POLICY "allow_all_repair_usage_records" ON public.repair_usage_records
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_parts" ON public.parts
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_sites" ON public.sites
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_part_categories" ON public.part_categories
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4.2 Forecasting & Allocation Cycles
CREATE POLICY "allow_all_forecast_cycles" ON public.forecast_cycles
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_forecast_entries" ON public.forecast_entries
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_allocation_cycles" ON public.allocation_cycles
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_allocation_items" ON public.allocation_items
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4.3 Purchase Orders & Line Items
CREATE POLICY "allow_all_purchase_orders" ON public.purchase_orders
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_po_items" ON public.po_items
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4.4 Inventory Units & Logistics Scan Logs
CREATE POLICY "allow_all_inventory_units" ON public.inventory_units
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_scan_logs" ON public.scan_logs
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4.5 Shipments & Manifest Items
CREATE POLICY "allow_all_shipments" ON public.shipments
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_shipment_items" ON public.shipment_items
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4.6 Intake & Saved State Records
CREATE POLICY "allow_all_dc_intake_records" ON public.dc_intake_records
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_saved_records" ON public.saved_records
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4.7 Parts Requests & Audit Logs
CREATE POLICY "allow_all_parts_requests" ON public.parts_requests
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_audit_logs" ON public.audit_logs
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4.8 Profiles & Permissions
CREATE POLICY "allow_all_profiles" ON public.profiles
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_user_page_permissions" ON public.user_page_permissions
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
