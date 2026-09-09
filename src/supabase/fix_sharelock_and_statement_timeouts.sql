-- ==============================================================================
-- MDC SYSTEM 2: Database Lock Contention, ShareLock & Statement Timeout Resolution
-- Resolves:
-- 1. "process <PID> still waiting for ShareLock on transaction <XID>" (Lock contention)
-- 2. Error 57014: "canceling statement due to statement timeout"
-- 3. High WAL buffer generation & connection pool saturation
-- 
-- Run this script in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wjikbnbdkxmesvvzbams/sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CONFIGURE SAFE TIMEOUTS TO PREVENT HANGING QUERIES & CONNECTION EXHAUSTION
-- ------------------------------------------------------------------------------
-- Setting lock_timeout prevents transactions from waiting indefinitely and blocking others
ALTER ROLE anon SET lock_timeout = '10s';
ALTER ROLE authenticated SET lock_timeout = '10s';
ALTER ROLE authenticator SET lock_timeout = '10s';

-- Set graceful statement timeout for API operations (20 seconds)
ALTER ROLE anon SET statement_timeout = '20s';
ALTER ROLE authenticated SET statement_timeout = '20s';
ALTER ROLE authenticator SET statement_timeout = '20s';

-- ------------------------------------------------------------------------------
-- 2. CREATE CRITICAL FOREIGN KEY & LOCKING INDEXES
-- Missing foreign key indexes cause PostgreSQL to escalate row locks into full
-- table share-locks and sequential scans during updates and deletes.
-- ------------------------------------------------------------------------------

-- 2.1 Saved Records (Singleton registries & snapshots)
CREATE INDEX IF NOT EXISTS idx_saved_records_saved_by_user_id 
    ON public.saved_records(saved_by_user_id);

CREATE INDEX IF NOT EXISTS idx_saved_records_id_type 
    ON public.saved_records(id, record_type);

-- 2.2 Inventory Units (Unindexed foreign keys referencing profiles & sites)
CREATE INDEX IF NOT EXISTS idx_inventory_units_received_by 
    ON public.inventory_units(received_by);

CREATE INDEX IF NOT EXISTS idx_inventory_units_allocated_by 
    ON public.inventory_units(allocated_by);

CREATE INDEX IF NOT EXISTS idx_inventory_units_shipped_by 
    ON public.inventory_units(shipped_by);

CREATE INDEX IF NOT EXISTS idx_inventory_units_received_confirmed_by 
    ON public.inventory_units(received_confirmed_by);

-- 2.3 Shipment Items (Foreign keys referencing parts, units, shipments)
CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment_id 
    ON public.shipment_items(shipment_id);

CREATE INDEX IF NOT EXISTS idx_shipment_items_part_id 
    ON public.shipment_items(part_id);

CREATE INDEX IF NOT EXISTS idx_shipment_items_inventory_unit_id 
    ON public.shipment_items(inventory_unit_id);

CREATE INDEX IF NOT EXISTS idx_shipment_items_serial 
    ON public.shipment_items(serial_number);

-- 2.4 Shipments (Parent header foreign keys)
CREATE INDEX IF NOT EXISTS idx_shipments_created_by 
    ON public.shipments(created_by);

CREATE INDEX IF NOT EXISTS idx_shipments_site_id 
    ON public.shipments(site_id);

-- 2.5 DC Intake Records (Inbound logistics)
CREATE INDEX IF NOT EXISTS idx_dc_intake_records_saved_by_user_id 
    ON public.dc_intake_records(saved_by_user_id);

CREATE INDEX IF NOT EXISTS idx_dc_intake_records_po_id 
    ON public.dc_intake_records(po_id);

-- ------------------------------------------------------------------------------
-- 3. REFRESH QUERY PLANNER STATISTICS
-- ANALYZE ensures the query planner selects fast index scans instead of table locks.
-- (ANALYZE is transaction-safe. If you wish to run VACUUM, run it as a standalone statement).
-- ------------------------------------------------------------------------------
ANALYZE public.saved_records;
ANALYZE public.inventory_units;
ANALYZE public.shipments;
ANALYZE public.shipment_items;
ANALYZE public.dc_intake_records;
ANALYZE public.parts;
ANALYZE public.sites;
ANALYZE public.profiles;

-- ------------------------------------------------------------------------------
-- 4. NOTIFY POSTGREST TO RELOAD SCHEMA CACHE
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
