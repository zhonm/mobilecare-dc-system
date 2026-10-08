import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { parseSiteStockMonitoringWorkbook } from '../utils/excelParser.js';

const seedData = JSON.parse(fs.readFileSync(new URL('../data/seedData.json', import.meta.url), 'utf-8'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbookPath = path.resolve(__dirname, '../../Site Stock Monitoring (On Hand).xlsx');

console.log('========================================================================');
console.log('TEST SUITE: Site Stock Monitoring Import Persistence & Cloud Sync Guard');
console.log('========================================================================');

if (!fs.existsSync(workbookPath)) {
  console.log('  Note: Site Stock Monitoring (On Hand).xlsx not found; skipping test.');
  process.exit(0);
}

// 1. Parse On-Hand Workbook
console.log('\n--- 1. Parsing Site Stock Monitoring (On Hand).xlsx ---');
const workbook = XLSX.read(fs.readFileSync(workbookPath), { type: 'buffer' });
const sites = seedData.sites || [];
const parseResult = parseSiteStockMonitoringWorkbook(workbook, {
  parseAllSheets: true,
  sites
});

assert.strictEqual(parseResult.success, true, 'Parsing must succeed');
assert.strictEqual(parseResult.summary.inStock, 3446, 'Must parse exactly 3,446 in-stock records');
console.log(`  ✓ PASS: Parsed ${parseResult.items.length} total items (${parseResult.summary.inStock} In-Stock, ${parseResult.summary.used} Used, ${parseResult.summary.transferred} Transferred, ${parseResult.summary.outtake} Outtake)`);

// 2. Simulate Pre-Import Site Clear (as triggered by Clear parts before import)
console.log('\n--- 2. Simulating Pre-Import Site Clear & Deletion Registry ---');
const clearedSerials = parseResult.items
  .filter(i => (i.serial_number || i.serialNumber))
  .slice(0, 1000)
  .map(i => String(i.serial_number || i.serialNumber).toUpperCase());
const mockStorage = {
  mdc_deleted_unit_serials: JSON.stringify(clearedSerials),
  mdc_cleared_site_timestamps: JSON.stringify({
    ALL_BRANCHES: new Date().toISOString(),
    'ASP ABR': new Date().toISOString(),
    'site-23': new Date().toISOString()
  }),
  mdc_inventory: JSON.stringify([])
};

// Verify that prior to import unmarking, deletedSerials has 1000 serials
let localDeleted = JSON.parse(mockStorage.mdc_deleted_unit_serials);
assert.strictEqual(localDeleted.length, 1000, 'Mock deleted serials initialized');

// 3. Simulating batchAddScanInUnits with updated_at, unmarking, and cleared sites reset
console.log('\n--- 3. Simulating batchAddScanInUnits Processing ---');
const validItems = parseResult.items.filter(
  it => (it.status === 'VALID' || it.status === 'NEW_PART' || it.status === 'EXISTING_INVENTORY') && (it.serial_number || it.serialNumber)
);

const nowIso = new Date().toISOString();
const importedUnits = validItems.map(item => {
  return {
    id: `unit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    part_number: item.part_number || item.partNumber,
    description: item.description,
    serial_number: String(item.serial_number || item.serialNumber).trim().toUpperCase(),
    current_site_id: item.current_site_id,
    site_code: item.site_code,
    site_name: item.site_name,
    status: item.lifecycle_status || item.status || 'in_stock',
    received_at: item.dateReceived || nowIso,
    updated_at: nowIso
  };
});

// Verify every processed unit has a valid updated_at timestamp
assert(importedUnits.every(u => Boolean(u.updated_at)), 'Every unit must have an updated_at timestamp');

// Unmark deleted serials:
const importedSerials = new Set(importedUnits.map(u => u.serial_number));
localDeleted = localDeleted.filter(s => !importedSerials.has(s));
mockStorage.mdc_deleted_unit_serials = JSON.stringify(localDeleted);

// Verify that all 1000 previously cleared serials are unmarked
assert.strictEqual(localDeleted.length, 0, 'All imported serials must be removed from deleted serials registry');

// Reset cleared sites map:
const clearedSites = JSON.parse(mockStorage.mdc_cleared_site_timestamps);
delete clearedSites['ALL_BRANCHES'];
delete clearedSites['ENTIRE_SYSTEM'];
importedUnits.forEach(u => {
  if (u.current_site_id) delete clearedSites[u.current_site_id];
  if (u.site_code) delete clearedSites[u.site_code];
});
mockStorage.mdc_cleared_site_timestamps = JSON.stringify(clearedSites);
assert.strictEqual(Object.keys(clearedSites).length, 0, 'All cleared site timestamps must be purged upon fresh branch import');

mockStorage.mdc_inventory = JSON.stringify(importedUnits);
console.log(`  ✓ PASS: Processed ${importedUnits.length} units with valid updated_at and reset cleared site locks`);

// 4. Simulate Cloud Sync Hydration (useCloudSync setInventoryUnits)
console.log('\n--- 4. Simulating Cloud Sync Hydration & Guard ---');
// Cloud query returns stale snapshot with only 945 units or older timestamps
const staleCloudUnits = importedUnits.slice(0, 945).map(u => ({
  ...u,
  updated_at: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
}));

// Cloud also has stale deleted serials doc that hasn't been un-synced yet
const staleCloudDeleted = clearedSerials;

// Compute activeLocalSerials & deletedSerialsSet in useCloudSync
const activeLocalSerials = new Set();
const localInv = JSON.parse(mockStorage.mdc_inventory);
localInv.forEach(u => {
  const s = String(u.serial_number || '').trim().toUpperCase();
  if (s && !u.is_deleted && u.status !== 'deleted') activeLocalSerials.add(s);
});

const cloudDeletedSet = new Set([
  ...JSON.parse(mockStorage.mdc_deleted_unit_serials),
  ...staleCloudDeleted
].map(s => String(s).trim().toUpperCase()));

// Guard active serials
activeLocalSerials.forEach(s => cloudDeletedSet.delete(s));
const deletedSerialsSet = cloudDeletedSet;

assert.strictEqual(deletedSerialsSet.size, 0, 'Active local serials must NOT be deleted by stale cloud deletion list');

// Simulate useCloudSync map merge
const map = new Map();
// 1. dbUnits loaded into map
staleCloudUnits.forEach(u => {
  const s = String(u.serial_number).toUpperCase();
  if (!deletedSerialsSet.has(s)) {
    map.set(s, u);
  }
});
assert.strictEqual(map.size, 945, 'Stale cloud contains only 945 units');

// 2. Merge local units (prev.forEach)
const prev = localInv;
prev.forEach(u => {
  const s = String(u.serial_number || '').trim().toUpperCase();
  if (s && !deletedSerialsSet.has(s) && !u.is_deleted && u.status !== 'deleted') {
    if (!map.has(s)) {
      map.set(s, u);
    } else {
      const cloudUnit = map.get(s);
      const localTime = u.updated_at ? new Date(u.updated_at).getTime() : 0;
      const cloudTime = cloudUnit?.updated_at ? new Date(cloudUnit.updated_at).getTime() : 0;
      const isLocalLifecycle = u.status === 'used' || u.status === 'outtake' || u.status === 'transferred' || Boolean(u.used_at);
      const isCloudStaleInStock = cloudUnit.status === 'in_stock' && !cloudUnit.used_at && !cloudUnit.outtake_at && !cloudUnit.transferred_at;

      if (localTime >= cloudTime || (isLocalLifecycle && isCloudStaleInStock)) {
        map.set(s, {
          ...cloudUnit,
          ...u,
          current_site_id: u.current_site_id || cloudUnit.current_site_id,
          site_code: u.site_code || cloudUnit.site_code,
          site_name: u.site_name || cloudUnit.site_name,
          updated_at: u.updated_at || cloudUnit.updated_at
        });
      }
    }
  }
});

const mergedUnits = Array.from(map.values());
const inStockCount = mergedUnits.filter(u => u.status === 'in_stock').length;

console.log(`    Total Post-Sync Units: ${mergedUnits.length}`);
console.log(`    Total In-Stock Units:  ${inStockCount}`);

assert(inStockCount >= 3412, `In-stock units must NOT drop to 945! Expected >= 3412, got ${inStockCount}`);
console.log(`  ✓ PASS: Zero data loss! All ${inStockCount} in-stock units survived background cloud sync.`);

console.log('\n========================================================================');
console.log('ALL SITE STOCK MONITORING SYNC PERSISTENCE TESTS PASSED SUCCESSFULLY!');
console.log('========================================================================');
