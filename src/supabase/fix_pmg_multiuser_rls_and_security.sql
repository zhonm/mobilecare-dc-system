-- ============================================================================
-- MDC SYSTEM 2: PMG MULTI-USER ROLLOUT & ROW LEVEL SECURITY (RLS) HARDENING
-- Purpose: Remediate open RLS policies (§1.1, §3) and establish database-enforced
-- branch isolation and DC stock restriction for 40-50 Parts Management (PMG) users.
-- ============================================================================

-- 1. Ensure helper functions for current user role and site resolution
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.current_user_site_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT site_id FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;
GRANT EXECUTE ON FUNCTION public.current_user_site_id() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_central_dc_site(check_site_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT is_dc FROM public.sites WHERE id = check_site_id LIMIT 1), false);
$$;
GRANT EXECUTE ON FUNCTION public.is_central_dc_site(UUID) TO authenticated, anon;

-- 2. Drop all existing legacy / permissive policies across public schema
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT schemaname, tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
    END LOOP;
END $$;

-- 3. Ensure Row Level Security is active on all core tables
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_page_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.part_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.forecast_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.forecast_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.allocation_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.allocation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.repair_usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saved_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dc_intake_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parts_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. Revoke anonymous access from operational tables (Public anon key security defense)
-- Sensitive operational tables (serials, inventory parts, dispatches, DC intake) are revoked from anon
REVOKE ALL ON public.inventory_units FROM anon;
REVOKE ALL ON public.shipments FROM anon;
REVOKE ALL ON public.shipment_items FROM anon;
REVOKE ALL ON public.parts_requests FROM anon;
REVOKE ALL ON public.dc_intake_records FROM anon;
REVOKE ALL ON public.scan_logs FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.purchase_orders FROM anon;
REVOKE ALL ON public.po_items FROM anon;
REVOKE ALL ON public.repair_usage_records FROM anon;
REVOKE ALL ON public.forecast_cycles FROM anon;
REVOKE ALL ON public.forecast_entries FROM anon;
REVOKE ALL ON public.allocation_cycles FROM anon;
REVOKE ALL ON public.allocation_items FROM anon;

-- Grant authenticated standard permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- Profiles, user permissions, and saved_records must remain accessible to anon & authenticated
-- for unauthenticated login email verification, password provisioning, and registry sync.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_page_permissions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_records TO anon, authenticated;

-- 5. Reference Catalogs: Parts, Categories, Sites (Read-only for anon, manageable by Admin)
GRANT SELECT ON public.parts TO anon;
GRANT SELECT ON public.part_categories TO anon;
GRANT SELECT ON public.sites TO anon;

CREATE POLICY "parts_select_all" ON public.parts
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "parts_manage_admin" ON public.parts
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin'));

CREATE POLICY "part_categories_select_all" ON public.part_categories
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "part_categories_manage_admin" ON public.part_categories
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin'));

CREATE POLICY "sites_select_all" ON public.sites
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "sites_manage_admin" ON public.sites
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin'));

-- 6. Profiles & Page Permissions (Open to anon & authenticated for login verification, user setup, and permissions)
CREATE POLICY "profiles_all_access" ON public.profiles
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "user_page_permissions_all_access" ON public.user_page_permissions
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 7. Inventory Units (Strict Branch Isolation & DC Stock Restriction for PMG)
-- Superadmins and DC staff have full visibility.
-- PMG users can only SELECT rows at their own branch (excluding Central DC).
CREATE POLICY "inventory_units_select" ON public.inventory_units
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND current_site_id = public.current_user_site_id()
            AND NOT public.is_central_dc_site(current_site_id)
        )
    );

CREATE POLICY "inventory_units_insert" ON public.inventory_units
    FOR INSERT TO authenticated
    WITH CHECK (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND current_site_id = public.current_user_site_id()
            AND NOT public.is_central_dc_site(current_site_id)
        )
    );

CREATE POLICY "inventory_units_update" ON public.inventory_units
    FOR UPDATE TO authenticated
    USING (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND current_site_id = public.current_user_site_id()
            AND NOT public.is_central_dc_site(current_site_id)
        )
    )
    WITH CHECK (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND current_site_id = public.current_user_site_id()
            AND NOT public.is_central_dc_site(current_site_id)
        )
    );

CREATE POLICY "inventory_units_delete_admin_only" ON public.inventory_units
    FOR DELETE TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin'));

-- 8. Shipments & Shipment Items
-- DC staff can manage all outbound shipments.
-- PMG branch users can only view shipments destined for their branch site and confirm receipt.
CREATE POLICY "shipments_select" ON public.shipments
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff', 'management_viewer')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
        )
    );

CREATE POLICY "shipments_insert_dc_staff" ON public.shipments
    FOR INSERT TO authenticated
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'warehouse_staff', 'logistics_staff'));

CREATE POLICY "shipments_update" ON public.shipments
    FOR UPDATE TO authenticated
    USING (
        public.current_user_role() IN ('superadmin', 'admin', 'warehouse_staff', 'logistics_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
        )
    )
    WITH CHECK (
        public.current_user_role() IN ('superadmin', 'admin', 'warehouse_staff', 'logistics_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
        )
    );

