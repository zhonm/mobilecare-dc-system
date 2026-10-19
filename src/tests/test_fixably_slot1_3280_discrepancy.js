import assert from 'node:assert';
import fs from 'node:fs';
import { validateFixablyFile, reconcileFixablyMultiFile } from '../utils/fixablyInventoryEngine.js';

console.log('========================================================================');
console.log('TEST SUITE: Fixably Slot 1 3,280 Exact Inventory Parity & Discrepancy Fix');
console.log('========================================================================\n');

const csvPath = 'xlsx files/_2026 Site Stocks (Fixably) - Site Stock.csv';
assert.ok(fs.existsSync(csvPath), '_2026 Site Stocks (Fixably) - Site Stock.csv must exist');

const csvContent = fs.readFileSync(csvPath, 'utf8');

// Test 1: validateFixablyFile accurately calculates 3,280 inventory units
console.log('--- Test 1: validateFixablyFile accurately accounts for title line & quantities ---');
const validation = await validateFixablyFile(csvContent, 'site_stock');
assert.strictEqual(validation.valid, true, 'File must validate as site_stock');
assert.strictEqual(validation.detectedType, 'site_stock', 'Detected type must be site_stock');
assert.strictEqual(validation.rowCount, 3280, `Must calculate exactly 3,280 inventory units (got ${validation.rowCount})`);
console.log('  ✓ PASS: validateFixablyFile returns exactly 3,280 inventory units matching raw file');

// Test 2: reconcileFixablyMultiFile imports exactly 3,280 inventory unit records
console.log('\n--- Test 2: reconcileFixablyMultiFile produces exactly 3,280 units with accurate values ---');
const reconcileRes = await reconcileFixablyMultiFile({
  siteStockContent: csvContent,
  options: { currentDate: new Date('2026-10-09T00:00:00Z'), expandQuantity: true }
});

assert.strictEqual(reconcileRes.success, true, 'Reconciliation must succeed');
assert.strictEqual(reconcileRes.items.length, 3280, `Items length must be exactly 3,280 (got ${reconcileRes.items.length})`);
assert.strictEqual(reconcileRes.globalMetrics.totalUnits, 3280, `Global total units must be exactly 3,280 (got ${reconcileRes.globalMetrics.totalUnits})`);
assert.strictEqual(reconcileRes.globalMetrics.uniqueParts, 140, 'Unique catalog parts must be 140');
assert.ok(Math.abs(reconcileRes.globalMetrics.totalValue - 814871.65) < 0.01, 'Total value must equal $814,871.65');
console.log('  ✓ PASS: Reconciled 3,280 items matching the 3,280 units in the raw file');
console.log(`  ✓ PASS: Total value $${reconcileRes.globalMetrics.totalValue.toFixed(2)} perfectly preserved`);

// Test 3: Standard single-unit rows compatibility
console.log('\n--- Test 3: Backward compatibility with standard single-header CSVs ---');
const sampleCsv = [
  'Stock Name,Part Number,Serial Number,Description,Last Received Date,Stock Type',
  'MOBILECARE - APP BONIFACIO HIGH STREET,661-12345,C02TEST0001,Display Assembly,2026-10-01,MSPI-owned',
  'MOBILECARE - APP BONIFACIO HIGH STREET,661-12346,C02TEST0002,Battery,2026-09-15,MSPI-owned',
  'MOBILECARE - APP MEGAMALL,661-12347,C02TEST0003,Top Case,2026-08-20,MSPI-owned'
].join('\n');

const sampleVal = await validateFixablyFile(sampleCsv, 'site_stock');
assert.strictEqual(sampleVal.rowCount, 3, 'Sample must have 3 rows');

const sampleRes = await reconcileFixablyMultiFile({
  siteStockContent: sampleCsv,
  options: { currentDate: new Date('2026-10-09T00:00:00Z'), expandQuantity: true }
});
assert.strictEqual(sampleRes.items.length, 3, 'Sample must produce 3 items');
console.log('  ✓ PASS: Standard CSVs with no title line parse with 100% fidelity');

console.log('\n========================================================================');
console.log('ALL FIXABLY 3,280 DISCREPANCY & PARITY TESTS PASSED (100%)!');
console.log('========================================================================\n');
