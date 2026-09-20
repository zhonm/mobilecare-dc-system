import assert from 'assert';
import { INITIAL_USERS, sortUsersDeterministically, ROLE_PRESETS } from '../constants/roles.js';

console.log('--- Running Test: User Access Management Visibility ---');

// Test 1: Verify INITIAL_USERS contains all 6 registered staff accounts
assert.strictEqual(INITIAL_USERS.length, 6, 'INITIAL_USERS should contain exactly 6 registered staff accounts');
const initialEmails = INITIAL_USERS.map(u => u.email.toLowerCase());
assert(initialEmails.includes('zhon.manaois@mobilecareph.com'), 'Zhon Manaois must be in INITIAL_USERS');
assert(initialEmails.includes('joshua.juvida@mobilecareph.com'), 'Joshua Juvida must be in INITIAL_USERS');
assert(initialEmails.includes('anjo.alcazar@mobilecareph.com'), 'Anjo Alcazar must be in INITIAL_USERS');
assert(initialEmails.includes('daphneclaire.bascuguin@mobilecareph.com'), 'Daphne Bascuguin must be in INITIAL_USERS');
assert(initialEmails.includes('andres@mobilecareph.com'), 'Andres Bonifacio must be in INITIAL_USERS');
assert(initialEmails.includes('joserizal@mobilecareph.com'), 'Jose Rizal must be in INITIAL_USERS');
console.log('✓ Test 1 Passed: INITIAL_USERS contains all 6 registered staff accounts');

// Test 2: Verify hydration resolution with empty dbProfiles (simulating anon RLS block)
function simulateHydration(currentUser, dbProfiles, prevList = []) {
  const profileMap = new Map();
  const mergedDeletedUserIds = [];

  // 1. Overlay dbProfiles
  (dbProfiles || []).forEach(p => {
    profileMap.set(p.email.toLowerCase(), p);
  });

  // 2. Overlay prev
  (prevList || []).forEach(u => {
    const existing = profileMap.get(u.email.toLowerCase()) || {};
    profileMap.set(u.email.toLowerCase(), { ...existing, ...u });
  });

  // 3. Overlay INITIAL_USERS
  INITIAL_USERS.forEach(u => {
    const existing = profileMap.get(u.email.toLowerCase()) || {};
    profileMap.set(u.email.toLowerCase(), { ...u, ...existing });
  });

  // 4. Overlay currentUser
  if (currentUser && currentUser.email) {
    const existing = profileMap.get(currentUser.email.toLowerCase()) || {};
    profileMap.set(currentUser.email.toLowerCase(), { ...existing, ...currentUser });
  }

  return sortUsersDeterministically(Array.from(profileMap.values()));
}

// Case A: Joshua Juvida is current logged-in user, dbProfiles is empty []
const joshuaUser = INITIAL_USERS.find(u => u.email === 'joshua.juvida@mobilecareph.com');
const resultA = simulateHydration(joshuaUser, []);
assert.strictEqual(resultA.length, 6, 'All 6 users must be present even when dbProfiles is empty');
assert.strictEqual(resultA[0].role, 'superadmin', 'Superadmin must be sorted first');
console.log('✓ Test 2 Passed: Joshua Juvida session preserves all 6 staff accounts');

// Case B: Zhon Manaois is current logged-in user, dbProfiles is empty []
const zhonUser = INITIAL_USERS.find(u => u.email === 'zhon.manaois@mobilecareph.com');
const resultB = simulateHydration(zhonUser, []);
assert.strictEqual(resultB.length, 6, 'All 6 users must be present even when dbProfiles is empty');
console.log('✓ Test 3 Passed: Zhon Manaois session preserves all 6 staff accounts');

// Test 4: Role Hierarchy and deterministic sorting
const rolesInOrder = resultA.map(u => u.role);
assert.strictEqual(rolesInOrder[0], 'superadmin');
assert.strictEqual(rolesInOrder[1], 'superadmin');
assert.strictEqual(rolesInOrder[2], 'superadmin');
assert.strictEqual(rolesInOrder[3], 'superadmin');
assert.strictEqual(rolesInOrder[4], 'parts_management');
assert.strictEqual(rolesInOrder[5], 'parts_management');
console.log('✓ Test 4 Passed: Role hierarchy sorting (4 Superadmins, 2 PMG Specialists) strictly preserved');

console.log('All User Access Management Visibility tests passed successfully!');
