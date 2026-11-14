-- ============================================================================
-- Non-Destructive Migration: Expand GSX Parts Catalog + Consumables & Tools
-- Safe to run on both fresh databases and existing production databases.
-- Does NOT drop, truncate, or overwrite existing parts, inventory_units, or po_items.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Non-Destructive GSX Metadata Extensions on public.parts
-- ----------------------------------------------------------------------------
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS part_type TEXT;
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS component_group TEXT;
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS serialized_module BOOLEAN;
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS substitute_part TEXT;
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS secondary_part TEXT;
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS exchange_price NUMERIC(10,2);
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS compatible_models JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS is_gsx_current BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS gsx_source TEXT;

CREATE INDEX IF NOT EXISTS idx_parts_gsx_current ON public.parts(is_gsx_current);
CREATE INDEX IF NOT EXISTS idx_parts_part_type ON public.parts(part_type);

-- ----------------------------------------------------------------------------
-- 2. Consumables & Tools Catalog (Separate from Repair Parts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumables_tools_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_number TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    item_kind TEXT NOT NULL CHECK (item_kind IN ('consumable', 'tool')),
    category TEXT NOT NULL DEFAULT 'General',
    unit_of_measure TEXT NOT NULL DEFAULT 'pcs',
    pack_size INT NOT NULL DEFAULT 1,
    unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_serialized BOOLEAN NOT NULL DEFAULT false,
    min_stock_threshold INT NOT NULL DEFAULT 2,
    reorder_qty INT NOT NULL DEFAULT 5,
    is_synthetic_sku BOOLEAN NOT NULL DEFAULT false,
    needs_review BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_catalog_pn ON public.consumables_tools_catalog(part_number);
CREATE INDEX IF NOT EXISTS idx_ct_catalog_kind ON public.consumables_tools_catalog(item_kind);
CREATE INDEX IF NOT EXISTS idx_ct_catalog_active ON public.consumables_tools_catalog(is_active);

-- ----------------------------------------------------------------------------
-- 3. Consumables & Tools Purchase Orders
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumables_tools_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number TEXT UNIQUE NOT NULL,
    order_number TEXT,
    site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    site_code TEXT,
    ship_to_location TEXT,
    sold_to_location TEXT,
    supplier TEXT NOT NULL DEFAULT 'Apple South Asia Pte Ltd',
    order_date DATE,
    status TEXT NOT NULL DEFAULT 'ordered'
        CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'closed', 'cancelled')),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    remarks TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_orders_po ON public.consumables_tools_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_ct_orders_site ON public.consumables_tools_orders(site_code);
CREATE INDEX IF NOT EXISTS idx_ct_orders_status ON public.consumables_tools_orders(status);

CREATE TABLE IF NOT EXISTS public.consumables_tools_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.consumables_tools_orders(id) ON DELETE CASCADE,
    catalog_id UUID REFERENCES public.consumables_tools_catalog(id) ON DELETE RESTRICT,
    part_number TEXT NOT NULL,
    description TEXT NOT NULL,
    item_kind TEXT NOT NULL DEFAULT 'consumable' CHECK (item_kind IN ('consumable', 'tool')),
    quantity_ordered INT NOT NULL DEFAULT 0 CHECK (quantity_ordered >= 0),
    quantity_received INT NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
    unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
    needs_review BOOLEAN NOT NULL DEFAULT false,
    review_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, part_number, description)
);

CREATE INDEX IF NOT EXISTS idx_ct_order_items_order ON public.consumables_tools_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_ct_order_items_pn ON public.consumables_tools_order_items(part_number);

-- ----------------------------------------------------------------------------
-- 4. Consumables Quantity Stock Levels (per item & site)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumables_tools_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_id UUID NOT NULL REFERENCES public.consumables_tools_catalog(id) ON DELETE CASCADE,
    site_id UUID REFERENCES public.sites(id) ON DELETE CASCADE,
    site_code TEXT NOT NULL,
    qty_on_hand INT NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
    qty_reserved INT NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
    qty_consumed INT NOT NULL DEFAULT 0 CHECK (qty_consumed >= 0),
    qty_shipped INT NOT NULL DEFAULT 0 CHECK (qty_shipped >= 0),
    min_stock_threshold INT NOT NULL DEFAULT 2,
    reorder_qty INT NOT NULL DEFAULT 5,
    last_received_at TIMESTAMPTZ,
    last_updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    last_updated_by_name TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (catalog_id, site_code)
);

CREATE INDEX IF NOT EXISTS idx_ct_stock_catalog ON public.consumables_tools_stock(catalog_id);
CREATE INDEX IF NOT EXISTS idx_ct_stock_site ON public.consumables_tools_stock(site_code);

-- ----------------------------------------------------------------------------
-- 5. Tool Assets (Individually Tracked & Optionally Serialized)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_id UUID NOT NULL REFERENCES public.consumables_tools_catalog(id) ON DELETE RESTRICT,
    part_number TEXT NOT NULL,
    description TEXT NOT NULL,
    asset_tag TEXT UNIQUE NOT NULL,
    serial_number TEXT UNIQUE,
    site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    site_code TEXT NOT NULL,
    order_id UUID REFERENCES public.consumables_tools_orders(id) ON DELETE SET NULL,
    shipment_id UUID,
    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'in_use', 'in_transit', 'shipped', 'missing', 'retired')),
    assigned_to TEXT,
    assigned_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    received_by_name TEXT,
    shipped_at TIMESTAMPTZ,
    shipped_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    shipped_by_name TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_assets_catalog ON public.tool_assets(catalog_id);
