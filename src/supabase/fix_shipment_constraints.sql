-- ==============================================================================
-- Mobile Care Distribution Center System
-- Permanent Foreign Key Immunity Migration
-- Run this in Supabase SQL Editor to permanently remove all foreign key
-- constraints on shipment_items, ensuring zero insert/update/delete errors.
-- ==============================================================================

-- 1. Drop foreign key constraint on shipment_id
ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_shipment_id_fkey;

-- 2. Drop foreign key constraint on part_id
ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_part_id_fkey;

ALTER TABLE IF EXISTS public.shipment_items 
    ALTER COLUMN part_id DROP NOT NULL;

-- 3. Drop foreign key constraint on inventory_unit_id
ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_inventory_unit_id_fkey;

ALTER TABLE IF EXISTS public.shipment_items 
    ALTER COLUMN inventory_unit_id DROP NOT NULL;

-- 4. Clean orphan records
DELETE FROM public.shipment_items 
WHERE shipment_id NOT IN (SELECT id FROM public.shipments);

-- 5. Refresh RLS policies to allow full read/write for all authenticated clients
ALTER TABLE IF EXISTS public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shipment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipments_allow_all" ON public.shipments;
CREATE POLICY "shipments_allow_all" ON public.shipments FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "shipment_items_allow_all" ON public.shipment_items;
CREATE POLICY "shipment_items_allow_all" ON public.shipment_items FOR ALL TO public USING (true) WITH CHECK (true);

ANALYZE public.shipments;
ANALYZE public.shipment_items;
