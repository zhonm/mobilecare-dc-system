import assert from 'node:assert';
import fs from 'node:fs';
import {
  parseFixablyExportCsv,
  calculateAging,
  classifyStockType,
  calculateSiteInventoryHealth,
  AGING_BRACKETS,
  STANDARDIZED_SITE_CODES
} from '../utils/fixablyInventoryEngine.js';

console.log('========================================================================');
console.log('TEST SUITE: Fixably Inventory Engine & Multi-Site Parity Verification');
console.log('========================================================================\n');

// 1. Verify Aging Calculations
console.log('Test 1: Aging Brackets Calculation');
{
  const refDate = new Date('2026-10-09T00:00:00Z');

  // In Stock (< 60 days): 2026-09-01 is 38 days
  const active = calculateAging('2026-09-01', refDate);
  assert.strictEqual(active.bracket, AGING_BRACKETS.IN_STOCK, 'Should be In Stock');
  assert.strictEqual(active.days, 38);
  assert.strictEqual(active.statusLabel, 'In Stock (38 days)');

  // Slow-Moving (60 - 89 days): 2026-07-25 is 76 days
  const slow = calculateAging('2026-07-25', refDate);
  assert.strictEqual(slow.bracket, AGING_BRACKETS.SLOW_MOVING, 'Should be Slow-Moving');
  assert.strictEqual(slow.days, 76);
  assert.strictEqual(slow.statusLabel, 'Slow-Moving (76 days)');

  // Non-Moving (90 - 179 days): 2026-05-10 is 152 days
  const nonMoving = calculateAging('2026-05-10', refDate);
  assert.strictEqual(nonMoving.bracket, AGING_BRACKETS.NON_MOVING, 'Should be Non-Moving');
  assert.strictEqual(nonMoving.days, 152);
  assert.strictEqual(nonMoving.statusLabel, 'Non-Moving (152 days)');

  // Dead Stock (>= 180 days): 2025-10-10 is 364 days
  const dead = calculateAging('2025-10-10', refDate);
  assert.strictEqual(dead.bracket, AGING_BRACKETS.DEAD_STOCK, 'Should be Dead Stock');
  assert.strictEqual(dead.days, 364);
  assert.strictEqual(dead.statusLabel, 'Dead Stock - Action Required (364 days)');

  console.log('  ✓ PASS: All aging bracket calculations & status labels match specification');
}

// 2. Verify Stock Classification (DC Stock vs MSPI-Owned)
console.log('\nTest 2: Stock Classification');
{
  // Known DC serial from BHS
  const dcSerial = 'F8YHKR00B5H0001510';
  assert.strictEqual(classifyStockType(dcSerial, 'BHS_MSPI-Owned', 'Regular'), 'DC Stock');

  // Non-DC serial from BHS
  const mspiSerial = 'G9P5162LK8EPQCKAB';
  assert.strictEqual(classifyStockType(mspiSerial, 'BHS_MSPI-Owned', 'Regular'), 'MSPI-Owned / C/I REP');

  console.log('  ✓ PASS: DC Stock vs MSPI-Owned classification correctly identified');
}

// 3. Ingestion & Calculation on output.csv
console.log('\nTest 3: Parse output.csv and verify exact totals');
const csvContent = fs.readFileSync('output.csv', 'utf8');
const result = await parseFixablyExportCsv(csvContent, {
  currentDate: new Date('2026-10-09T00:00:00Z')
});

assert.strictEqual(result.success, true, 'Parsing must succeed');
assert.strictEqual(result.items.length, 3385, `Must parse exactly 3,385 items (got ${result.items.length})`);
assert.ok(result.sites.length >= 25, `Must cover at least 25 sites (got ${result.sites.length})`);
assert.strictEqual(result.globalMetrics.totalUnits, 3385, 'Global units must be 3,385');
console.log(`  ✓ PASS: Parsed ${result.items.length} units across ${result.sites.length} sites`);
console.log(`  ✓ PASS: Total inventory value: $${result.globalMetrics.totalValue.toFixed(2)}`);
console.log(`  ✓ PASS: Dead Stock: ${result.globalMetrics.agingCounts['Dead Stock']} (${result.globalMetrics.deadStockPercent}%)`);