CREATE INDEX IF NOT EXISTS idx_tool_assets_site ON public.tool_assets(site_code);
CREATE INDEX IF NOT EXISTS idx_tool_assets_status ON public.tool_assets(status);
CREATE INDEX IF NOT EXISTS idx_tool_assets_serial ON public.tool_assets(serial_number);

-- ----------------------------------------------------------------------------
-- 6. Consumables & Tools Movement History Ledger (Append-Only Traceability)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumables_tools_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_id UUID REFERENCES public.consumables_tools_catalog(id) ON DELETE SET NULL,
    part_number TEXT NOT NULL,
    description TEXT,
    item_kind TEXT NOT NULL DEFAULT 'consumable' CHECK (item_kind IN ('consumable', 'tool')),
    action TEXT NOT NULL
        CHECK (action IN ('ordered', 'received', 'in_stock', 'consumed', 'shipped', 'delivered', 'status_change', 'checked_out', 'checked_in', 'adjustment')),
    quantity INT NOT NULL DEFAULT 1,
    serial_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
    asset_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    from_site_code TEXT,
    to_site_code TEXT,
    reference_type TEXT,
    reference_id TEXT,
    reference_number TEXT,
    performed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    performed_by_name TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_movements_catalog ON public.consumables_tools_movements(catalog_id);
CREATE INDEX IF NOT EXISTS idx_ct_movements_pn ON public.consumables_tools_movements(part_number);
CREATE INDEX IF NOT EXISTS idx_ct_movements_created ON public.consumables_tools_movements(created_at DESC);

-- ----------------------------------------------------------------------------
-- 7. Consumables & Tools Shipments & Dedicated Packing Lists
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumables_tools_shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_number TEXT UNIQUE NOT NULL,
    packing_list_number TEXT UNIQUE NOT NULL,
    from_site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    from_site_code TEXT NOT NULL DEFAULT 'DC-MDC',
    from_site_name TEXT NOT NULL DEFAULT 'MOBILE CARE SERVICES PHILS. INC. - Distribution Center',
    to_site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    to_site_code TEXT NOT NULL,
    to_site_name TEXT NOT NULL,
    shipment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    carrier TEXT DEFAULT 'Lalamove',
    tracking_number TEXT,
    status TEXT NOT NULL DEFAULT 'packed'
        CHECK (status IN ('draft', 'packed', 'shipped', 'in_transit', 'delivered', 'cancelled')),
    prepared_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    prepared_by_name TEXT NOT NULL,
    verified_by_name TEXT,
    received_by_name TEXT,
    received_at TIMESTAMPTZ,
    notes TEXT,
    signature_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_shipments_number ON public.consumables_tools_shipments(shipment_number);
CREATE INDEX IF NOT EXISTS idx_ct_shipments_to_site ON public.consumables_tools_shipments(to_site_code);
CREATE INDEX IF NOT EXISTS idx_ct_shipments_status ON public.consumables_tools_shipments(status);

CREATE TABLE IF NOT EXISTS public.consumables_tools_shipment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID NOT NULL REFERENCES public.consumables_tools_shipments(id) ON DELETE CASCADE,
    catalog_id UUID REFERENCES public.consumables_tools_catalog(id) ON DELETE RESTRICT,
    part_number TEXT NOT NULL,
    description TEXT NOT NULL,
    item_kind TEXT NOT NULL DEFAULT 'consumable' CHECK (item_kind IN ('consumable', 'tool')),
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    serial_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
    asset_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_shipment_items_shipment ON public.consumables_tools_shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_ct_shipment_items_pn ON public.consumables_tools_shipment_items(part_number);

-- ----------------------------------------------------------------------------
-- 8. Row Level Security & Grants
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.consumables_tools_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.consumables_tools_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.consumables_tools_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.consumables_tools_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tool_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.consumables_tools_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.consumables_tools_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.consumables_tools_shipment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ct_catalog_select" ON public.consumables_tools_catalog;
DROP POLICY IF EXISTS "ct_catalog_write" ON public.consumables_tools_catalog;
CREATE POLICY "ct_catalog_select" ON public.consumables_tools_catalog FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ct_catalog_write" ON public.consumables_tools_catalog FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ct_orders_all" ON public.consumables_tools_orders;
CREATE POLICY "ct_orders_all" ON public.consumables_tools_orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ct_order_items_all" ON public.consumables_tools_order_items;
CREATE POLICY "ct_order_items_all" ON public.consumables_tools_order_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ct_stock_all" ON public.consumables_tools_stock;
CREATE POLICY "ct_stock_all" ON public.consumables_tools_stock FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ct_tool_assets_all" ON public.tool_assets;
CREATE POLICY "ct_tool_assets_all" ON public.tool_assets FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ct_movements_all" ON public.consumables_tools_movements;
CREATE POLICY "ct_movements_all" ON public.consumables_tools_movements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ct_shipments_all" ON public.consumables_tools_shipments;
CREATE POLICY "ct_shipments_all" ON public.consumables_tools_shipments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ct_shipment_items_all" ON public.consumables_tools_shipment_items;
CREATE POLICY "ct_shipment_items_all" ON public.consumables_tools_shipment_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT ALL ON TABLE public.consumables_tools_catalog TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.consumables_tools_orders TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.consumables_tools_order_items TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.consumables_tools_stock TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.tool_assets TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.consumables_tools_movements TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.consumables_tools_shipments TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.consumables_tools_shipment_items TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9. Enable Supabase Realtime Publication for Consumables & Tools Tables
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.consumables_tools_catalog;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.consumables_tools_orders;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.consumables_tools_order_items;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.consumables_tools_stock;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tool_assets;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.consumables_tools_movements;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.consumables_tools_shipments;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.consumables_tools_shipment_items;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
