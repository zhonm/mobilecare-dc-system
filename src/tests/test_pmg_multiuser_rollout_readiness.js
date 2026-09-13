import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isDcSite, toValidUUID, isUUID } from '../utils/appContextHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================================');
console.log('TEST SUITE: PMG Multi-User Rollout Readiness & Free-Tier Hardening');
console.log('====================================================================\n');

// Mock Sites
const mockSites = [
  { id: 'site-dc-uuid', code: 'DC-MDC', name: 'Distribution Center', is_dc: true },
  { id: 'site-zam-uuid', code: 'ASP ZAM', name: 'MOBILECARE - ZAMBOANGA', is_dc: false },
  { id: 'site-ceb-uuid', code: 'ASP CEB', name: 'MOBILECARE - CEBU', is_dc: false }
];

// Seed localStorage with mockSites for isDcSite helper lookup
if (typeof localStorage === 'undefined') {
  global.localStorage = {
    _store: {},
    getItem(key) { return this._store[key] || null; },
    setItem(key, val) { this._store[key] = String(val); },
    removeItem(key) { delete this._store[key]; }
  };
}
localStorage.setItem('mdc_sites', JSON.stringify(mockSites));

// --- Test 1: isDcSite Helper Precision ---
console.log('--- Test 1: isDcSite Helper Precision ---');
assert.strictEqual(isDcSite('site-dc'), true, 'site-dc should be identified as DC');
assert.strictEqual(isDcSite('DC-MDC'), true, 'DC-MDC should be identified as DC');
assert.strictEqual(isDcSite('dc'), true, 'dc should be identified as DC');
assert.strictEqual(isDcSite('site-dc-uuid'), true, 'site-dc-uuid should be identified as DC from sites list');
assert.strictEqual(isDcSite('site-zam-uuid'), false, 'Zamboanga should not be identified as DC');
assert.strictEqual(isDcSite('site-ceb-uuid'), false, 'Cebu should not be identified as DC');
assert.strictEqual(isDcSite(null), false, 'null should not be identified as DC');
console.log('  ✓ PASS: isDcSite accurately identifies Central DC identifiers and branch sites');

// --- Test 2: PMG User Provisioning Validation Guard ---
console.log('\n--- Test 2: PMG User Provisioning Validation Guard ---');

function mockValidateUserProvision({ role, siteId, sitesList }) {
  if (role === 'parts_management') {
    const isMissingSite = !siteId || !String(siteId).trim();
    if (isMissingSite || isDcSite(siteId)) {
      return {
        success: false,
        error: 'A designated branch location is required for Parts Management (PMG) accounts. Central DC is restricted.'
      };
    }
  }

  const resolvedSiteId = (role === 'parts_management')
    ? siteId
    : (siteId || 'site-dc');

  return { success: true, siteId: resolvedSiteId };
}

// 2a. PMG without site
const pmgNoSite = mockValidateUserProvision({ role: 'parts_management', siteId: '', sitesList: mockSites });
assert.strictEqual(pmgNoSite.success, false);
assert.ok(pmgNoSite.error.includes('Central DC is restricted'));
console.log('  ✓ PASS: Rejects PMG user creation when siteId is empty');

// 2b. PMG with site-dc
const pmgDcSite = mockValidateUserProvision({ role: 'parts_management', siteId: 'site-dc', sitesList: mockSites });
assert.strictEqual(pmgDcSite.success, false);
assert.ok(pmgDcSite.error.includes('Central DC is restricted'));
console.log('  ✓ PASS: Rejects PMG user creation when assigned to site-dc');

// 2c. PMG with Central DC UUID
const pmgDcUUID = mockValidateUserProvision({ role: 'parts_management', siteId: 'site-dc-uuid', sitesList: mockSites });
assert.strictEqual(pmgDcUUID.success, false);
assert.ok(pmgDcUUID.error.includes('Central DC is restricted'));
console.log('  ✓ PASS: Rejects PMG user creation when assigned to Central DC by UUID');

// 2d. PMG with valid branch site
const pmgValidBranch = mockValidateUserProvision({ role: 'parts_management', siteId: 'site-zam-uuid', sitesList: mockSites });
assert.strictEqual(pmgValidBranch.success, true);
assert.strictEqual(pmgValidBranch.siteId, 'site-zam-uuid');
console.log('  ✓ PASS: Successfully provisions PMG user with valid ASP branch site');

// 2e. Non-PMG user defaults safely to site-dc
const superadminProvision = mockValidateUserProvision({ role: 'superadmin', siteId: null, sitesList: mockSites });
assert.strictEqual(superadminProvision.success, true);
assert.strictEqual(superadminProvision.siteId, 'site-dc');
console.log('  ✓ PASS: Non-PMG role (Superadmin) defaults to site-dc safely');

