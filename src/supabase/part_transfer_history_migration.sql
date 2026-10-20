-- ============================================================================
-- MDC System 2: Stock Ownership & Part Transfer History Migration
-- Tracks full audit trail of stock ownership transfers between sites (DC, POD, BHS, etc.)
-- Ensures immutable append-only movement history (e.g., DC -> POD -> DC -> ANNEX)
-- ============================================================================

-- 1. Create Dedicated Part Transfer History Table
CREATE TABLE IF NOT EXISTS public.part_transfer_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_number TEXT NOT NULL,
    serial_number TEXT,
    from_site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    from_site_code TEXT NOT NULL DEFAULT 'DC',
    from_site_name TEXT,
    to_site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    to_site_code TEXT NOT NULL DEFAULT 'DC',
    to_site_name TEXT,
    from_owner TEXT NOT NULL DEFAULT 'DC_MSPI-OWNED',
    to_owner TEXT NOT NULL DEFAULT 'DC_MSPI-OWNED',
    transfer_type TEXT NOT NULL DEFAULT 'Transfer', -- 'Transfer', 'Return', 'Adjustment', 'Inbound Intake', 'Dispatch'
    transfer_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL DEFAULT 'System Staff',
    manifest_ref TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Performance & Audit Query Indexes
CREATE INDEX IF NOT EXISTS idx_part_transfer_history_serial ON public.part_transfer_history(serial_number);
CREATE INDEX IF NOT EXISTS idx_part_transfer_history_part ON public.part_transfer_history(part_number);
CREATE INDEX IF NOT EXISTS idx_part_transfer_history_date ON public.part_transfer_history(transfer_date DESC);
CREATE INDEX IF NOT EXISTS idx_part_transfer_history_from_to ON public.part_transfer_history(from_site_code, to_site_code);
CREATE INDEX IF NOT EXISTS idx_part_transfer_history_type ON public.part_transfer_history(transfer_type);

-- 3. Row Level Security Policies
ALTER TABLE public.part_transfer_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read part_transfer_history" ON public.part_transfer_history;
CREATE POLICY "Allow authenticated read part_transfer_history"
    ON public.part_transfer_history FOR SELECT
    TO public
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert part_transfer_history" ON public.part_transfer_history;
CREATE POLICY "Allow authenticated insert part_transfer_history"
    ON public.part_transfer_history FOR INSERT
    TO public
    WITH CHECK (true);

-- Ensure public access to sync under free tier / service role
GRANT ALL ON TABLE public.part_transfer_history TO authenticated, anon;
