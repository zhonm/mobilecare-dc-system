-- ============================================================================
-- MDC SYSTEM 2: Superadmin Users Provisioning & Permissions Setup (Fail-Safe)
-- ============================================================================

-- 1. Ensure Columns Exist on Profiles
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS has_set_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 2. Ensure Email has a Unique Constraint on Profiles
DO $$ BEGIN
    ALTER TABLE profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
EXCEPTION
    WHEN duplicate_table THEN null;
    WHEN duplicate_object THEN null;
END $$;

-- 3. Ensure user_page_permissions Table Exists with Unique Constraint
CREATE TABLE IF NOT EXISTS user_page_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    granted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    ALTER TABLE user_page_permissions ADD CONSTRAINT user_page_permissions_user_page_key UNIQUE (user_id, page_id);
EXCEPTION
    WHEN duplicate_table THEN null;
    WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_page_perm ON user_page_permissions(user_id, page_id);

-- Enable RLS on user_page_permissions
ALTER TABLE user_page_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Users read own permissions" ON user_page_permissions
        FOR SELECT TO authenticated USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY "Superadmins manage permissions" ON user_page_permissions
        FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 4. Superadmin Profiles (linked to auth.users)
-- PREREQUISITE: Create each user in Supabase Auth first:
--   Dashboard → Authentication → Users → Add user
-- profiles.id MUST equal auth.users.id (foreign key: profiles_id_fkey)

INSERT INTO profiles (id, email, full_name, role, has_set_password, is_active, created_at, updated_at)
SELECT u.id, u.email, 'Super Admin', 'superadmin', true, true, NOW(), NOW()
FROM auth.users u
WHERE u.email = 'superadmin@mobilecareph.com'
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    has_set_password = EXCLUDED.has_set_password,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

INSERT INTO profiles (id, email, full_name, role, has_set_password, is_active, created_at, updated_at)
SELECT u.id, u.email, 'System Admin', 'superadmin', true, true, NOW(), NOW()
FROM auth.users u
WHERE u.email = 'admin@mobilecareph.com'
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    has_set_password = EXCLUDED.has_set_password,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- 6. Grant Full Page Permissions for Both Superadmins
DO $$
DECLARE
    u_rec RECORD;
    all_pages TEXT[] := ARRAY[
        'dashboard',
        'import',
        'forecast',
        'orders',
        'scan-in',
        'allocation',
        'scan-out',
        'shipments',
        'audit',
        'settings',
        'user-access'
    ];
    pg TEXT;
BEGIN
    FOR u_rec IN SELECT id FROM profiles WHERE role = 'superadmin' LOOP
        FOREACH pg IN ARRAY all_pages LOOP
            INSERT INTO user_page_permissions (user_id, page_id)
            VALUES (u_rec.id, pg)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;