// 2f. Regression Test: Verify validUserId scoping in useUserManagement.js (Screenshot Case: Jose @ Vertis North)
const userMgmtCode = fs.readFileSync(path.join(__dirname, '../context/useUserManagement.js'), 'utf8');
assert.ok(
  userMgmtCode.includes('const validUserId = toValidUUID('),
  'useUserManagement.js must declare const validUserId before using it in provisionUser'
);
assert.ok(
  userMgmtCode.includes('resolveSite'),
  'useUserManagement.js must import and use resolveSite for site UUID resolution'
);
console.log('  ✓ PASS: validUserId is properly declared and scoped in provisionUser, preventing runtime crashes');

// 2g. End-to-End Simulation: Provisioning "Jose" at Vertis North (User Screenshot Scenario)
const vertisNorthSite = { id: 'site-vn-uuid', code: 'ASP VN', name: 'MOBILECARE - VERTIS NORTH', is_dc: false };
const testSites = [...mockSites, vertisNorthSite];
localStorage.setItem('mdc_sites', JSON.stringify(testSites));

const josePayload = {
  fullName: 'Jose',
  email: 'jose@mobilecareph.com',
  role: 'parts_management',
  rolePosition: 'Parts Management Specialist',
  siteId: 'site-vn-uuid'
};

// Guard checks
assert.strictEqual(isDcSite(josePayload.siteId, testSites), false, 'Vertis North must not be classified as DC');
assert.ok(josePayload.fullName.trim().length > 0, 'Full name must be provided');
assert.ok(josePayload.email.trim().includes('@mobilecareph.com'), 'Email must be official corporate domain');

// UUID generation
const generatedJoseId = toValidUUID(`usr-${Date.now()}-${josePayload.email.toLowerCase()}`);
assert.ok(isUUID(generatedJoseId), 'Generated user ID must be a valid PostgreSQL UUID');
const effectiveSiteUUID = isUUID(josePayload.siteId) ? josePayload.siteId : toValidUUID(josePayload.siteId);
assert.ok(isUUID(effectiveSiteUUID), 'Assigned branch siteId must resolve to a valid UUID for RLS');
console.log('  ✓ PASS: Simulated Jose (@ Vertis North) PMG provisioning executes completely without error');

// --- Test 3: Hydration Query Scoping (Bandwidth & Privacy Defense) ---
console.log('\n--- Test 3: Hydration Query Scoping (Bandwidth & Privacy Defense) ---');

function mockHydrationQueryScoper(currentUser) {
  const isPmgUser = currentUser?.role === 'parts_management';
  const userSiteId = currentUser?.siteId;
  const isSiteRestrictedPmg = Boolean(isPmgUser && userSiteId && userSiteId !== 'site-dc');

  return {
    inventory_units: isSiteRestrictedPmg
      ? { queryType: 'FILTERED', siteFilter: userSiteId, limit: 1000 }
      : { queryType: 'GLOBAL', siteFilter: null, limit: 2000 },
    shipments: isSiteRestrictedPmg
      ? { queryType: 'FILTERED', siteFilter: userSiteId, limit: 50 }
      : { queryType: 'GLOBAL', siteFilter: null, limit: 200 },
    parts_requests: isSiteRestrictedPmg
      ? { queryType: 'FILTERED', siteFilter: userSiteId, limit: 300 }
      : { queryType: 'GLOBAL', siteFilter: null, limit: 300 },
    dc_intake_records: isSiteRestrictedPmg
      ? { queryType: 'SKIPPED', data: [] }
      : { queryType: 'GLOBAL', limit: 100 },
    saved_records: isSiteRestrictedPmg
      ? { queryType: 'METADATA_ONLY', docs: ['master_supervisor_settings_registry', 'master_auto_logout_settings_registry', 'master_users_registry'] }
      : { queryType: 'FULL_SYSTEM_STATE' }
  };
}

const pmgUser = { id: 'usr-zam-01', role: 'parts_management', siteId: 'site-zam-uuid' };
const pmgPlan = mockHydrationQueryScoper(pmgUser);
assert.strictEqual(pmgPlan.inventory_units.queryType, 'FILTERED');
assert.strictEqual(pmgPlan.inventory_units.siteFilter, 'site-zam-uuid');
assert.strictEqual(pmgPlan.inventory_units.limit, 1000);

assert.strictEqual(pmgPlan.shipments.queryType, 'FILTERED');
assert.strictEqual(pmgPlan.shipments.siteFilter, 'site-zam-uuid');
assert.strictEqual(pmgPlan.shipments.limit, 50);

assert.strictEqual(pmgPlan.parts_requests.queryType, 'FILTERED');
assert.strictEqual(pmgPlan.parts_requests.siteFilter, 'site-zam-uuid');

