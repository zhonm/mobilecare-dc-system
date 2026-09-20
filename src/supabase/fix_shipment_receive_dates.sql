-- ============================================================================
-- MDC SYSTEM 2: FIX SHIPMENT RECEIVE DATES & PERSISTENCE
-- Target Supabase Project: wjikbnbdkxmesvvzbams
--
-- PURPOSE:
-- 1. Add missing 'received_date', 'received_at', 'received_by_name',
--    'receiving_condition', 'receiving_notes', and 'pickup_date' columns
--    to 'public.shipments' table so that branch receipt confirmation dates
--    are durably stored in PostgreSQL.
-- 2. Backfill existing confirmed/delivered shipments with their receipt timestamps
--    from updated_at and receiving_signature.
-- 3. Reload PostgREST schema cache to make new columns immediately queryable.
-- ============================================================================

-- STEP 1: Add receipt & dispatch tracking columns to public.shipments
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS received_date DATE;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS received_by_name TEXT;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS receiving_condition TEXT;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS receiving_notes TEXT;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS pickup_date DATE;

-- STEP 2: Backfill existing confirmed and delivered shipments
UPDATE public.shipments
SET 
    received_at = COALESCE(received_at, updated_at, created_at),
    received_date = COALESCE(received_date, (updated_at::date), (created_at::date)),
    received_by_name = COALESCE(received_by_name, receiving_signature),
    pickup_date = COALESCE(pickup_date, shipment_date)
WHERE (status = 'received_confirmed' OR status = 'delivered');

-- Also backfill pickup_date for all other shipments
UPDATE public.shipments
SET pickup_date = COALESCE(pickup_date, shipment_date)
WHERE pickup_date IS NULL AND shipment_date IS NOT NULL;

-- STEP 3: Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
