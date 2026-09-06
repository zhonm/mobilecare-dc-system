-- ==============================================================================
-- Mobile Care Distribution Center System
-- Fix: PostgREST PGRST200 Relationship Error for shipments -> shipment_items
--
-- Restores foreign key constraint between shipment_items.shipment_id and shipments.id
-- so that PostgREST can resolve embedded queries like select('*, shipment_items(*)')
-- ==============================================================================

-- 1. Clean any orphaned shipment items that reference non-existent shipments
DELETE FROM public.shipment_items 
WHERE shipment_id IS NOT NULL 
  AND shipment_id NOT IN (SELECT id FROM public.shipments);

-- 2. Add foreign key constraint from shipment_items to shipments
DO $$ BEGIN
    ALTER TABLE public.shipment_items
        ADD CONSTRAINT shipment_items_shipment_id_fkey
        FOREIGN KEY (shipment_id)
        REFERENCES public.shipments(id)
        ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Notify PostgREST to immediately reload schema cache
NOTIFY pgrst, 'reload schema';
