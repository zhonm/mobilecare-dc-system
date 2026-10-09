-- ============================================================================
-- Migration: Add allocated_site_id to public.inventory_units
-- Fixes Postgres Error 42703: "column inventory_units.allocated_site_id does not exist"
-- ============================================================================

DO $$
BEGIN
    -- 1. Add allocated_site_id column if it does not already exist
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inventory_units'
          AND column_name = 'allocated_site_id'
    ) THEN
        ALTER TABLE public.inventory_units
        ADD COLUMN allocated_site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added column allocated_site_id to public.inventory_units';
    ELSE
        RAISE NOTICE 'Column allocated_site_id already exists on public.inventory_units';
    END IF;

    -- 2. Create index on allocated_site_id for query performance
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'inventory_units'
          AND indexname = 'idx_inventory_units_allocated_site_id'
    ) THEN
        CREATE INDEX idx_inventory_units_allocated_site_id
        ON public.inventory_units (allocated_site_id);
        RAISE NOTICE 'Created index idx_inventory_units_allocated_site_id';
    END IF;
END $$;
