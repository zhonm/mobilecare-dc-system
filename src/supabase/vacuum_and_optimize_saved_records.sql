-- ==============================================================================
-- MDC SYSTEM 2: Diagnose & Clean Up saved_records Bloat / 15s+ Primary Key Stalls
-- Addresses:
--   - SELECT * FROM public.saved_records WHERE id = $1 taking 14-16s (57014 timeout)
--   - POST /rest/v1/saved_records?on_conflict=id returning HTTP 500
--   - Multi-MB TOAST dead tuples accumulating from frequent JSONB snapshot upserts
--
-- IMPORTANT: Run Section 1 and Section 2 SEPARATELY in Supabase SQL Editor
--            because VACUUM cannot run inside a multi-statement transaction block.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- SECTION 1: INSPECT BLOAT & LARGEST JSONB ROWS (Run first)
-- ------------------------------------------------------------------------------
SELECT
    relname AS table_name,
    n_live_tup AS live_rows,
    n_dead_tup AS dead_rows,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN ('saved_records', 'inventory_units')
ORDER BY pg_total_relation_size(relid) DESC;

SELECT
    id,
    record_type,
    pg_size_pretty(pg_column_size(snapshot_data)::bigint) AS jsonb_size,
    updated_at
FROM public.saved_records
ORDER BY pg_column_size(snapshot_data) DESC NULLS LAST
LIMIT 15;

-- ------------------------------------------------------------------------------
-- SECTION 2: RECLAIM DEAD TUPLES (Run each VACUUM statement one at a time)
-- ------------------------------------------------------------------------------
-- VACUUM (ANALYZE) public.saved_records;
-- VACUUM (ANALYZE) public.inventory_units;
