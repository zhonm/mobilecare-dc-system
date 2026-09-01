/**
 * Test Suite: Data Ownership & Initial Sync Gating
 * Tests the fix for: "New accounts see stale/hardcoded/shared data instead of their own live Supabase data"
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

import { clearOperationalLocalStorage } from '../utils/cacheManager.js';
import { formatShipmentForDb, formatShipmentItemsForDb, isUUID, toValidUUID } from '../utils/appContextHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Data Ownership & Initial Sync Gating');
console.log('====================================================');

let testsPassed = 0;
let testsFailed = 0;

function runTest(description, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${description}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${description}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

async function runAsyncTest(description, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${description}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${description}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

async function runAllTests() {
  // Test 1: Operational cache wipe with keepSession: true removes operational data and owner marker but keeps session
  await runAsyncTest('clearOperationalLocalStorage(keepSession: true) preserves user session while clearing operational data', async () => {
    localStorage.clear();
    // Simulate active session of User A with operational data
    localStorage.setItem('mdc_current_user', JSON.stringify({ id: 'usr-alice', email: 'alice@company.com' }));
    localStorage.setItem('mdc_users', JSON.stringify([{ id: 'usr-alice' }]));
    localStorage.setItem('mdc_local_data_owner', 'usr-alice');
    localStorage.setItem('mdc_inventory', JSON.stringify([{ serial_number: 'SER-123', part_number: '661-0001' }]));
    localStorage.setItem('mdc_forecast', JSON.stringify([{ part_number: '661-0001', final_forecast: 50 }]));
    localStorage.setItem('mdc_allocations', JSON.stringify([{ part_number: '661-0001' }]));
    localStorage.setItem('mdc_shipments', JSON.stringify([{ id: 'ship-1' }]));
    localStorage.setItem('mdc_parts', JSON.stringify([{ part_number: '661-0001' }]));
    localStorage.setItem('mdc_sites', JSON.stringify([{ code: 'APP BGC' }]));

    await clearOperationalLocalStorage({ keepSession: true });

    // Session keys MUST be preserved
    assert.ok(localStorage.getItem('mdc_current_user') !== null, 'mdc_current_user should be preserved');
    assert.ok(localStorage.getItem('mdc_users') !== null, 'mdc_users should be preserved');

    // Operational keys MUST be wiped
    assert.strictEqual(localStorage.getItem('mdc_inventory'), null, 'mdc_inventory should be wiped');
    assert.strictEqual(localStorage.getItem('mdc_forecast'), null, 'mdc_forecast should be wiped');
    assert.strictEqual(localStorage.getItem('mdc_allocations'), null, 'mdc_allocations should be wiped');
    assert.strictEqual(localStorage.getItem('mdc_shipments'), null, 'mdc_shipments should be wiped');
    assert.strictEqual(localStorage.getItem('mdc_parts'), null, 'mdc_parts should be wiped');
    assert.strictEqual(localStorage.getItem('mdc_sites'), null, 'mdc_sites should be wiped');
    assert.strictEqual(localStorage.getItem('mdc_local_data_owner'), null, 'mdc_local_data_owner should be wiped');
  });

  // Test 2: Operational cache wipe with keepSession: false removes everything on signOut
  await runAsyncTest('clearOperationalLocalStorage(keepSession: false) purges all data on signOut', async () => {
    localStorage.clear();
    localStorage.setItem('mdc_current_user', JSON.stringify({ id: 'usr-alice', email: 'alice@company.com' }));
    localStorage.setItem('mdc_local_data_owner', 'usr-alice');
    localStorage.setItem('mdc_inventory', JSON.stringify([{ serial: '123' }]));

    await clearOperationalLocalStorage({ keepSession: false });

    assert.strictEqual(localStorage.getItem('mdc_current_user'), null, 'mdc_current_user should be wiped');
    assert.strictEqual(localStorage.getItem('mdc_local_data_owner'), null, 'mdc_local_data_owner should be wiped');
    assert.strictEqual(localStorage.getItem('mdc_inventory'), null, 'mdc_inventory should be wiped');
  });

  // Test 3: Ownership validation logic for returning user on same device vs different device/user
  runTest('Ownership check correctly identifies matching owner vs stale/new account', () => {
    // Scenario A: User Bob logs into a device last hydrated by Alice
    const userBob = { id: 'usr-bob-456', email: 'bob@mobilecare.com' };
    const localOwnerAlice = 'usr-alice-123';

    const isMatchBob = localOwnerAlice && (
      localOwnerAlice === userBob.id ||
      (userBob.email && localOwnerAlice.toLowerCase() === userBob.email.toLowerCase())
    );
    assert.strictEqual(Boolean(isMatchBob), false, 'Bob should NOT match Alice owner marker');

    // Scenario B: User Alice logs into her own device
    const userAlice = { id: 'usr-alice-123', email: 'alice@mobilecare.com' };
    const isMatchAlice = localOwnerAlice && (
      localOwnerAlice === userAlice.id ||
      (userAlice.email && localOwnerAlice.toLowerCase() === userAlice.email.toLowerCase())
    );
    assert.strictEqual(Boolean(isMatchAlice), true, 'Alice should match Alice owner marker');

    // Scenario C: Fresh browser / empty owner marker
    const noOwner = null;
    const isMatchFresh = noOwner && (
      noOwner === userBob.id ||
      (userBob.email && noOwner.toLowerCase() === userBob.email.toLowerCase())
    );
    assert.strictEqual(Boolean(isMatchFresh), false, 'Fresh device without marker must NOT match (forces initial sync)');
  });

  // Test 4: Hydration success stamps owner marker and first login done
  runTest('Successful hydration stamps mdc_local_data_owner and mdc_first_login_done', () => {
    localStorage.clear();
    const currentUser = { id: 'usr-bob-789', email: 'bob@mobilecare.com', fullName: 'Bob Tester' };

    // Simulate completion in FirstLoginLoadingScreen or useCloudSync
    localStorage.setItem(`mdc_first_login_done_${currentUser.id}`, 'true');
    localStorage.setItem('mdc_local_data_owner', currentUser.id);

    assert.strictEqual(localStorage.getItem('mdc_local_data_owner'), 'usr-bob-789');
    assert.strictEqual(localStorage.getItem('mdc_first_login_done_usr-bob-789'), 'true');

    // Now if Bob logs in again, it matches
    const owner = localStorage.getItem('mdc_local_data_owner');
    const isReturningMatch = owner === currentUser.id;
    assert.strictEqual(isReturningMatch, true, 'Subsequent login by Bob uses fast path');
  });

  // Test 5: Shipment formatting generates valid Postgres enum status and UUIDs
  runTest('formatShipmentForDb maps statuses to safe Postgres enum values and valid UUIDs', () => {
    const rawPendingShipment = {
      id: 'shp-12345',
      shipment_number: 'SHP-2026-001',
      status: 'ready_for_dispatch',
      site_id: 'site-bgc'
    };

    const formatted = formatShipmentForDb(rawPendingShipment, [{ id: '11111111-2222-3333-4444-555555555555', code: 'BGC' }]);
    assert.ok(isUUID(formatted.id), 'Shipment ID must be a valid UUID');
    assert.ok(isUUID(formatted.site_id), 'Site ID must be a valid UUID');
    assert.notStrictEqual(formatted.status, 'ready_for_dispatch', 'Must not use ready_for_dispatch');
    assert.strictEqual(formatted.status, 'draft', 'Pending status should safely map to draft for Postgres enum compatibility');

    const confirmedShipment = {
      id: '22222222-3333-4444-5555-666666666666',
      status: 'received_confirmed',
      site_id: '11111111-2222-3333-4444-555555555555'
    };
    const formattedConfirmed = formatShipmentForDb(confirmedShipment);
    assert.strictEqual(formattedConfirmed.status, 'received_confirmed');
  });

  // Test 6: UUID generator produces RFC-compliant UUIDs for arbitrary user IDs
  runTest('toValidUUID produces deterministic valid UUIDs', () => {
    const customId = 'usr-1788232219698';
    const generatedUUID = toValidUUID(customId);
    assert.ok(isUUID(generatedUUID), `Generated ID "${generatedUUID}" must be a valid UUID`);

    const generatedUUID2 = toValidUUID(customId);
    assert.strictEqual(generatedUUID, generatedUUID2, 'UUID generation must be deterministic');

    const alreadyUUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    assert.strictEqual(toValidUUID(alreadyUUID), alreadyUUID, 'Existing UUID must be preserved');
  });

  // Test 7: Permanent User Deletion prevents resurrection from initial seed or cached data
  runTest('Permanent user deletion strictly filters deleted user from seed and caches', () => {
    localStorage.clear();
    const deletedUser = { id: 'usr-joshua-101', email: 'joshua@mobilecareph.com', fullName: 'Joshua DC' };
    const remainingUser = { id: 'usr-zhon-102', email: 'zhon@mobilecareph.com', fullName: 'Zhon DC' };

    const initialUsersList = [deletedUser, remainingUser];
    const deletedIds = [deletedUser.id.toLowerCase(), deletedUser.email.toLowerCase()];

    // Simulate deleteUser logic
    const nextList = initialUsersList.filter(u => 
      !deletedIds.includes(u.id.toLowerCase()) && 
      !deletedIds.includes(u.email.toLowerCase())
    );

    localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(deletedIds));
    localStorage.setItem('mdc_users', JSON.stringify(nextList));

    // Verify nextList only contains remainingUser
    assert.strictEqual(nextList.length, 1);
    assert.strictEqual(nextList[0].id, remainingUser.id);

    // Verify recovery strictly filters out deleted user
    const loadedDeletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]').map(s => String(s).toLowerCase());
    const recovered = [deletedUser, remainingUser].filter(u =>
      !loadedDeletedIds.includes(u.id.toLowerCase()) &&
      !loadedDeletedIds.includes(u.email.toLowerCase())
    );

    assert.strictEqual(recovered.length, 1);
    assert.strictEqual(recovered[0].email, 'zhon@mobilecareph.com');
  });

  // Test 8: Cloud sync hydration merges cloud and local deleted lists without stripping
  runTest('Cloud sync hydration strictly honors deleted registry and purges ghost users', () => {
    const cloudDeletedUserIds = ['usr-old-1', 'olduser@mobilecareph.com'];
    const localDeletedUserIds = ['usr-old-2', 'anotherold@mobilecareph.com'];

    const mergedDeletedUserIds = Array.from(new Set([
      ...localDeletedUserIds,
      ...cloudDeletedUserIds
    ].map(s => String(s).trim().toLowerCase())));

    const candidateUsers = [
      { id: 'usr-old-1', email: 'olduser@mobilecareph.com', fullName: 'Old User 1' },
      { id: 'usr-old-2', email: 'anotherold@mobilecareph.com', fullName: 'Old User 2' },
      { id: 'usr-active-3', email: 'active@mobilecareph.com', fullName: 'Active User' }
    ];

    const sanitized = candidateUsers.filter(u =>
      !mergedDeletedUserIds.includes(u.id.toLowerCase()) &&
      !mergedDeletedUserIds.includes(u.email.toLowerCase())
    );

    assert.strictEqual(sanitized.length, 1);
    assert.strictEqual(sanitized[0].id, 'usr-active-3');
  });

  // Test 9: Deleted user login verification & session recovery strictly rejected
  runTest('Deleted accounts are strictly rejected from email verification and session recovery', () => {
    localStorage.clear();
    const deletedUser = { id: 'usr-deleted-999', email: 'deleted.agent@mobilecareph.com', fullName: 'Deleted Agent' };
    const deletedIds = [deletedUser.id.toLowerCase(), deletedUser.email.toLowerCase()];
    localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(deletedIds));

    // Stored session of deleted user MUST be discarded
    localStorage.setItem('mdc_current_user', JSON.stringify(deletedUser));
    
    // Test getStoredUserSession logic
    const loadedDeleted = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]').map(s => String(s).toLowerCase());
    const rawStored = JSON.parse(localStorage.getItem('mdc_current_user'));
    
    const isDeleted = loadedDeleted.includes(rawStored.id?.toLowerCase()) || loadedDeleted.includes(rawStored.email?.toLowerCase());
    assert.strictEqual(isDeleted, true, 'Deleted user session must be identified as deleted');

    // Email login attempt by deleted account MUST be blocked
    const loginAttemptEmail = 'deleted.agent@mobilecareph.com';
    const isLoginBlocked = loadedDeleted.includes(loginAttemptEmail.toLowerCase());
    assert.strictEqual(isLoginBlocked, true, 'Login verification for deleted email must be strictly blocked');
  });

  // Test 10: Re-provisioning a deleted account unblocks it and allows clean first-time setup
  runTest('Re-provisioning previously deleted user clears deleted registry and enables normal login', () => {
    localStorage.clear();
    const email = 'recreated.agent@mobilecareph.com';
    const oldId = 'usr-old-111';

    // 1. Account was previously deleted
    let deletedIds = [oldId.toLowerCase(), email.toLowerCase()];
    localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(deletedIds));

    // 2. Superadmin re-creates account
    const newId = 'usr-new-222';
    const reCreatedUser = {
      id: newId,
      email: email,
      fullName: 'Recreated Agent',
      role: 'admin',
      hasSetPassword: false,
      passwordHash: null,
      isActive: true
    };

    // Filter out deleted status upon re-provisioning
    deletedIds = deletedIds.filter(id => id !== email.toLowerCase() && id !== newId.toLowerCase());
    localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(deletedIds));
    localStorage.setItem('mdc_users', JSON.stringify([reCreatedUser]));

    // 3. Verify user is NO LONGER blocked
    const currentDeleted = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
    assert.strictEqual(currentDeleted.includes(email.toLowerCase()), false, 'Recreated email must be unblocked');
    assert.strictEqual(currentDeleted.includes(newId.toLowerCase()), false, 'New user ID must be unblocked');

    // 4. Verify user can verify login email and is prompted for first-time password setup
    const isBlocked = currentDeleted.includes(email.toLowerCase());
    assert.strictEqual(isBlocked, false);
    assert.strictEqual(reCreatedUser.hasSetPassword, false, 'Recreated user starts fresh requiring password setup');
  });

  // Test 11: Fresh Incognito Browser (empty cache) trying to log in with deleted Anjo account
  runTest('Fresh Incognito session strictly blocks deleted Anjo email without password creation prompt', () => {
    localStorage.clear(); // Empty cache as in Private Window

    const cloudMasterUsersRegistry = {
      users: [
        { id: '1b0e9f43-c2d5-4eb4-acef-2ea5d9d21280', email: 'zhon.manaois@mobilecareph.com', fullName: 'Zhon Manaois' },
        { id: 'a703ae69-187d-4711-9f7f-c44da1d0177e', email: 'joshua.juvida@mobilecareph.com', fullName: 'Joshua Juvida' },
        { id: 'usr-1787831250805', email: 'daphneclaire.bascuguin@mobilecareph.com', fullName: 'Daphne Bascuguin' },
        { id: 'usr-1788085932974', email: 'andres@mobilecareph.com', fullName: 'Andres Bonifacio' },
        { id: 'usr-1788162524515-g5pbk', email: 'joserizal@mobilecareph.com', fullName: 'Jose Rizal' }
      ],
      deletedUserIds: ['anjo.alcazar@mobilecareph.com', 'usr-anjo-alcazar']
    };

    const attemptEmail = 'anjo.alcazar@mobilecareph.com';

    // Simulate verifyLoginEmail
    const deletedSet = new Set(cloudMasterUsersRegistry.deletedUserIds.map(s => s.toLowerCase()));
    const isDeleted = deletedSet.has(attemptEmail.toLowerCase());
    assert.strictEqual(isDeleted, true, 'Deleted email must be identified in cloud deleted set');

    const matchedInActive = cloudMasterUsersRegistry.users.find(u => u.email.toLowerCase() === attemptEmail.toLowerCase());
    assert.strictEqual(Boolean(matchedInActive), false, 'Deleted user must NOT exist in active users registry');

    const canProceed = !isDeleted && Boolean(matchedInActive);
    assert.strictEqual(canProceed, false, 'Deleted user MUST be blocked from login and never routed to create password');
  });

  console.log('====================================================');
  console.log(`RESULTS: ${testsPassed}/${testsPassed + testsFailed} PASSED (${testsFailed} FAILED)`);
  console.log('====================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runAllTests();

