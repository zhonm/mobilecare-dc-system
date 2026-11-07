-- ============================================================================
-- MDC System 2: Fix Part Transfer History Row Level Security (RLS) & Upsert Policy
-- Resolves Postgres error 42501: "new row violates row-level security policy (USING expression) for table 'part_transfer_history'"
-- ============================================================================

-- 1. Ensure table exists with RLS enabled
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
    transfer_type TEXT NOT NULL DEFAULT 'Transfer',
    transfer_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL DEFAULT 'Warehouse Staff',
    manifest_ref TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.part_transfer_history ENABLE ROW LEVEL SECURITY;

-- 2. Clean up legacy partial policies
DROP POLICY IF EXISTS "Allow authenticated read part_transfer_history" ON public.part_transfer_history;
DROP POLICY IF EXISTS "Allow authenticated insert part_transfer_history" ON public.part_transfer_history;
DROP POLICY IF EXISTS "Allow authenticated update part_transfer_history" ON public.part_transfer_history;
DROP POLICY IF EXISTS "Allow authenticated delete part_transfer_history" ON public.part_transfer_history;
DROP POLICY IF EXISTS "part_transfer_history_all" ON public.part_transfer_history;
DROP POLICY IF EXISTS "Allow all part_transfer_history" ON public.part_transfer_history;

-- 3. Comprehensive RLS policy granting full CRUD for public (anon & authenticated)
-- This allows UPSERT (INSERT ... ON CONFLICT DO UPDATE/NOTHING) without 42501 violations
CREATE POLICY "part_transfer_history_all" ON public.part_transfer_history
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 4. Grant table privileges
GRANT ALL ON TABLE public.part_transfer_history TO authenticated, anon, service_role;
