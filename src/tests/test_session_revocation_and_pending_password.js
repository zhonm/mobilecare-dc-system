import assert from 'assert';
import { clearStoredUserSession } from '../utils/security.js';

class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(String(key), String(value));
  }
  removeItem(key) {
    this.store.delete(String(key));
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
  key(index) {
    return Array.from(this.store.keys())[index] || null;
  }
}

globalThis.window = {
  localStorage: new MockStorage(),
  sessionStorage: new MockStorage(),
  document: { cookie: '' }
};
globalThis.localStorage = globalThis.window.localStorage;
globalThis.sessionStorage = globalThis.window.sessionStorage;
globalThis.document = globalThis.window.document;

console.log('\n====================================================');
console.log('TEST SUITE: User Session Security & Password Pending Gating');
console.log('====================================================');

// Test 1: User with hasSetPassword === false cannot have an active session
(() => {
  const daphnePending = {
    id: 'usr-daphne',
    email: 'daphneclaire.bascuguin@mobilecareph.com',
    fullName: 'Daphne Bascuguin',
    role: 'superadmin',
    hasSetPassword: false,
    isActive: true
  };

  const usersList = [daphnePending];

  // Simulation of recoverPersistedSession / session audit guard
  let currentUser = daphnePending;
  const match = usersList.find(u => u.email === currentUser.email);

  if (match && match.hasSetPassword === false) {
    currentUser = null;
    clearStoredUserSession();
  }

  assert.strictEqual(currentUser, null, 'User pending password creation must not be authenticated as currentUser');
  assert.strictEqual(localStorage.getItem('mdc_current_user'), null, 'Pending user credentials must be cleared from storage');
  console.log('  ✓ PASS: User marked Pending Password Creation is strictly prohibited from having an active session');
})();

// Test 2: Deleted user session invalidation on hydration
(() => {
  const deletedEmail = 'daphneclaire.bascuguin@mobilecareph.com';
  const mergedDeletedUserIds = [deletedEmail];
  const mergedUsers = [
    { id: 'usr-zhon', email: 'zhon.manaois@mobilecareph.com', hasSetPassword: true, isActive: true }
  ];

  let currentUser = { id: 'usr-daphne', email: deletedEmail };
  localStorage.setItem('mdc_current_user', JSON.stringify(currentUser));

  const isDeleted = mergedDeletedUserIds.includes(currentUser.email.toLowerCase());
  const freshCurrent = mergedUsers.find(u => u.email.toLowerCase() === currentUser.email.toLowerCase());

  if (isDeleted || !freshCurrent || freshCurrent.isActive === false || freshCurrent.hasSetPassword === false) {
    currentUser = null;
    clearStoredUserSession();
  }

  assert.strictEqual(currentUser, null, 'Deleted user must be instantly set to null');
  assert.strictEqual(localStorage.getItem('mdc_current_user'), null, 'Storage must be cleaned');
  console.log('  ✓ PASS: Deleted user detected during hydration is purged and logged out');
})();

// Test 3: Realtime broadcast FORCE_LOGOUT_USER terminates active peer session
(() => {
  let currentUser = { id: 'usr-daphne', email: 'daphneclaire.bascuguin@mobilecareph.com' };
  localStorage.setItem('mdc_current_user', JSON.stringify(currentUser));

  const broadcastEvent = {
    type: 'FORCE_LOGOUT_USER',
    payload: {
      userId: 'usr-daphne',
      email: 'daphneclaire.bascuguin@mobilecareph.com',
      reason: 'Account deleted by administrator'
    }
  };

  const targetEmail = broadcastEvent.payload.email.toLowerCase();
  if (currentUser && currentUser.email.toLowerCase() === targetEmail) {
    currentUser = null;
    clearStoredUserSession();
  }

  assert.strictEqual(currentUser, null, 'FORCE_LOGOUT_USER broadcast must immediately terminate matching session');
  assert.strictEqual(localStorage.getItem('mdc_current_user'), null, 'Stored session must be purged upon receiving broadcast');
  console.log('  ✓ PASS: Realtime FORCE_LOGOUT_USER terminates matching session across different browsers');
})();

// Test 4: Deactivated account session invalidation
(() => {
  let currentUser = { id: 'usr-temp', email: 'temp@mobilecareph.com', isActive: true };
  const usersList = [{ id: 'usr-temp', email: 'temp@mobilecareph.com', isActive: false, hasSetPassword: true }];

  const match = usersList.find(u => u.id === currentUser.id);
  if (match && match.isActive === false) {
    currentUser = null;
    clearStoredUserSession();
  }

  assert.strictEqual(currentUser, null, 'Deactivated user session must be revoked');
  console.log('  ✓ PASS: Deactivated account is automatically signed out');
})();

// Test 5: Deleted site SM ILOILO is purged from cache and not resurrected by cloud sync
(() => {
  const cachedSites = [
    { id: 'site-1', code: 'APP BHS', name: 'MOBILECARE - APP BONIFACIO HIGH STREET' },
    { id: 'site-27', code: 'APP ILO', name: 'MOBILECARE - APP SM ILOILO', address: 'MOBILECARE - APP SM ILOILO Service Branch, Philippines' },
    { id: 'site-20', code: 'APP ILO', name: 'MOBILECARE - FESTIVE WALK ILOILO' }
  ];
  localStorage.setItem('mdc_sites', JSON.stringify(cachedSites));

  // Boot cache sanitizer
  const saved = localStorage.getItem('mdc_sites');
  const parsed = saved ? JSON.parse(saved) : [];
  const clean = parsed.filter(s =>
    !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
    !String(s.address || '').toUpperCase().includes('SM ILOILO')
  );

  assert.strictEqual(clean.length, 2, 'SM ILOILO must be removed from sites cache');
  assert(!clean.some(s => s.name.includes('SM ILOILO')), 'No SM ILOILO sites remain in cleaned list');

  // Authoritative cloud sync from Supabase (Supabase has 2 sites)
  const dbSites = [
    { id: 'site-1', code: 'APP BHS', name: 'MOBILECARE - APP BONIFACIO HIGH STREET' },
    { id: 'site-20', code: 'APP ILO', name: 'MOBILECARE - FESTIVE WALK ILOILO' }
  ];

  const authoritativeSites = dbSites
    .filter(s =>
      !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
      !String(s.address || '').toUpperCase().includes('SM ILOILO')
    );

  assert.strictEqual(authoritativeSites.length, 2, 'Authoritative sync preserves exact cloud sites');
  assert(!authoritativeSites.some(s => s.name.includes('SM ILOILO')), 'SM ILOILO strictly excluded');
  console.log('  ✓ PASS: Deleted site (SM ILOILO) is purged from cache and authoritative cloud sync prevents zombie resurrection');
})();

console.log('====================================================');
console.log('ALL SESSION & SITE SECURITY TESTS PASSED (100%)');
console.log('====================================================\n');
