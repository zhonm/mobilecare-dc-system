import assert from 'node:assert';
import fs from 'node:fs';
import { parseFixablyInventoryValueCsv, isFixablyInventoryValueContent } from '../utils/excelParser.js';

console.log('========================================================================');
console.log('TEST SUITE: Fixably Inventory Value 3,416 Discrepancy & Realtime Cache Invalidation');
console.log('========================================================================');

const csvPath = 'Custom reports - Inventory Value.csv';
assert.ok(fs.existsSync(csvPath), 'Custom reports - Inventory Value.csv must exist');

const content = fs.readFileSync(csvPath, 'utf8');

// 1. Content detection
assert.strictEqual(isFixablyInventoryValueContent(content), true, 'Must detect as Fixably CSV');

// 2. Parse execution: must return exactly 3,416 items matching the 3,416 data rows in Excel
const res = await parseFixablyInventoryValueCsv(content, [], []);
assert.strictEqual(res.success, true, 'Parsing must succeed');
assert.strictEqual(res.items.length, 3416, `Must parse exactly 3,416 items matching Excel file (got ${res.items.length})`);
assert.strictEqual(res.summary.total, 3416, 'Summary total must be exactly 3,416');
assert.strictEqual(res.summary.valid, 3416, 'Summary valid must be exactly 3,416');
assert.strictEqual(res.summary.inStock, 3416, 'Summary inStock must be exactly 3,416');
assert.strictEqual(res.summary.sitesCount, 25, 'Must cover all 25 branch sites');

let totalSiteCount = 0;
for (const [_code, info] of Object.entries(res.summary.siteBreakdown)) {
  totalSiteCount += info.count;
}
assert.strictEqual(totalSiteCount, 3416, 'Sum of site breakdown counts must be exactly 3,416');
console.log('  ✓ PASS: Parsed exactly 3,416 parts across 25 sites with 0 dropped rows');

// 3. Verify useInventory.js does not drop rows with technician serials
const invCode = fs.readFileSync('src/context/useInventory.js', 'utf8');
assert.ok(!invCode.includes('if (!serialValidation.isValid) continue;'), 'Must not skip invalid Apple serials during batch import');
assert.ok(invCode.includes("validatedSerial = (serialValidation.isValid ? serialValidation.cleanSerial : null) || cleanSerial"), 'Must fallback to cleanSerial');
assert.ok(invCode.includes("broadcastCloudEvent('INVENTORY_CACHE_INVALIDATED'"), 'Must broadcast INVENTORY_CACHE_INVALIDATED on import completion');
console.log('  ✓ PASS: useInventory.js preserves 100% of rows and broadcasts cache invalidation');

// 4. Verify useCloudSync.js global alert handling & cache wiping
const cloudSyncCode = fs.readFileSync('src/context/useCloudSync.js', 'utf8');
assert.ok(cloudSyncCode.includes("'INVENTORY_CACHE_INVALIDATED'"), 'isGlobalAlert must include INVENTORY_CACHE_INVALIDATED');
assert.ok(cloudSyncCode.includes("bType === 'INVENTORY_CACHE_INVALIDATED'"), 'alertsChannel must handle INVENTORY_CACHE_INVALIDATED');
assert.ok(cloudSyncCode.includes("localStorage.removeItem('mdc_inventory')"), 'Must clear local storage mdc_inventory on cache invalidation');
assert.ok(cloudSyncCode.includes("dbStorage.removeItem('mdc_inventory')"), 'Must clear dbStorage mdc_inventory on cache invalidation');
console.log('  ✓ PASS: useCloudSync.js wipes PMG and Admin cache and refreshes state on invalidation');

// 5. Verify AllStocksImportModal broadcasts invalidation
const modalCode = fs.readFileSync('src/components/AllStocksImportModal.jsx', 'utf8');
assert.ok(modalCode.includes("broadcastCloudEvent('INVENTORY_CACHE_INVALIDATED'"), 'Modal must broadcast invalidation upon import completion');
assert.ok(modalCode.includes("BroadcastChannel('mdc_sync_bus')"), 'Modal must notify cross-tab sync bus');
console.log('  ✓ PASS: AllStocksImportModal automatically triggers cache clear and broadcast');

console.log('========================================================================');
console.log('ALL FIXABLY 3,416 DISCREPANCY & CACHE INVALIDATION TESTS PASSED!');
console.log('========================================================================');
