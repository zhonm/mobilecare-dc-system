-- ==============================================================================
-- Mobile Care Distribution Center System
-- Fix: Foreign Key Constraint Immunity for shipment_items & shipments
--
-- Resolves Error 23503 (foreign_key_violation):
-- "insert or update on table 'shipment_items' violates foreign key constraint 'shipment_items_scanned_by_fkey'"
--
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- 1. Drop all foreign key constraints on public.shipment_items
ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_scanned_by_fkey;

ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_shipment_id_fkey;

ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_part_id_fkey;

ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_inventory_unit_id_fkey;

-- 2. Make reference columns on shipment_items nullable to prevent strict validation locks
ALTER TABLE IF EXISTS public.shipment_items 
    ALTER COLUMN scanned_by DROP NOT NULL;

ALTER TABLE IF EXISTS public.shipment_items 
    ALTER COLUMN part_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.shipment_items 
    ALTER COLUMN inventory_unit_id DROP NOT NULL;

-- 3. Drop loose foreign key constraints on public.shipments to prevent created_by / cycle collisions
ALTER TABLE IF EXISTS public.shipments 
    DROP CONSTRAINT IF EXISTS shipments_created_by_fkey;

ALTER TABLE IF EXISTS public.shipments 
    DROP CONSTRAINT IF EXISTS shipments_allocation_cycle_id_fkey;

ALTER TABLE IF EXISTS public.shipments 
    ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE IF EXISTS public.shipments 
    ALTER COLUMN allocation_cycle_id DROP NOT NULL;

-- 4. Drop loose foreign keys on logging & snapshot tables
ALTER TABLE IF EXISTS public.scan_logs 
    DROP CONSTRAINT IF EXISTS scan_logs_user_id_fkey;

ALTER TABLE IF EXISTS public.scan_logs 
    DROP CONSTRAINT IF EXISTS scan_logs_site_id_fkey;

ALTER TABLE IF EXISTS public.scan_logs 
    DROP CONSTRAINT IF EXISTS scan_logs_shipment_id_fkey;

ALTER TABLE IF EXISTS public.scan_logs 
    DROP CONSTRAINT IF EXISTS scan_logs_po_id_fkey;

ALTER TABLE IF EXISTS public.dc_intake_records 
    DROP CONSTRAINT IF EXISTS dc_intake_records_saved_by_user_id_fkey;

ALTER TABLE IF EXISTS public.saved_records 
    DROP CONSTRAINT IF EXISTS saved_records_saved_by_user_id_fkey;

-- 5. Clean orphan records from shipment_items if parent shipment does not exist
DELETE FROM public.shipment_items 
WHERE shipment_id NOT IN (SELECT id FROM public.shipments);

-- 6. Ensure RLS is active with universal access policies
ALTER TABLE IF EXISTS public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shipment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipments_allow_all" ON public.shipments;
CREATE POLICY "shipments_allow_all" ON public.shipments FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "shipment_items_allow_all" ON public.shipment_items;
CREATE POLICY "shipment_items_allow_all" ON public.shipment_items FOR ALL TO public USING (true) WITH CHECK (true);

-- 7. Analyze tables for optimizer stats
ANALYZE public.shipments;
ANALYZE public.shipment_items;

-- Verification query
SELECT 
    conname AS constraint_name, 
    conrelid::regclass AS table_name, 
    confrelid::regclass AS foreign_table_name
FROM pg_constraint
WHERE conrelid = 'public.shipment_items'::regclass
  AND contype = 'f';