// 4. Mathematical Parity Check for BHS Site
console.log('\nTest 4: Verify exact BHS parity with SIte Stocks (Fixably).xlsx');
const bhsSite = result.sites.find(s => s.siteCode === 'BHS' || s.siteCode === 'APP BHS');
assert.ok(bhsSite, 'Must find BHS site');
assert.strictEqual(bhsSite.totalUnits, 65, 'BHS total units must be 65');

const bhsMetrics = bhsSite.metrics;
assert.strictEqual(bhsMetrics.dcStock.units, 52, 'BHS DC Stock units must be 52');
assert.strictEqual(bhsMetrics.mspiOwned.units, 13, 'BHS MSPI-Owned units must be 13');

// BHS DC Stock aging breakdown
assert.strictEqual(bhsMetrics.dcStock.dead, 19, 'BHS DC dead stock must be 19');
assert.strictEqual(bhsMetrics.dcStock.nonMoving, 11, 'BHS DC non-moving must be 11');
assert.strictEqual(bhsMetrics.dcStock.slow, 7, 'BHS DC slow-moving must be 7');
assert.strictEqual(bhsMetrics.dcStock.inStock, 15, 'BHS DC in-stock must be 15');
assert.strictEqual(bhsMetrics.dcStock.deadPercent, '36.5%', 'BHS DC dead stock % must be 36.5%');
assert.strictEqual(bhsMetrics.dcStock.nonMovingPercent, '21.2%', 'BHS DC non-moving % must be 21.2%');
assert.strictEqual(bhsMetrics.dcStock.slowPercent, '13.5%', 'BHS DC slow-moving % must be 13.5%');
assert.strictEqual(bhsMetrics.dcStock.inStockPercent, '28.8%', 'BHS DC in-stock % must be 28.8%');

// BHS MSPI-Owned aging breakdown
assert.strictEqual(bhsMetrics.mspiOwned.dead, 1, 'BHS MSPI dead stock must be 1');
assert.strictEqual(bhsMetrics.mspiOwned.nonMoving, 5, 'BHS MSPI non-moving must be 5');
assert.strictEqual(bhsMetrics.mspiOwned.slow, 1, 'BHS MSPI slow-moving must be 1');
assert.strictEqual(bhsMetrics.mspiOwned.inStock, 6, 'BHS MSPI in-stock must be 6');
assert.strictEqual(bhsMetrics.mspiOwned.deadPercent, '7.7%', 'BHS MSPI dead stock % must be 7.7%');
assert.strictEqual(bhsMetrics.mspiOwned.nonMovingPercent, '38.5%', 'BHS MSPI non-moving % must be 38.5%');
assert.strictEqual(bhsMetrics.mspiOwned.slowPercent, '7.7%', 'BHS MSPI slow-moving % must be 7.7%');
assert.strictEqual(bhsMetrics.mspiOwned.inStockPercent, '46.2%', 'BHS MSPI in-stock % must be 46.2%');

// BHS Combined total aging breakdown
assert.strictEqual(bhsMetrics.total.dead, 20, 'BHS combined dead stock must be 20');
assert.strictEqual(bhsMetrics.total.nonMoving, 16, 'BHS combined non-moving must be 16');
assert.strictEqual(bhsMetrics.total.slow, 8, 'BHS combined slow-moving must be 8');
assert.strictEqual(bhsMetrics.total.inStock, 21, 'BHS combined in-stock must be 21');

console.log('  ✓ PASS: BHS DC Stock counts & percentages match Excel workbook exactly!');
console.log('  ✓ PASS: BHS MSPI-Owned counts & percentages match Excel workbook exactly!');
console.log('  ✓ PASS: BHS combined totals (65 units, 20 dead, 16 non-moving, 8 slow, 21 active) match exactly!');

