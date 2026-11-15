-- ============================================================================
-- Migration: System-Wide Sync Performance Indexes (Supabase Free Tier Safe)
-- Purpose: Eliminate full-table scans on incremental delta syncs, header probes,
--          and 60-day rolling window queries without adding storage bloat.
-- ============================================================================

-- 1. Inventory Units: O(log N) latest-timestamp probe & incremental delta sync (updated_at > lastSyncAt)
CREATE INDEX IF NOT EXISTS idx_inventory_units_updated_at
  ON public.inventory_units (updated_at DESC);

-- 2. Saved Records: Fast record_type + updated_at delta & recent-shipment lookups
CREATE INDEX IF NOT EXISTS idx_saved_records_type_updated_at
  ON public.saved_records (record_type, updated_at DESC);

-- 3. Shipments: Branch-scoped & status/date filtered lookups
CREATE INDEX IF NOT EXISTS idx_shipments_site_updated_at
  ON public.shipments (site_id, updated_at DESC);

-- 4. Parts Requests: Branch-scoped recent requests
CREATE INDEX IF NOT EXISTS idx_parts_requests_site_created_at
  ON public.parts_requests (site_id, created_at DESC);

-- 5. DC Intake Records: 60-day rolling window queries
CREATE INDEX IF NOT EXISTS idx_dc_intake_records_created_at
  ON public.dc_intake_records (created_at DESC);
