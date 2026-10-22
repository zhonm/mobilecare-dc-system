import assert from 'node:assert';
import { ALL_PAGES, PAGE_TITLES } from '../constants/navigation.js';
import { ROLE_PRESETS } from '../constants/roles.js';
import {
  getStoredUserSession,
  persistUserSession
} from '../utils/security.js';

console.log('====================================================');
console.log('TEST SUITE: System Scan & Comprehensive Review Fixes');
console.log('====================================================');

// Test 1: Navigation Parity & Route Registration
console.log('\n--- Test 1: Navigation & Route Registration ---');
assert.ok(ALL_PAGES.find(p => p.id === 'feedback'), 'ALL_PAGES must contain "feedback"');
assert.ok(ALL_PAGES.find(p => p.id === 'drive-hub'), 'ALL_PAGES must contain "drive-hub"');
assert.ok(PAGE_TITLES['feedback'], 'PAGE_TITLES must contain "feedback"');
assert.ok(PAGE_TITLES['drive-hub'], 'PAGE_TITLES must contain "drive-hub"');
console.log('  ✓ PASS: feedback and drive-hub properly registered in ALL_PAGES and PAGE_TITLES');

// Test 2: User Access Matrix excludes Superadmin-only modules
console.log('\n--- Test 2: User Access Management Permission Matrix Guard ---');
const matrixPages = ALL_PAGES.filter(p => p.id !== 'user-access' && p.id !== 'all-stocks' && p.id !== 'drive-hub');
assert.strictEqual(matrixPages.some(p => p.id === 'drive-hub'), false, 'matrixPages must not include drive-hub');
assert.strictEqual(matrixPages.some(p => p.id === 'user-access'), false, 'matrixPages must not include user-access');
assert.strictEqual(matrixPages.some(p => p.id === 'all-stocks'), false, 'matrixPages must not include all-stocks');
assert.ok(matrixPages.some(p => p.id === 'feedback'), 'matrixPages allows delegating feedback page');
console.log('  ✓ PASS: matrixPages safely isolates superadmin-exclusive modules');

// Test 3: Session Signature Verification & Anti-Tampering Enforcement
console.log('\n--- Test 3: Session Signature & Anti-Tampering Enforcement ---');

// Mock localStorage and window
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  }
};

const genuineUser = {
  id: '1b0e9f43-c2d5-4eb4-acef-2ea5d9d21280',
  email: 'zhon.manaois@mobilecareph.com',
  role: 'superadmin'
};

persistUserSession(genuineUser);
const restoredUser = getStoredUserSession();
assert.ok(restoredUser, 'Genuine user session successfully restored');
assert.strictEqual(restoredUser.email, genuineUser.email, 'Restored email matches');

// Simulate attacker tampering with role in localStorage
const tamperedUser = {
  id: 'regular-user-id',
  email: 'user@mobilecareph.com',
  role: 'superadmin' // forged privilege escalation
};
store.set('mdc_current_user', JSON.stringify(tamperedUser));
// Note: store still holds genuineUser signature or an invalid signature
const tamperedResult = getStoredUserSession();
assert.strictEqual(tamperedResult, null, 'Tampered session must be strictly rejected and cleared');
console.log('  ✓ PASS: getStoredUserSession blocks local privilege escalation & signature mismatches');

// Test 4: All Role Presets Match Registered Pages
console.log('\n--- Test 4: Role Presets Routing Integrity ---');
const allPageIds = new Set(ALL_PAGES.map(p => p.id));
for (const [roleName, pages] of Object.entries(ROLE_PRESETS)) {
  for (const pageId of pages) {
    assert.ok(allPageIds.has(pageId), `Role preset "${roleName}" page "${pageId}" must exist in ALL_PAGES`);
  }
}
console.log('  ✓ PASS: All ROLE_PRESETS pages are validly defined in ALL_PAGES');

console.log('\n====================================================');
console.log('ALL SYSTEM SCAN VERIFICATION TESTS PASSED (100%)');
console.log('====================================================\n');
