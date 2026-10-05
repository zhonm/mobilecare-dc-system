-- Ensure live databases support the status used by outbound shipment tracking.
DO $$ BEGIN
    ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'in_transit';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