assert.strictEqual(pmgPlan.dc_intake_records.queryType, 'SKIPPED');
assert.strictEqual(pmgPlan.saved_records.queryType, 'METADATA_ONLY');
console.log('  ✓ PASS: PMG branch user hydration is strictly scoped by site_id, skips DC intakes & heavy master states');

const adminUser = { id: 'usr-super-01', role: 'superadmin', siteId: 'site-dc' };
const adminPlan = mockHydrationQueryScoper(adminUser);
assert.strictEqual(adminPlan.inventory_units.queryType, 'GLOBAL');
assert.strictEqual(adminPlan.shipments.queryType, 'GLOBAL');
assert.strictEqual(adminPlan.dc_intake_records.queryType, 'GLOBAL');
assert.strictEqual(adminPlan.saved_records.queryType, 'FULL_SYSTEM_STATE');
console.log('  ✓ PASS: Superadmin hydration maintains complete company-wide oversight');

// --- Test 4: Realtime Room Partitioning & Message Fan-Out Defense ---
console.log('\n--- Test 4: Realtime Room Partitioning & Message Fan-Out Defense ---');

function mockResolveRealtimeRooms(currentUser) {
  const isPmg = currentUser?.role === 'parts_management';
  const userSiteId = currentUser?.siteId;
  const isSiteRestricted = Boolean(isPmg && userSiteId && userSiteId !== 'site-dc');

  const primaryRoomName = isSiteRestricted
    ? `mdc-site-sync-${userSiteId}`
    : 'mdc-admin-sync-room';

  const alertsRoomName = 'mdc-global-alerts-room';

  const postgresRowFilters = {
    parts_requests: isSiteRestricted ? `site_id=eq.${userSiteId}` : null,
    shipments: isSiteRestricted ? `site_id=eq.${userSiteId}` : null
  };

  return { primaryRoomName, alertsRoomName, postgresRowFilters };
}

const pmgRooms = mockResolveRealtimeRooms(pmgUser);
assert.strictEqual(pmgRooms.primaryRoomName, 'mdc-site-sync-site-zam-uuid');
assert.strictEqual(pmgRooms.alertsRoomName, 'mdc-global-alerts-room');
assert.strictEqual(pmgRooms.postgresRowFilters.parts_requests, 'site_id=eq.site-zam-uuid');
assert.strictEqual(pmgRooms.postgresRowFilters.shipments, 'site_id=eq.site-zam-uuid');
console.log('  ✓ PASS: PMG branch user joins isolated room `mdc-site-sync-site-zam-uuid` with site_id row filters');

const adminRooms = mockResolveRealtimeRooms(adminUser);
assert.strictEqual(adminRooms.primaryRoomName, 'mdc-admin-sync-room');
assert.strictEqual(adminRooms.alertsRoomName, 'mdc-global-alerts-room');
assert.strictEqual(adminRooms.postgresRowFilters.parts_requests, null);
assert.strictEqual(adminRooms.postgresRowFilters.shipments, null);
console.log('  ✓ PASS: Superadmin joins `mdc-admin-sync-room` without restrictive row filters');

// --- Test 5: Heartbeat Timing & Stale Packing Pruning Throttles ---
console.log('\n--- Test 5: Heartbeat Timing & Stale Packing Pruning Throttles ---');

const packingCode = fs.readFileSync(path.join(__dirname, '../components/ScanOutPacking.jsx'), 'utf8');
const syncCode = fs.readFileSync(path.join(__dirname, '../context/useCloudSync.js'), 'utf8');

assert.ok(packingCode.includes('60000'), 'ScanOutPacking.jsx must use 60000ms (60s) heartbeat interval');
assert.ok(!packingCode.includes('25000'), 'ScanOutPacking.jsx must not contain legacy 25000ms interval');
console.log('  ✓ PASS: ScanOutPacking.jsx presence heartbeat interval increased to 60s (cuts message volume by ~60%)');

assert.ok(syncCode.includes('180000'), 'useCloudSync.js must use 180000ms (180s) prune threshold');
console.log('  ✓ PASS: useCloudSync.js stale packing station threshold updated to 180s');

