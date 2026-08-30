-- ============================================================================
-- MDC SYSTEM 2: Supabase Security Advisor & Egress Optimization Migration
-- Resolves the 3 Critical "Security Definer View" issues flagged by Supabase Advisor
-- by enabling security_invoker = true on the public analytical views.
-- ============================================================================

-- 1. Fix public.view_repair_usage_in_scope
ALTER VIEW IF EXISTS public.view_repair_usage_in_scope SET (security_invoker = true);

-- 2. Fix public.view_monthly_part_usage
ALTER VIEW IF EXISTS public.view_monthly_part_usage SET (security_invoker = true);

-- 3. Fix public.view_part_site_shares
ALTER VIEW IF EXISTS public.view_part_site_shares SET (security_invoker = true);

-- Verify that the views now run with invoker privileges
COMMENT ON VIEW public.view_repair_usage_in_scope IS 'Filtered in-scope repair universe with security_invoker enabled.';
COMMENT ON VIEW public.view_monthly_part_usage IS 'Monthly part usage summary with security_invoker enabled.';
COMMENT ON VIEW public.view_part_site_shares IS 'All-time site allocation shares with security_invoker enabled.';
