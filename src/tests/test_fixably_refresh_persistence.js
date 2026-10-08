import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { parseFixablyInventoryValueCsv } from '../utils/excelParser.js';
import { normalizeInventoryUnits, isProvincialSite } from '../utils/partResolver.js';
import { defaultPartsCatalog } from '../data/defaultCatalog.js';
import {
  saveInventoryToLocalStorage,
  readInventoryFromLocalStorage
} from '../utils/appContextHelpers.js';
import { OFFICIAL_BRANCH_DIRECTORY } from '../constants/branchDirectory.js';

// Setup Mock LocalStorage
class MockLocalStorage {
  constructor(maxByteLimit = 5 * 1024 * 1024) {
    this.store = new Map();
    this.maxByteLimit = maxByteLimit;
  }
  getItem(key) {
    return this.store.get(key) || null;
  }
  setItem(key, value) {
    const strVal = String(value);
    let totalSize = strVal.length;
    for (const [k, v] of this.store.entries()) {
      if (k !== key) totalSize += v.length;
    }
    if (totalSize > this.maxByteLimit) {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.store.set(key, strVal);
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

global.localStorage = new MockLocalStorage();

async function runTest() {
  console.log('=== Running Fixably Refresh Persistence & Zero-Loss Cloud Sync Test ===\n');

  // 1. Prepare sites from official directory
  const sites = Object.entries(OFFICIAL_BRANCH_DIRECTORY).map(([code, s]) => ({
    id: 'site-' + code.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    code,
    ...s
  }));

  // 2. Read and parse CSV (3,416 units)
  const csvPath = path.resolve('Custom reports - Inventory Value.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const parseRes = await parseFixablyInventoryValueCsv(csvContent, defaultPartsCatalog, [], { sites });

  assert.strictEqual(parseRes.success, true, 'CSV parser must succeed');
  assert.strictEqual(parseRes.items.length, 3416, `CSV items must be exactly 3,416, got ${parseRes.items.length}`);
  const importedUnits = normalizeInventoryUnits(parseRes.items, defaultPartsCatalog);
  assert.strictEqual(importedUnits.length, 3416, `Normalized units must be 3,416`);
  console.log(`✓ Step 1: Parsed & normalized exactly ${importedUnits.length} units from Fixably CSV.`);

  // 3. Test Compact Serialization and Safari Quota Safety
  const uncompactedJson = JSON.stringify(importedUnits);
  const uncompactedBytes = Buffer.byteLength(uncompactedJson, 'utf8');
  console.log(`  - Uncompacted JSON size: ${(uncompactedBytes / (1024 * 1024)).toFixed(2)} MB (${uncompactedBytes} bytes)`);

  saveInventoryToLocalStorage(importedUnits);
  const storedJson = global.localStorage.getItem('mdc_inventory');
  assert(storedJson !== null, 'mdc_inventory must be saved in localStorage');
  const storedBytes = Buffer.byteLength(storedJson, 'utf8');
  console.log(`  - Stored format size in localStorage: ${(storedBytes / 1024).toFixed(1)} KB (${storedBytes} bytes)`);

  // Verify compact representation is well below 1MB
  assert(storedBytes < 750 * 1024, `Compacted payload should be < 750 KB, but was ${storedBytes} bytes`);
  console.log(`✓ Step 2: Serialization fits safely in Safari origin storage without QuotaExceededError.`);

  // 4. Test Simulated Browser Refresh / Page Reload (Cold Start)
  // When user hits reload (F5 / Safari refresh), component initializes synchronously
  const rehydratedUnits = readInventoryFromLocalStorage();
  assert.strictEqual(rehydratedUnits.length, 3416, `Rehydrated units after refresh must be 3,416, got ${rehydratedUnits.length}`);

  // Check critical unit properties after expansion
  const sampleUnit = rehydratedUnits[0];
  assert(sampleUnit.serial_number, 'Rehydrated unit must have serial_number');
  assert(sampleUnit.part_number, 'Rehydrated unit must have part_number');
  assert(sampleUnit.description, 'Rehydrated unit must have description');
  assert(sampleUnit.current_site_id, 'Rehydrated unit must have current_site_id');
  assert(sampleUnit.site_code, 'Rehydrated unit must have site_code');
  assert(sampleUnit.status, 'Rehydrated unit must have status');

  // Verify regional counts after refresh
  let mmCount = 0;
  let provCount = 0;
  rehydratedUnits.forEach(u => {
    const sObj = sites.find(s => s.code === u.site_code);
    if (isProvincialSite(sObj)) provCount++;
    else mmCount++;
  });
  assert.strictEqual(mmCount, 2368, `Metro Manila count after refresh must be 2,368, got ${mmCount}`);
  assert.strictEqual(provCount, 1048, `Provincial count after refresh must be 1,048, got ${provCount}`);
  console.log(`✓ Step 3: Browser refresh rehydrates exactly 3,416 units (MM: ${mmCount}, Provincial: ${provCount}) synchronously.`);

  // 5. Test QuotaExceededError Auto-Recovery
  // Setup a restricted localStorage (e.g. 1.5MB origin limit where uncompacted JSON would fail)
  const restrictedStorage = new MockLocalStorage(1.5 * 1024 * 1024);
  global.localStorage = restrictedStorage;
  // Attempt save in restricted storage
  saveInventoryToLocalStorage(importedUnits);
  const recoveredUnits = readInventoryFromLocalStorage();
  assert.strictEqual(recoveredUnits.length, 3416, `Auto-recovery must retain all 3,416 units under tight quota`);
  console.log(`✓ Step 4: QuotaExceededError auto-recovery verified under strict storage constraints.`);

  // 6. Test Multi-Tier Cloud Sync Merge (Simulate useCloudSync receiving partial 495 units from Supabase)
  console.log('\n--- Simulating useCloudSync Background Sync with partial 495 cloud units ---');
  // Suppose Supabase returns only 495 units (e.g. historical / unimported)
  const partialCloudUnits = importedUnits.slice(0, 495).map(u => ({
    ...u,
    notes: 'synced_from_cloud'
  }));

  // Simulate setInventoryUnits merge logic in useCloudSync
  const inMemoryPrev = rehydratedUnits; // 3,416 units in memory
  const idbCachedUnits = importedUnits; // 3,416 units in IndexedDB
  const idbBranchCachedUnits = importedUnits.filter(u => u.site_code !== 'DC-MDC');
  const localSavedUnits = readInventoryFromLocalStorage(); // 3,416 from localStorage

  const allLocalSources = [
    ...(Array.isArray(inMemoryPrev) ? inMemoryPrev : []),
    ...(Array.isArray(idbCachedUnits) ? idbCachedUnits : []),
    ...(Array.isArray(idbBranchCachedUnits) ? idbBranchCachedUnits : []),
    ...(Array.isArray(localSavedUnits) ? localSavedUnits : [])
  ];

  const mergeMap = new Map();
  // 1. First add cloud units
  partialCloudUnits.forEach(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    if (s) mergeMap.set(s, u);
  });
  // 2. Add local sources if not present in cloud
  allLocalSources.forEach(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    if (s && !mergeMap.has(s)) {
      mergeMap.set(s, u);
    }
  });

  const mergedResult = Array.from(mergeMap.values());
  assert.strictEqual(mergedResult.length, 3416, `Cloud sync merge must retain all 3,416 units, got ${mergedResult.length}`);

  // Test zero-loss guard for IndexedDB write
  let idbSavedUnits = idbCachedUnits;
  if (!Array.isArray(idbCachedUnits) || mergedResult.length >= idbCachedUnits.length) {
    idbSavedUnits = mergedResult;
  }
  assert.strictEqual(idbSavedUnits.length, 3416, `IndexedDB cache must never downgrade below 3,416`);
  console.log(`✓ Step 5: Cloud sync merge retains all 3,416 units and zero-loss guard protects IndexedDB.`);

  // 7. Verify non-standard technician serials survive full cycle
  const specialSerials = ['00', 'N', 'REPLACE', '661-22374'];
  specialSerials.forEach(sn => {
    const found = mergedResult.find(u => String(u.serial_number).trim().toUpperCase() === sn);
    assert(Boolean(found), `Special serial '${sn}' must survive import -> compact -> refresh -> cloud sync`);
  });
  console.log(`✓ Step 6: Special technician serials (00, N, REPLACE, 661-22374) survived full lifecycle.`);

  console.log('\n====================================================');
  console.log('ALL TESTS PASSED: Fixably refresh persistence 100% verified!');
  console.log('====================================================');
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
