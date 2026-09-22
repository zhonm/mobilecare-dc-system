-- ============================================================================
-- SQL SCRIPT: Purge Saved Period Records from Supabase Database
-- File: src/supabase/purge_saved_period_records.sql
-- ============================================================================
-- Permanently deletes all historical period snapshots and associated registries
-- from the saved_records table to free database storage and eliminate egress overhead.

DELETE FROM public.saved_records
WHERE record_type IN ('both', 'forecast', 'allocation', 'period_record', 'historical_archive')
   OR id LIKE 'rec-%'
   OR id IN ('master_period_records_registry', 'deleted_period_record_ids_registry');
