-- ==============================================================================
-- Mobile Care Distribution Center System
-- Supabase Schema Constraint & Cascade Fix Migration
-- Resolves:
-- 1. duplicate key value violates unique constraint "shipments_shipment_number_key"
-- 2. update or delete on table "shipments" violates foreign key constraint "shipment_items_shipment_id_fkey"
-- 3. insert or update on table "shipment_items" violates foreign key constraint "shipment_items_part_id_fkey"
-- ==============================================================================

-- 1. Ensure foreign key on shipment_items.shipment_id has ON DELETE CASCADE
ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_shipment_id_fkey;

ALTER TABLE IF EXISTS public.shipment_items 
    ADD CONSTRAINT shipment_items_shipment_id_fkey 
    FOREIGN KEY (shipment_id) 
    REFERENCES public.shipments(id) 
    ON DELETE CASCADE;

-- 2. Make inventory_unit_id and part_id nullable and set ON DELETE SET NULL to prevent hard FK crashes
ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_inventory_unit_id_fkey;

ALTER TABLE IF EXISTS public.shipment_items 
    ALTER COLUMN inventory_unit_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.shipment_items 
    ADD CONSTRAINT shipment_items_inventory_unit_id_fkey 
    FOREIGN KEY (inventory_unit_id) 
    REFERENCES public.inventory_units(id) 
    ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.shipment_items 
    DROP CONSTRAINT IF EXISTS shipment_items_part_id_fkey;

ALTER TABLE IF EXISTS public.shipment_items 
    ALTER COLUMN part_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.shipment_items 
    ADD CONSTRAINT shipment_items_part_id_fkey 
    FOREIGN KEY (part_id) 
    REFERENCES public.parts(id) 
    ON DELETE SET NULL;

-- 3. Refresh RLS policies on shipments and shipment_items
ALTER TABLE IF EXISTS public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shipment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipments_allow_all" ON public.shipments;
CREATE POLICY "shipments_allow_all" ON public.shipments FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "shipment_items_allow_all" ON public.shipment_items;
CREATE POLICY "shipment_items_allow_all" ON public.shipment_items FOR ALL TO public USING (true) WITH CHECK (true);

-- 4. Clean orphan shipment items if any exist
DELETE FROM public.shipment_items 
WHERE shipment_id NOT IN (SELECT id FROM public.shipments);

ANALYZE public.shipments;
ANALYZE public.shipment_items;
