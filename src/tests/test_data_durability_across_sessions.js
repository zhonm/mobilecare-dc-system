/**
 * Test Suite: Data Durability Across Auto-Logout & Sign-Out Sessions
 *
 * Verifies that:
 * 1. Calculated data (forecasting, allocations, inventory) is NOT deleted on signOut.
 * 2. Auto-logout does not wipe operational storage or Fixably snapshots.
 * 3. Starting a new session preserves existing calculated and rendered data.
 * 4. Fixably inventory snapshots persist across IndexedDB app_state, localStorage, and permanent archive.
 */

import assert from 'assert';

// Mock browser environment for node testing
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
    const keys = Array.from(this.store.keys());
    return keys[index] || null;
  }
}

globalThis.window = {
  localStorage: new MockStorage(),
  sessionStorage: new MockStorage(),
  location: { href: 'http://localhost:5173', replace: () => {}, reload: () => {} }
};
globalThis.localStorage = globalThis.window.localStorage;
globalThis.sessionStorage = globalThis.window.sessionStorage;

import { dbStorage } from '../utils/dbStorage.js';
import { clearOperationalLocalStorage } from '../utils/cacheManager.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

console.log('========================================================================');
console.log('TEST SUITE: Data Durability Across Auto-Logout & Session Transitions');
console.log('========================================================================');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    failedTests++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    failedTests++;
  }
}

// ── Test 1: useAuth.js signOut does NOT wipe operational business data ──────────
runTest('useAuth.js signOut does NOT invoke clearOperationalLocalStorage', () => {
  const authFile = fs.readFileSync(path.join(projectRoot, 'src/context/useAuth.js'), 'utf8');
  // Extract signOut function body
  const signOutMatch = authFile.match(/const signOut = async \(\) => {([\s\S]*?)};/);
  assert.ok(signOutMatch, 'signOut function must exist in useAuth.js');
  const signOutBody = signOutMatch[1];

  assert.ok(
    !signOutBody.includes('clearOperationalLocalStorage'),
    'signOut must NOT call clearOperationalLocalStorage; operational data must persist'
  );
  assert.ok(
    signOutBody.includes('clearStoredUserSession'),
    'signOut must clear stored user session credentials'
  );
  assert.ok(
    signOutBody.includes('clearSessionAuthTimestamp'),
    'signOut must clear session auth timestamp'
  );
});

// ── Test 2: useAutoLogout.js does NOT purge operational storage ─────────────────
runTest('useAutoLogout.js executeAutoLogout does NOT wipe operational cache', () => {
  const autoLogoutFile = fs.readFileSync(path.join(projectRoot, 'src/hooks/useAutoLogout.js'), 'utf8');
  const autoLogoutMatch = autoLogoutFile.match(/const executeAutoLogout = useCallback\(async \([\s\S]*?=> {([\s\S]*?)}, \[\]\);/);
  assert.ok(autoLogoutMatch, 'executeAutoLogout function must exist in useAutoLogout.js');
  const autoLogoutBody = autoLogoutMatch[1];

  assert.ok(
    !autoLogoutBody.includes('clearOperationalLocalStorage({ keepSession: false })'),
    'executeAutoLogout must NOT call clearOperationalLocalStorage({ keepSession: false })'
  );
});

// ── Test 3: Fixably inventory snapshot is preserved in cacheManager.js ──────────
await runAsyncTest('clearOperationalLocalStorage preserves mdc_fixably_snapshot', async () => {
  localStorage.clear();
  localStorage.setItem('mdc_current_user', JSON.stringify({ id: 'usr-1', email: 'test@mobilecare.com' }));
  localStorage.setItem('mdc_fixably_snapshot', JSON.stringify({ items: [{ serial: 'ABC123' }], timestamp: '2026-10-10' }));
  localStorage.setItem('mdc_fixably_snapshot_timestamp', '2026-10-10');
  localStorage.setItem('inventory_sync_batches', JSON.stringify([{ id: 'batch-1' }]));

  await clearOperationalLocalStorage({ keepSession: true });

  assert.ok(localStorage.getItem('mdc_fixably_snapshot') !== null, 'mdc_fixably_snapshot must NOT be wiped');
  assert.ok(localStorage.getItem('mdc_fixably_snapshot_timestamp') !== null, 'mdc_fixably_snapshot_timestamp must NOT be wiped');
  assert.ok(localStorage.getItem('inventory_sync_batches') !== null, 'inventory_sync_batches must NOT be wiped');
});

// ── Test 4: dbStorage clearOperationalCache retains fixably snapshot ────────────
await runAsyncTest('dbStorage.clearOperationalCache retains fixably snapshot and audit settings', async () => {
  await dbStorage.setItem('mdc_fixably_snapshot', { test: true });
  await dbStorage.setItem('inventory_sync_batches', [{ batch: 1 }]);
  await dbStorage.setItem('mdc_temporary_cache', { temp: true });

  await dbStorage.clearOperationalCache();

  const snap = await dbStorage.getItem('mdc_fixably_snapshot');
  const batches = await dbStorage.getItem('inventory_sync_batches');
  assert.deepStrictEqual(snap, { test: true }, 'mdc_fixably_snapshot must persist in dbStorage');
  assert.deepStrictEqual(batches, [{ batch: 1 }], 'inventory_sync_batches must persist in dbStorage');
});

// ── Test 5: FixablyInventoryDashboard implements multi-tier archive fallback ───
runTest('FixablyInventoryDashboard.jsx loads from dbStorage, localStorage, and saved_records archive', () => {
  const dashFile = fs.readFileSync(path.join(projectRoot, 'src/components/FixablyInventoryDashboard.jsx'), 'utf8');
  assert.ok(
    dashFile.includes("dbStorage.getItem('mdc_fixably_snapshot')"),
    'Must check dbStorage for snapshot'
  );
  assert.ok(
    dashFile.includes("localStorage.getItem('mdc_fixably_snapshot')"),
    'Must have secondary localStorage fallback'
  );
  assert.ok(
    dashFile.includes("dbStorage.getAllSavedRecords()"),
    'Must have tertiary permanent archive fallback'
  );
  assert.ok(
    dashFile.includes("dbStorage.putSavedRecord"),
    'Must write permanent archive record on multi-file processing'
  );
});

// ── Test 6: Login does NOT wipe existing calculated data on session start ──────
runTest('useAuth.js login handlers do NOT wipe operational data on session start', () => {
  const authFile = fs.readFileSync(path.join(projectRoot, 'src/context/useAuth.js'), 'utf8');
  const signInMatch = authFile.match(/const signInWithPassword = async \([\s\S]*?=> {([\s\S]*?)};/);
  assert.ok(signInMatch, 'signInWithPassword must exist');
  assert.ok(
    !signInMatch[1].includes('clearOperationalLocalStorage'),
    'signInWithPassword must NOT call clearOperationalLocalStorage'
  );

  const pwdCreateMatch = authFile.match(/const createFirstTimePassword = async \([\s\S]*?=> {([\s\S]*?)};/);
  assert.ok(pwdCreateMatch, 'createFirstTimePassword must exist');
  assert.ok(
    !pwdCreateMatch[1].includes('clearOperationalLocalStorage'),
    'createFirstTimePassword must NOT call clearOperationalLocalStorage'
  );
});

console.log('========================================================================');
console.log(`DATA DURABILITY RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('========================================================================');

if (failedTests > 0) {
  process.exit(1);
}
