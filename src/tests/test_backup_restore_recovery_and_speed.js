import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Mock browser globals before importing backupRestoreService
const lsStore = new Map();
globalThis.window = {
  __MDC_SYSTEM_RESTORE_IN_PROGRESS: false,
  atob: globalThis.atob,
  btoa: globalThis.btoa,
  console: globalThis.console,
  localStorage: {
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => lsStore.set(k, String(v)),
    removeItem: (k) => lsStore.delete(k),
    clear: () => lsStore.clear(),
    get length() {
      return lsStore.size;
    },
    key: (i) => Array.from(lsStore.keys())[i] ?? null
  }
};
globalThis.localStorage = globalThis.window.localStorage;

const {
  compileSystemBackupPackage,
  executeSystemStateRestore,
  verifyRestoredStateIntegrity
} = await import('../services/backupRestoreService.js');

console.log('=== Backup & Restore Recovery + Performance Verification ===');

// 1. Build initial system state with 5 DC Stock units
const initialUnits = [
  { id: 'u1', part_number: '661-30401', description: 'Display, iPhone 14 Pro Max', serial_number: 'G9P5184NCMS14YDA0', status: 'in_stock', current_site_id: 'site-dc', site_code: 'DC-MDC' },
  { id: 'u2', part_number: '661-30401', description: 'Display, iPhone 14 Pro Max', serial_number: 'G9P5204N0NB14YDAY', status: 'in_stock', current_site_id: 'site-dc', site_code: 'DC-MDC' },
  { id: 'u3', part_number: '661-30401', description: 'Display, iPhone 14 Pro Max', serial_number: 'G9P5203NK9V14YDA1', status: 'in_stock', current_site_id: 'site-dc', site_code: 'DC-MDC' },
  { id: 'u4', part_number: '661-30401', description: 'Display, iPhone 14 Pro Max', serial_number: 'G9P5204NE1814YDAD', status: 'in_stock', current_site_id: 'site-dc', site_code: 'DC-MDC' },
  { id: 'u5', part_number: '661-30401', description: 'Display, iPhone 14 Pro Max', serial_number: 'G9P5204N40014YDAP', status: 'in_stock', current_site_id: 'site-dc', site_code: 'DC-MDC' }
];

const initialState = {
  parts: [{ id: 'p1', part_number: '661-30401', description: 'Display, iPhone 14 Pro Max', stocking_price: 299 }],
  sites: [{ id: 'site-dc', code: 'DC-MDC', name: 'Central DC', is_dc: true }],
  categories: [{ id: 'cat-1', code: 'DISPLAY', name: 'Display Module' }],
  inventoryUnits: initialUnits,
  shipments: [],
  purchaseOrders: [],
  dcIntakeRecords: [{ id: 'intake-1', record_name: 'Batch 1', items: initialUnits }],
  partsRequests: [],
  forecastItems: [],
  allocations: [],
  usersList: [{ id: 'usr-1', email: 'admin@mobilecareph.com', fullName: 'Superadmin', role: 'superadmin' }]
};

const backupPkg = compileSystemBackupPackage(initialState, initialState.usersList[0], {
  label: 'Pre-Delete Snapshot'
});
assert.equal(backupPkg.data.inventoryUnits.length, 5, 'Backup should contain all 5 DC Stock units');

// 2. Simulate deleting 3 DC Stock units (adding tombstones + removing from live state)
const deletedSerials = ['G9P5184NCMS14YDA0', 'G9P5204N0NB14YDAY', 'G9P5203NK9V14YDA1'];
globalThis.localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(deletedSerials));
const liveAfterDelete = {
  ...initialState,
  inventoryUnits: initialUnits.slice(3) // Only 2 units left live
};

// 3. Execute restore and track progress + restore-in-progress guard + cloud payload
let restoredInventory = [];
let sawRestoreGuardTrue = false;
let cloudPayloadCaptured = null;
const progressEvents = [];

