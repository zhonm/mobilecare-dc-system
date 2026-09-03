-- ============================================================================
-- SUPABASE EGRESS & REALTIME BANDWIDTH OPTIMIZATION MIGRATION
-- Purpose: Keep usage comfortably below 5 GB Egress & 2M Realtime quota on Free Plan
-- ============================================================================

-- 1. Ensure high-volume tables are strictly EXCLUDED from supabase_realtime publication
DO $$
DECLARE
    t text;
    heavy_tables text[] := ARRAY[
        'inventory_units',
        'scan_logs',
        'audit_logs',
        'saved_records',
        'dc_intake_records',
        'shipment_items',
        'allocation_items',
        'forecast_entries',
        'repair_usage_records',
        'po_items'
    ];
BEGIN
    FOR t IN SELECT unnest(heavy_tables) LOOP
        IF EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I;', t);
            RAISE NOTICE 'Dropped % from supabase_realtime publication', t;
        END IF;
    END LOOP;
END $$;

-- 2. Ensure REPLICA IDENTITY is DEFAULT (not FULL) on operational tables to minimize WAL payload size
ALTER TABLE IF EXISTS public.inventory_units REPLICA IDENTITY DEFAULT;
ALTER TABLE IF EXISTS public.shipments REPLICA IDENTITY DEFAULT;
ALTER TABLE IF EXISTS public.shipment_items REPLICA IDENTITY DEFAULT;
ALTER TABLE IF EXISTS public.dc_intake_records REPLICA IDENTITY DEFAULT;
ALTER TABLE IF EXISTS public.parts_requests REPLICA IDENTITY DEFAULT;

-- 3. Verify publication tables
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
ORDER BY tablename;
