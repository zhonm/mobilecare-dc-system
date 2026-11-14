-- ============================================================================
-- Rollback Script: Consumables & Tools Module + GSX Metadata Extensions
-- Safely removes only the objects added by consumables_tools_and_gsx_migration.sql.
-- Does NOT touch existing parts rows, inventory_units, purchase_orders, or po_items.
-- ============================================================================

DROP TABLE IF EXISTS public.consumables_tools_shipment_items CASCADE;
DROP TABLE IF EXISTS public.consumables_tools_shipments CASCADE;
DROP TABLE IF EXISTS public.consumables_tools_movements CASCADE;
DROP TABLE IF EXISTS public.tool_assets CASCADE;
DROP TABLE IF EXISTS public.consumables_tools_stock CASCADE;
DROP TABLE IF EXISTS public.consumables_tools_order_items CASCADE;
DROP TABLE IF EXISTS public.consumables_tools_orders CASCADE;
DROP TABLE IF EXISTS public.consumables_tools_catalog CASCADE;

DROP INDEX IF EXISTS public.idx_parts_gsx_current;
DROP INDEX IF EXISTS public.idx_parts_part_type;

ALTER TABLE public.parts DROP COLUMN IF EXISTS part_type;
ALTER TABLE public.parts DROP COLUMN IF EXISTS component_group;
ALTER TABLE public.parts DROP COLUMN IF EXISTS serialized_module;
ALTER TABLE public.parts DROP COLUMN IF EXISTS substitute_part;
ALTER TABLE public.parts DROP COLUMN IF EXISTS secondary_part;
ALTER TABLE public.parts DROP COLUMN IF EXISTS exchange_price;
ALTER TABLE public.parts DROP COLUMN IF EXISTS compatible_models;
ALTER TABLE public.parts DROP COLUMN IF EXISTS is_gsx_current;
ALTER TABLE public.parts DROP COLUMN IF EXISTS gsx_source;
