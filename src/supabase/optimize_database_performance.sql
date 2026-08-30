-- ============================================================================
-- MDC SYSTEM 2: Database Performance, Indexing & Security Optimization Migration
-- 1. Fixes Supabase Advisor Critical Issues (security_invoker = true on views)
-- 2. Creates High-Performance Composite Indexes for Fast Lookups & Egress Reduction
-- 3. Updates Query Planner Statistics with ANALYZE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FIX SUPABASE ADVISOR SECURITY DEFINER VIEW ISSUES
-- ----------------------------------------------------------------------------
ALTER VIEW IF EXISTS public.view_repair_usage_in_scope SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_monthly_part_usage SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_part_site_shares SET (security_invoker = true);

-- ----------------------------------------------------------------------------
-- 2. HIGH-PERFORMANCE COMPOSITE INDEXES
-- ----------------------------------------------------------------------------

-- 2.1 Inventory Units (Barcode Scans, Packing & Stock Filters)
CREATE INDEX IF NOT EXISTS idx_inventory_units_status_site 
    ON public.inventory_units(current_site_id, status);

CREATE INDEX IF NOT EXISTS idx_inventory_units_serial_status 
    ON public.inventory_units(serial_number, status);

CREATE INDEX IF NOT EXISTS idx_inventory_units_part_status 
    ON public.inventory_units(part_id, status);

CREATE INDEX IF NOT EXISTS idx_inventory_units_box_status 
    ON public.inventory_units(box_number, status);

CREATE INDEX IF NOT EXISTS idx_inventory_units_po_id 
    ON public.inventory_units(po_id);

-- 2.2 Shipments (Packing Stations & Transit Status)
CREATE INDEX IF NOT EXISTS idx_shipments_status_created 
    ON public.shipments(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipments_site_status 
    ON public.shipments(site_id, status);

-- 2.3 Intake Records (DC Inbound Logistics)
CREATE INDEX IF NOT EXISTS idx_dc_intake_created 
    ON public.dc_intake_records(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dc_intake_records_name 
    ON public.dc_intake_records(record_name);

-- 2.4 Saved Period Records (Snapshots & Master Registries)
CREATE INDEX IF NOT EXISTS idx_saved_records_type_created 
    ON public.saved_records(record_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_records_period 
    ON public.saved_records(period_year, period_month);

-- 2.5 Parts Requests (Site Branch Inquiries & PMG Queue)
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'parts_requests') THEN
        CREATE INDEX IF NOT EXISTS idx_parts_requests_site_status 
            ON public.parts_requests(site_id, status, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_parts_requests_requested_by 
            ON public.parts_requests(requested_by, created_at DESC);
    END IF;
END $$;

-- 2.6 Audit Logs & Security
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
        CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp 
            ON public.audit_logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_entity 
            ON public.audit_logs(entity_type, entity_id);
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. UPDATE QUERY PLANNER STATISTICS
-- ----------------------------------------------------------------------------
ANALYZE public.inventory_units;
ANALYZE public.shipments;
ANALYZE public.dc_intake_records;
ANALYZE public.saved_records;
ANALYZE public.parts;
ANALYZE public.sites;
ANALYZE public.profiles;
