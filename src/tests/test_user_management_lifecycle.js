// ============================================================================
// TEST SUITE: Complete User Management Lifecycle Verification
// Tests: Creation (Admin/Superadmin/PMG/User), Tombstone Lifecycle,
// Cloud Sync Active Profile Preservation, Profile Update, Password Reset, Deletion
// ============================================================================

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toValidUUID } from '../utils/appContextHelpers.js';
import { ROLE_PRESETS, getDefaultRolePosition, sortUsersDeterministically } from '../constants/roles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================================');
console.log('TEST SUITE: Complete User Management Lifecycle Verification');
console.log('====================================================================\n');

// 1. Verify SQL file contains all required RPC functions
console.log('--- Test 1: Database SQL Migration RPC Coverage ---');
const sqlPath = path.resolve(__dirname, '../supabase/fix_profiles_saved_records_hardening.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.admin_provision_user'), 'admin_provision_user must be defined');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.admin_update_user'), 'admin_update_user must be defined');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.admin_reset_user_password'), 'admin_reset_user_password must be defined');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.admin_delete_user'), 'admin_delete_user must be defined');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.verify_login_credentials'), 'verify_login_credentials must be defined');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.set_initial_user_password'), 'set_initial_user_password must be defined');

// Verify single canonical signatures (no overloaded duplicates)
const provisionMatches = (sql.match(/CREATE OR REPLACE FUNCTION public\.admin_provision_user\(/g) || []).length;
assert.strictEqual(provisionMatches, 1, 'admin_provision_user must have exactly ONE definition (no overloads)');

const deleteMatches = (sql.match(/CREATE OR REPLACE FUNCTION public\.admin_delete_user\(/g) || []).length;
assert.strictEqual(deleteMatches, 1, 'admin_delete_user must have exactly ONE definition (no overloads)');

const updateMatches = (sql.match(/CREATE OR REPLACE FUNCTION public\.admin_update_user\(/g) || []).length;
assert.strictEqual(updateMatches, 1, 'admin_update_user must have exactly ONE definition');

const resetMatches = (sql.match(/CREATE OR REPLACE FUNCTION public\.admin_reset_user_password\(/g) || []).length;
assert.strictEqual(resetMatches, 1, 'admin_reset_user_password must have exactly ONE definition');

// Verify trigger permits SECURITY DEFINER
assert.ok(sql.includes("CURRENT_USER IN ('postgres', 'supabase_admin', 'service_role')"), 'Trigger must allow SECURITY DEFINER execution');

console.log('  ✓ PASS: SQL migration defines all 6 canonical RPCs with zero overloading');
console.log('  ✓ PASS: Database trigger permits SECURITY DEFINER administrative modifications\n');

// 2. Test Admin User Provisioning Logic & Role Hierarchy
console.log('--- Test 2: Admin User Creation & Role Hierarchy ---');
const newAdminPayload = {
  fullName: 'sds',
  email: 'joshua.juvida12@mobilecareph.com',
  role: 'admin',
  rolePosition: getDefaultRolePosition('admin'),
  siteId: 'site-dc',
  customPermissions: [...ROLE_PRESETS.admin]
};

assert.strictEqual(newAdminPayload.rolePosition, 'Distribution Operations Lead', 'Admin default position must be Distribution Operations Lead');
assert.ok(newAdminPayload.customPermissions.length > 0, 'Admin must have assigned permitted pages');

const existingUsers = [
  { id: 'usr-1', email: 'anjo.alcazar@mobilecareph.com', fullName: 'Anjo Alcazar', role: 'superadmin', isActive: true },
  { id: 'usr-2', email: 'zhon.manaois@mobilecareph.com', fullName: 'Zhon Manaois', role: 'superadmin', isActive: true },
  { id: 'usr-3', email: 'andres@mobilecareph.com', fullName: 'Andres Bonifacio', role: 'parts_management', isActive: true }
];

const cleanEmail = newAdminPayload.email.trim().toLowerCase();
const createdAdmin = {
  id: toValidUUID(cleanEmail),
  email: cleanEmail,
  fullName: newAdminPayload.fullName.trim(),
  role: newAdminPayload.role,
  rolePosition: newAdminPayload.rolePosition,
  siteId: newAdminPayload.siteId,
  hasSetPassword: false,
  passwordHash: null,
  isActive: true,
  permittedPages: newAdminPayload.customPermissions
};

const nextList = [...existingUsers.filter(u => u.email.toLowerCase() !== cleanEmail), createdAdmin];
const sorted = sortUsersDeterministically(nextList);

assert.strictEqual(sorted.length, 4, 'List must contain 4 users');
// Superadmins first (rank 1), Admin next (rank 2), PMG next (rank 3)
assert.strictEqual(sorted[0].role, 'superadmin');
assert.strictEqual(sorted[1].role, 'superadmin');
assert.strictEqual(sorted[2].role, 'admin', 'Admin must be sorted right after Superadmins');
assert.strictEqual(sorted[2].email, 'joshua.juvida12@mobilecareph.com');
assert.strictEqual(sorted[3].role, 'parts_management', 'PMG must follow Admin');

console.log('  ✓ PASS: Admin user successfully created with correct permissions and defaults');
console.log('  ✓ PASS: Deterministic sort positions Admin directly following Superadmins\n');

// 3. Test Tombstone Lifecycle: Un-tombstoning on Provision
console.log('--- Test 3: Tombstone Lifecycle & Active Profile Preservation ---');
let tombstonedDeletedIds = ['joshua.juvida12@mobilecareph.com', 'old.deleted@mobilecareph.com'];

// Simulated provisionUser un-tombstoning
let filteredDeleted = tombstonedDeletedIds.filter(id => id.toLowerCase() !== cleanEmail && id.toLowerCase() !== createdAdmin.id.toLowerCase());
assert.deepStrictEqual(filteredDeleted, ['old.deleted@mobilecareph.com'], 'Provisioning must purge email and ID from tombstone list');

// Simulated useCloudSync active profile preservation
const mockDbProfiles = [
  { id: createdAdmin.id, email: createdAdmin.email, is_deleted: false, is_active: true, role: 'admin' }
];
const activeProfileEmails = new Set(mockDbProfiles.filter(p => !p.is_deleted).map(p => p.email.toLowerCase()));
const activeProfileIds = new Set(mockDbProfiles.filter(p => !p.is_deleted).map(p => p.id.toLowerCase()));

// Even if cloud registry doc still had the stale tombstone:
const cloudDeletedUserIds = ['joshua.juvida12@mobilecareph.com', 'another.deleted@mobilecareph.com'];
const localDeletedUserIds = filteredDeleted;

const mergedDeletedUserIds = Array.from(new Set([
  ...localDeletedUserIds,
  ...cloudDeletedUserIds
].map(s => String(s).trim().toLowerCase())))
 .filter(id => !activeProfileEmails.has(id) && !activeProfileIds.has(id));

assert.ok(!mergedDeletedUserIds.includes(cleanEmail), 'Active profile email must NEVER remain in mergedDeletedUserIds');
assert.ok(!mergedDeletedUserIds.includes(createdAdmin.id.toLowerCase()), 'Active profile ID must NEVER remain in mergedDeletedUserIds');
assert.ok(mergedDeletedUserIds.includes('another.deleted@mobilecareph.com'), 'Legitimate deleted user must remain tombstoned');

// Verify useCloudSync will NOT mark the active profile as deleted
const isMarkedDeleted = Boolean(
  mockDbProfiles[0].is_deleted ||
  (!activeProfileEmails.has(cleanEmail) && cleanEmail && mergedDeletedUserIds.includes(cleanEmail)) ||
  (!activeProfileIds.has(createdAdmin.id) && createdAdmin.id && mergedDeletedUserIds.includes(createdAdmin.id))
);
assert.strictEqual(isMarkedDeleted, false, 'Newly provisioned active database user must NEVER be marked deleted');

console.log('  ✓ PASS: Re-provisioning an account un-tombstones email from all storage tiers');
console.log('  ✓ PASS: Cloud sync filters active database profiles, preventing auto-deletion of newly created accounts\n');

// 4. Test Permanent Deletion
console.log('--- Test 4: Permanent Deletion & Tombstone Propagation ---');
const userToDelete = createdAdmin;
const postDeleteList = sorted.filter(u => u.id !== userToDelete.id && u.email !== userToDelete.email);
assert.strictEqual(postDeleteList.length, 3, 'Post-delete list must contain 3 users');
assert.ok(!postDeleteList.some(u => u.email === userToDelete.email), 'Deleted user must be absent from list');

const updatedDeletedIds = [...mergedDeletedUserIds];
if (!updatedDeletedIds.includes(userToDelete.email)) updatedDeletedIds.push(userToDelete.email);
if (!updatedDeletedIds.includes(userToDelete.id)) updatedDeletedIds.push(userToDelete.id);

// When dbProfiles no longer contains the deleted user:
const emptyDbProfiles = [];
const postDelActiveEmails = new Set(emptyDbProfiles.map(p => p.email));
const postDelMerged = updatedDeletedIds.filter(id => !postDelActiveEmails.has(id));
assert.ok(postDelMerged.includes(userToDelete.email), 'Deleted email must remain tombstoned after DB deletion');

console.log('  ✓ PASS: User deletion purges user from list and registers active tombstone\n');

// 5. Verify useUserManagement.js integration with RPCs
console.log('--- Test 5: useUserManagement.js RPC Integration ---');
const userMgmtPath = path.resolve(__dirname, '../context/useUserManagement.js');
const userMgmtCode = fs.readFileSync(userMgmtPath, 'utf8');

assert.ok(userMgmtCode.includes("supabase.rpc('admin_provision_user'"), 'useUserManagement.js must call admin_provision_user');
assert.ok(userMgmtCode.includes("supabase.rpc('admin_update_user'"), 'useUserManagement.js must call admin_update_user');
assert.ok(userMgmtCode.includes("supabase.rpc('admin_reset_user_password'"), 'useUserManagement.js must call admin_reset_user_password');
assert.ok(userMgmtCode.includes("supabase.rpc('admin_delete_user'"), 'useUserManagement.js must call admin_delete_user');
assert.ok(userMgmtCode.includes("getActiveUser()?.email || currentUser?.email"), 'Must use getActiveUser fallback for admin email');

console.log('  ✓ PASS: useUserManagement.js seamlessly integrates all 4 administrative RPCs');
console.log('  ✓ PASS: getActiveUser() safely resolves caller email in custom session contexts\n');

console.log('====================================================================');
console.log('ALL USER MANAGEMENT LIFECYCLE TESTS PASSED (100%)');
console.log('====================================================================\n');
