-- ============================================================================
-- SUPABASE REALTIME RATE LIMIT FIX & QUOTA OPTIMIZATION
-- Error Remediation: "MessagesPerSecondRateLimitReached: Too many postgres_changes messages per second"
-- 
-- Root Cause:
-- High-volume bulk tables (inventory_units, scan_logs, saved_records, dc_intake_records,
-- allocation_items, forecast_entries, repair_usage_records, shipment_items, po_items)
-- were published to 'supabase_realtime'. When batch inserts or updates occur (e.g. 100+ serials),
-- Postgres WAL logical replication generates 100+ messages per millisecond, exceeding the 
-- Realtime rate limit (100 msgs/sec) and rapidly depleting monthly project quota.
--
-- Solution:
-- 1. Remove high-volume bulk data tables from the supabase_realtime publication.
-- 2. Keep only lightweight, low-frequency event tables (parts_requests, profiles, user_page_permissions, shipments, sites, purchase_orders).
-- 3. High-volume sync is handled via lightweight Supabase Broadcast Channels (1 broadcast = 1 message total).
-- ============================================================================

-- Step 1: Remove high-volume bulk tables from supabase_realtime publication
DO $$
DECLARE
    t text;
    bulk_tables text[] := ARRAY[
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
    FOR t IN SELECT unnest(bulk_tables) LOOP
        IF EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I;', t);
            RAISE NOTICE 'Dropped % from supabase_realtime publication', t;
        END IF;
    END LOOP;
END $$;

-- Step 2: Ensure only lightweight, low-frequency event tables remain in supabase_realtime
DO $$
DECLARE
    t text;
    essential_tables text[] := ARRAY[
        'parts_requests',
        'profiles',
        'user_page_permissions',
        'shipments',
        'sites',
        'purchase_orders'
    ];
BEGIN
    FOR t IN SELECT unnest(essential_tables) LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            IF NOT EXISTS (
                SELECT 1 FROM pg_publication_tables 
                WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
            ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
                RAISE NOTICE 'Added % to supabase_realtime publication', t;
            END IF;
        END IF;
    END LOOP;
END $$;

-- Step 3: Refresh query planner statistics
ANALYZE public.parts_requests;
ANALYZE public.profiles;
ANALYZE public.user_page_permissions;
ANALYZE public.shipments;
ANALYZE public.sites;
ANALYZE public.purchase_orders;

-- Step 4: Display current publication tables for verification
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