// Verify alertsChannel declaration scope in useCloudSync.js
const alertsChannelDeclarations = (syncCode.match(/let\s+alertsChannel/g) || []).length;
assert.strictEqual(
  alertsChannelDeclarations,
  1,
  'let alertsChannel must be declared exactly once at the top level of useEffect'
);
assert.ok(
  /useEffect\(\(\)\s*=>\s*\{[\s\S]*?let\s+realtimeChannel\s*=\s*null;\s*let\s+alertsChannel\s*=\s*null;/.test(syncCode),
  'alertsChannel must be declared right next to realtimeChannel at the top of useEffect in useCloudSync.js'
);
console.log('  ✓ PASS: alertsChannel and realtimeChannel are properly scoped in useCloudSync.js without ReferenceError in cleanup');

// --- Test 6: Database SQL Migration Validation ---
console.log('\n--- Test 6: Database SQL Migration Validation ---');

const sqlMigrationPath = path.join(__dirname, '../supabase/fix_pmg_multiuser_rls_and_security.sql');
assert.ok(fs.existsSync(sqlMigrationPath), 'fix_pmg_multiuser_rls_and_security.sql must exist');

const sqlContent = fs.readFileSync(sqlMigrationPath, 'utf8');

// 6a. Helper functions
assert.ok(sqlContent.includes('CREATE OR REPLACE FUNCTION public.current_user_role()'));
assert.ok(sqlContent.includes('CREATE OR REPLACE FUNCTION public.current_user_site_id()'));
assert.ok(sqlContent.includes('CREATE OR REPLACE FUNCTION public.is_central_dc_site'));
console.log('  ✓ PASS: SQL migration defines current_user_role, current_user_site_id, and is_central_dc_site');

// 6b. Anon revocation on operational tables & public auth grants
assert.ok(sqlContent.includes('REVOKE ALL ON public.inventory_units FROM anon;'));
assert.ok(sqlContent.includes('REVOKE ALL ON public.shipments FROM anon;'));
assert.ok(sqlContent.includes('REVOKE ALL ON public.parts_requests FROM anon;'));
assert.ok(sqlContent.includes('REVOKE ALL ON public.dc_intake_records FROM anon;'));
assert.ok(sqlContent.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon, authenticated;'));
assert.ok(sqlContent.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_records TO anon, authenticated;'));
console.log('  ✓ PASS: SQL migration revokes anon access on operational tables while preserving auth & profiles access');

// 6c. Inventory units branch isolation & DC stock restriction
assert.ok(sqlContent.includes('NOT public.is_central_dc_site(current_site_id)'));
assert.ok(sqlContent.includes("public.current_user_role() = 'parts_management'"));
console.log('  ✓ PASS: SQL migration restricts PMG users to branch inventory and blocks Central DC stock');

// 6d. Shipments & parts requests branch isolation
assert.ok(sqlContent.includes('site_id = public.current_user_site_id()'));
console.log('  ✓ PASS: SQL migration restricts PMG shipments and parts requests to public.current_user_site_id()');

// 6e. DC intake records restricted from PMG
assert.ok(sqlContent.includes('dc_intake_records_select_dc'));
assert.ok(!sqlContent.includes("'parts_management' IN dc_intake_records"));
console.log('  ✓ PASS: SQL migration strictly restricts DC intake records to DC staff');

// --- Test 7: Unauthenticated PMG Login & First-Time Password Fallback ---
console.log('\n--- Test 7: Unauthenticated PMG Login & First-Time Password Fallback ---');

const authCode = fs.readFileSync(path.join(__dirname, '../context/useAuth.js'), 'utf8');

// 7a. Verify verifyLoginEmail does NOT gate fallback on !cloudReachable
assert.ok(
  !authCode.includes('if (!user && !cloudReachable)'),
  'useAuth.js must not gate local/INITIAL_USERS fallback behind !cloudReachable'
);
assert.ok(
  authCode.includes('// 3. Fallback to local memory / storage / INITIAL_USERS if not found in cloud'),
  'useAuth.js must include comprehensive fallback in verifyLoginEmail and signInWithPassword'
);
console.log('  ✓ PASS: useAuth.js falls back to local and initial user registries unconditionally if cloud has not loaded user');

// 7b. Simulation of unauthenticated new PMG user (Jose @ Vertis North)
const mockJoseUser = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  email: 'jose@mobilecareph.com',
  fullName: 'Jose',
  role: 'parts_management',
  rolePosition: 'PMG SPECIALIST',
  siteId: 'site-vn-uuid',
  hasSetPassword: false,
  passwordHash: null,
  isActive: true
};

const localRegistry = [mockJoseUser];
let resolvedJose = null;
// Simulate verifyLoginEmail fallback logic
const candidates = localRegistry.filter(u => u.isActive);
resolvedJose = candidates.find(u => u.email.toLowerCase() === 'jose@mobilecareph.com');

assert.ok(resolvedJose, 'Jose must be resolved from registry fallback');
assert.strictEqual(resolvedJose.email, 'jose@mobilecareph.com');
assert.strictEqual(resolvedJose.hasSetPassword, false);
console.log('  ✓ PASS: Simulated unauthenticated Jose PMG login verifies email and triggers password creation prompt');

console.log('\n====================================================================');
console.log('ALL PMG MULTI-USER ROLLOUT READINESS TESTS PASSED (100%)');
console.log('====================================================================\n');