const result = await executeSystemStateRestore(
  backupPkg,
  {
    currentUser: initialState.usersList[0],
    currentAppState: liveAfterDelete,
    setParts: () => {},
    setSites: () => {},
    setCategories: () => {},
    setInventoryUnits: (units) => {
      restoredInventory = units;
      if (globalThis.window.__MDC_SYSTEM_RESTORE_IN_PROGRESS === true) {
        sawRestoreGuardTrue = true;
      }
    },
    setShipments: () => {},
    setPurchaseOrders: () => {},
    setDcIntakeRecords: () => {},
    setPartsRequests: () => {},
    setForecastItems: () => {},
    setAllocations: () => {},
    setUsersList: () => {},
    forceGlobalCloudSyncAndPurge: async (payload) => {
      cloudPayloadCaptured = payload;
      payload.onProgress?.({ percent: 93, description: 'Mock cloud sync...' });
      return {
        success: true,
        deletedRegistriesFlushed: true,
        inventoryUnitsSynced: payload.inventoryUnits.length,
        inventoryUnitsFailed: 0,
        registriesSynced: 6,
        warnings: [],
        durationMs: 12
      };
    }
  },
  (prog) => progressEvents.push(prog),
  { sourceType: 'LOCAL_FILE', sourceFilename: 'test_backup.json', createPreRestoreSnapshot: false }
);

assert.equal(result.success, true, 'Restore should succeed');
assert.equal(restoredInventory.length, 5, 'All 5 DC Stock units must be restored to React state');
assert.equal(result.recoveredDeletedUnits, 3, 'Should detect exactly 3 recovered deleted units');
assert.equal(sawRestoreGuardTrue, true, 'Restore-in-progress guard must be active during restore');
assert.equal(globalThis.window.__MDC_SYSTEM_RESTORE_IN_PROGRESS, false, 'Restore-in-progress guard must reset after restore');

// Verify tombstones were cleared for all restored serials
const finalLocalDeleted = JSON.parse(globalThis.localStorage.getItem('mdc_deleted_unit_serials') || '[]');
assert.equal(finalLocalDeleted.length, 0, 'Restored serials must be removed from mdc_deleted_unit_serials');
assert.ok(cloudPayloadCaptured, 'Cloud sync payload should be dispatched');
assert.equal(cloudPayloadCaptured.registries.deletedUnitSerials.length, 0, 'Cloud deletedUnitSerials must exclude restored serials');
assert.equal(cloudPayloadCaptured.inventoryUnits.length, 5, 'Cloud payload must include all 5 restored units');

// Verify post-restore integrity report
assert.equal(result.verificationReport.verified, true, 'Post-restore verification must pass');
assert.equal(result.verificationReport.lostRecords, 0, 'Zero records lost');
assert.equal(result.verificationReport.tombstoneConflicts, 0, 'Zero tombstone conflicts');
assert.equal(result.verificationReport.cloudVerified, true, 'Cloud sync must be marked verified');

// Verify progress reporting reached 100%
assert.ok(progressEvents.length >= 6, 'Should emit granular step progress events');
assert.equal(progressEvents[progressEvents.length - 1].percent, 100, 'Final progress event should be 100%');

// Verify verifyRestoredStateIntegrity detects tombstone conflicts when present
const conflictCheck = verifyRestoredStateIntegrity(
  backupPkg.data,
  backupPkg.stats,
  { persistedDeletedSerials: ['G9P5184NCMS14YDA0'] }
);
assert.equal(conflictCheck.verified, false, 'Integrity check must fail if a restored serial is still tombstoned');
assert.equal(conflictCheck.tombstoneConflicts, 1, 'Should report exact tombstone conflict count');

// 4. Static verification of useCloudSync.js ordering & direct inventory_units recovery
const cloudSyncSource = fs.readFileSync(
  path.resolve('src/context/useCloudSync.js'),
  'utf8'
);
assert.ok(
  cloudSyncSource.includes('window.__MDC_SYSTEM_RESTORE_IN_PROGRESS'),
  'hydrateFromSupabase must guard against concurrent refresh during system restore'
);

const forceFnStart = cloudSyncSource.indexOf('const forceGlobalCloudSyncAndPurge = async');
const forceFnBody = cloudSyncSource.slice(forceFnStart);
const tombstoneIdx = forceFnBody.indexOf("id: 'deleted_unit_serials_registry'");
const syncMasterIdx = forceFnBody.indexOf('await syncAllDataToCloud(');
const directInvUpsertIdx = forceFnBody.indexOf(".from('inventory_units')");

assert.ok(tombstoneIdx > 0 && syncMasterIdx > 0 && directInvUpsertIdx > 0, 'Expected restore phases must exist in forceGlobalCloudSyncAndPurge');
assert.ok(
  tombstoneIdx < syncMasterIdx && tombstoneIdx < directInvUpsertIdx,
  'deleted_unit_serials_registry MUST be flushed BEFORE master sync and inventory_units upsert'
);
assert.ok(
  forceFnBody.includes('is_deleted: false'),
  'Direct inventory_units restore upsert must clear is_deleted flag'
);

console.log('ALL BACKUP & RESTORE RECOVERY + PERFORMANCE TESTS PASSED!');