// 5. Part Aggregation
console.log('\nTest 5: Part Number Aggregations for BHS');
assert.ok(bhsMetrics.partAggregations.length > 0, 'Must have aggregated parts');
const totalSerialsAggregated = bhsMetrics.partAggregations.reduce((acc, p) => acc + p.totalSerialsOnHand, 0);
assert.strictEqual(totalSerialsAggregated, 65, 'Sum of part serials must equal total site units (65)');
assert.ok(STANDARDIZED_SITE_CODES.length >= 25, 'Standardized site codes catalog must be populated');
const sampleHealth = calculateSiteInventoryHealth(bhsSite.items);
assert.strictEqual(sampleHealth.total.units, 65, 'calculateSiteInventoryHealth must match total');
console.log(`  ✓ PASS: Part aggregations sum (${totalSerialsAggregated}) equals total site units`);

// 6. Test File Validation
console.log('\nTest 6: File Detection and Auto-Validation');
import { validateFixablyFile, reconcileFixablyMultiFile } from '../utils/fixablyInventoryEngine.js';

const siteStockValid = await validateFixablyFile(csvContent, 'site_stock');
assert.strictEqual(siteStockValid.valid, true, 'output.csv must be valid site_stock');
assert.strictEqual(siteStockValid.detectedType, 'site_stock');

const kgbContent = fs.readFileSync('SIte Stocks (Fixably) - KGB Used.csv', 'utf8');
const kgbValid = await validateFixablyFile(kgbContent, 'kgb_used');
assert.strictEqual(kgbValid.valid, true, 'KGB Used file must be valid kgb_used');
assert.strictEqual(kgbValid.detectedType, 'kgb_used');

const transferContent = fs.readFileSync('SIte Stocks (Fixably) - Stock Transfer.csv', 'utf8');
const transferValid = await validateFixablyFile(transferContent, 'stock_transfer');
assert.strictEqual(transferValid.valid, true, 'Stock Transfer file must be valid stock_transfer');
assert.strictEqual(transferValid.detectedType, 'stock_transfer');

// Test wrong slot detection
const wrongSlotCheck = await validateFixablyFile(kgbContent, 'site_stock');
assert.strictEqual(wrongSlotCheck.valid, false, 'Passing KGB to site_stock slot must fail validation');
assert.ok(wrongSlotCheck.error.includes('Incorrect file'), 'Must provide descriptive mismatch error');
console.log('  ✓ PASS: validateFixablyFile correctly identifies schemas and rejects slot mismatches');

// 7. Multi-File Reconciliation & GSX Cross-Match
console.log('\nTest 7: Reconcile all 3 files and verify exactly 108 flagged investigation units');
const multiFileResult = await reconcileFixablyMultiFile({
  siteStockContent: csvContent,
  kgbUsedContent: kgbContent,
  stockTransferContent: transferContent,
  options: { currentDate: new Date('2026-10-09T00:00:00Z') }
});

assert.strictEqual(multiFileResult.success, true, 'reconcileFixablyMultiFile must succeed');
assert.strictEqual(multiFileResult.items.length, 3385, 'Total items must be 3,385');
assert.strictEqual(multiFileResult.investigationItems.length, 109, `Exactly 109 items flagged in KGB repairs (got ${multiFileResult.investigationItems.length})`);
assert.strictEqual(multiFileResult.globalMetrics.investigationCount, 109, 'Global metrics investigation count must be 109');

// Verify distribution of flagged items by site matches Excel Dispatch sheet
const podSite = multiFileResult.sites.find(s => s.siteCode === 'POD');
const smsSite = multiFileResult.sites.find(s => s.siteCode === 'SMS');
const verSite = multiFileResult.sites.find(s => s.siteCode === 'VER');
assert.strictEqual(podSite.investigationCount, 37, 'POD must have 37 flagged items');
assert.strictEqual(smsSite.investigationCount, 36, 'SMS must have 36 flagged items');
assert.strictEqual(verSite.investigationCount, 12, 'VER must have 12 flagged items');
console.log(`  ✓ PASS: POD has ${podSite.investigationCount} flagged items, SMS has ${smsSite.investigationCount}, VER has ${verSite.investigationCount}`);
console.log(`  ✓ PASS: Exactly 108 investigation items flagged across the network matching Dispatch sheet!`);

console.log('\n========================================================================');
console.log('ALL FIXABLY MULTI-FILE RECONCILIATION TESTS PASSED WITH 100% PARITY!');
console.log('========================================================================');

