import assert from 'assert';
import {
  reconcileFixablyMultiFile,
  compactFixablySnapshot,
  hydrateFixablySnapshot
} from '../utils/fixablyInventoryEngine.js';
import fs from 'fs';
import path from 'path';

console.log('=== Running Post-Refresh Inventory Revert Prevention Test ===\n');

function resolveCsvPath(name) {
  const rootPath = path.resolve(process.cwd(), name);
  if (fs.existsSync(rootPath)) return rootPath;
  return path.resolve(process.cwd(), 'xlsx files', name);
}

// 1. Load actual user files
const siteStockPath = resolveCsvPath('_2026 Site Stocks (Fixably) - Site Stock.csv');
const stockTransferPath = resolveCsvPath('_2026 Site Stocks (Fixably) - Stock Transfer.csv');

const siteStockCsv = fs.readFileSync(siteStockPath, 'utf8');
const stockTransferCsv = fs.readFileSync(stockTransferPath, 'utf8');

// 2. Reconcile to generate the golden snapshot
console.log('Step 1: Reconciling Site Stock (2) + Stock Transfer...');
const goldenSnapshot = await reconcileFixablyMultiFile({
  siteStockContent: siteStockCsv,
  stockTransferContent: stockTransferCsv,
  options: { currentDate: new Date('2026-10-09T00:00:00Z'), expandQuantity: true }
});

assert.strictEqual(goldenSnapshot.success, true, 'Reconciliation must succeed');
const expectedUnits = goldenSnapshot.items.length;
const expectedTransfers = goldenSnapshot.transfers.length;
const expectedSiteToSite = goldenSnapshot.siteToSiteTransfers.length;
assert.ok(expectedUnits > 0, 'Must have items');
assert.ok(expectedTransfers > 0, 'Must have transfers');
assert.ok(expectedSiteToSite > 0, 'Must have site-to-site transfers');

const compactCloud = compactFixablySnapshot(goldenSnapshot);
compactCloud.timestamp = '2026-10-28T06:56:16.789Z';

console.log(`  ✓ Step 1 Passed: Golden snapshot generated (${expectedUnits} units, ${expectedSiteToSite} site-to-site)`);

// 3. Simulate user environment at refresh time:
// Simulate the newly refactored resolution logic in loadInitialData()
console.log('Step 2: Testing loadInitialData authority resolution on page refresh...');

const cloudRec = {
  id: 'master_fixably_inventory_snapshot',
  updated_at: compactCloud.timestamp,
  snapshot_data: compactCloud
};

// Local cache might be empty (e.g. Safari Private Browsing) OR stale (0 transfers)
const testCases = [
  { name: 'Safari Private Browsing (local cache is null)', localCached: null },
  { name: 'Local cache has stale 3,026 snapshot with 0 transfers', localCached: { items: new Array(3026).fill({}), transfers: [] } }
];

for (const tc of testCases) {
  const cloudSnapData = cloudRec?.snapshot_data;
  const hasCloudSnapshot = Boolean(cloudSnapData && Array.isArray(cloudSnapData.items) && cloudSnapData.items.length > 0);
  const hasLocalSnapshot = Boolean(tc.localCached && Array.isArray(tc.localCached.items) && tc.localCached.items.length > 0);

  const cloudHasTransfers = Boolean(hasCloudSnapshot && Array.isArray(cloudSnapData.transfers) && cloudSnapData.transfers.length > 0);
  const localHasTransfers = Boolean(hasLocalSnapshot && Array.isArray(tc.localCached?.transfers) && tc.localCached.transfers.length > 0);

  let winningSnapshot = null;

  if (hasCloudSnapshot && hasLocalSnapshot) {
    if (cloudHasTransfers && !localHasTransfers) {
      winningSnapshot = cloudSnapData;
    } else if (localHasTransfers && !cloudHasTransfers) {
      winningSnapshot = tc.localCached;
    } else {
      winningSnapshot = cloudSnapData;
    }
  } else if (hasCloudSnapshot) {
    winningSnapshot = cloudSnapData;
  } else if (hasLocalSnapshot) {
    winningSnapshot = tc.localCached;
  }

  assert.ok(winningSnapshot, `${tc.name}: winningSnapshot must not be null`);
  const hydrated = hydrateFixablySnapshot(winningSnapshot);

  assert.strictEqual(hydrated.items.length, expectedUnits, `${tc.name}: Must maintain ${expectedUnits} units`);
  assert.strictEqual(hydrated.transfers.length, expectedTransfers, `${tc.name}: Must maintain ${expectedTransfers} transfers`);
  assert.strictEqual(hydrated.siteToSiteTransfers.length, expectedSiteToSite, `${tc.name}: Must maintain ${expectedSiteToSite} site-to-site transfers`);
  assert.strictEqual(hydrated.globalMetrics.totalUnits, expectedUnits, `${tc.name}: globalMetrics.totalUnits must match`);
  assert.ok(hydrated.globalMetrics.sitesCount > 0, `${tc.name}: globalMetrics.sitesCount must be > 0`);
  assert.ok(hydrated.globalMetrics.totalValue > 0, `${tc.name}: globalMetrics.totalValue must be > 0`);

  console.log(`  ✓ Passed case: ${tc.name}`);
}

console.log('\n=== ALL POST-REFRESH REVERT PREVENTION TESTS PASSED 100%! ===\n');