CREATE POLICY "shipments_delete_admin_only" ON public.shipments
    FOR DELETE TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin'));

CREATE POLICY "shipment_items_select" ON public.shipment_items
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff', 'management_viewer')
        OR EXISTS (
            SELECT 1 FROM public.shipments s
            WHERE s.id = shipment_items.shipment_id
            AND s.site_id = public.current_user_site_id()
        )
    );

CREATE POLICY "shipment_items_insert_dc_staff" ON public.shipment_items
    FOR INSERT TO authenticated
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'warehouse_staff', 'logistics_staff'));

CREATE POLICY "shipment_items_update_dc_staff" ON public.shipment_items
    FOR UPDATE TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'warehouse_staff', 'logistics_staff'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'warehouse_staff', 'logistics_staff'));

CREATE POLICY "shipment_items_delete_admin_only" ON public.shipment_items
    FOR DELETE TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin'));

-- 9. Parts Requests
-- PMG branch users can view, create, and update requests for their own branch.
-- DC Fulfillment roles manage all requests across all branches.
CREATE POLICY "parts_requests_select" ON public.parts_requests
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
        )
    );

CREATE POLICY "parts_requests_insert" ON public.parts_requests
    FOR INSERT TO authenticated
    WITH CHECK (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
        )
    );

CREATE POLICY "parts_requests_update" ON public.parts_requests
    FOR UPDATE TO authenticated
    USING (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
        )
    )
    WITH CHECK (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
        )
    );

CREATE POLICY "parts_requests_delete" ON public.parts_requests
    FOR DELETE TO authenticated
    USING (
        public.current_user_role() IN ('superadmin', 'admin')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
            AND status = 'pending'
        )
    );

-- 10. DC Intake Records & Purchase Orders (DC-Only Operations)
-- PMG branch users have NO access to Central DC intake records or Apple GSX POs.
CREATE POLICY "dc_intake_records_select_dc" ON public.dc_intake_records
    FOR SELECT TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff'));

CREATE POLICY "dc_intake_records_manage_dc" ON public.dc_intake_records
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'warehouse_staff'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'warehouse_staff'));

CREATE POLICY "purchase_orders_select_dc" ON public.purchase_orders
    FOR SELECT TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff', 'user', 'management_viewer'));

CREATE POLICY "purchase_orders_manage_planner" ON public.purchase_orders
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'planner'));

CREATE POLICY "po_items_select_dc" ON public.po_items
    FOR SELECT TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff', 'user', 'management_viewer'));

CREATE POLICY "po_items_manage_planner" ON public.po_items
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'planner'));

-- 11. Saved Records (Master State Snapshots & Registries)
CREATE POLICY "saved_records_all_access" ON public.saved_records
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 12. Scan Logs & Audit Logs
CREATE POLICY "scan_logs_select" ON public.scan_logs
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
        )
    );

CREATE POLICY "scan_logs_insert" ON public.scan_logs
    FOR INSERT TO authenticated
    WITH CHECK (
        public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff')
        OR (
            public.current_user_role() = 'parts_management'
            AND site_id = public.current_user_site_id()
        )
    );

CREATE POLICY "audit_logs_select" ON public.audit_logs
    FOR SELECT TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin'));

CREATE POLICY "audit_logs_insert" ON public.audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "audit_logs_delete_superadmin_only" ON public.audit_logs
    FOR DELETE TO authenticated
    USING (public.current_user_role() = 'superadmin');

-- 13. Forecasting Cycles & Entries & Allocation Items
CREATE POLICY "forecast_cycles_select" ON public.forecast_cycles
    FOR SELECT TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'user', 'management_viewer'));

CREATE POLICY "forecast_cycles_manage" ON public.forecast_cycles
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'planner'));

CREATE POLICY "forecast_entries_select" ON public.forecast_entries
    FOR SELECT TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'user', 'management_viewer'));

CREATE POLICY "forecast_entries_manage" ON public.forecast_entries
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'planner'));

CREATE POLICY "allocation_cycles_select" ON public.allocation_cycles
    FOR SELECT TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'user', 'management_viewer'));

CREATE POLICY "allocation_cycles_manage" ON public.allocation_cycles
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'planner'));

CREATE POLICY "allocation_items_select" ON public.allocation_items
    FOR SELECT TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'user', 'management_viewer'));

CREATE POLICY "allocation_items_manage" ON public.allocation_items
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'planner'));

CREATE POLICY "repair_usage_records_select" ON public.repair_usage_records
    FOR SELECT TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner', 'warehouse_staff', 'user', 'management_viewer'));

CREATE POLICY "repair_usage_records_manage" ON public.repair_usage_records
    FOR ALL TO authenticated
    USING (public.current_user_role() IN ('superadmin', 'admin', 'planner'))
    WITH CHECK (public.current_user_role() IN ('superadmin', 'admin', 'planner'));
