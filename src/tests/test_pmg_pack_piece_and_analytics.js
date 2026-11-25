import assert from 'assert';
import ExcelJS from 'exceljs';
import {
  detectPackSizeFromDescription,
  validateAndReceiveOrderLine,
  consumeConsumableStock,
  adjustConsumableStock,
  computeConsumableUsageAnalytics
} from '../utils/consumablesToolsEngine.js';
import { buildCtCenterExcelBuffer } from '../utils/ctExcelExporter.js';

async function run() {
  console.log('========================================================================');
  console.log('TEST SUITE: Pack-to-Piece Consumables, Adjustments, Alerts & DC Export');
  console.log('========================================================================\n');

  // --- Test 1: Pack size detection from description ---
  console.log('--- Test 1: Auto-detect pack size from description ---');
  assert.strictEqual(detectPackSizeFromDescription('SVC, IPHONE DUO, ADHESIVE, RENO, 10PK'), 10);
  assert.strictEqual(detectPackSizeFromDescription('SVC, IPHONE DUO, ADHESIVE, BTH, 30PK'), 30);
  assert.strictEqual(detectPackSizeFromDescription('SVC, IPHONE DUO, SLED CLOSE'), 1);
  console.log('  ✓ PASS: Pack sizes auto-detected accurately (10PK -> 10, 30PK -> 30, single -> 1)');

  // --- Test 2: Receive 2 packs of 10PK -> 20 individual pieces, then deduct 3 individual pieces -> 17 pcs (1 full pk + 7 loose) ---
  console.log('\n--- Test 2: Receive packs, auto-convert to pieces, deduct individual pieces ---');
  const catalog = [
    {
      id: 'cat-reno',
      part_number: '923-15261',
      description: 'SVC, IPHONE DUO, ADHESIVE, RENO, 10PK',
      item_kind: 'consumable',
      ownership_tag: 'Apple-Owned',
      min_stock_threshold: 5
    }
  ];

  const recv = validateAndReceiveOrderLine({
    order: null,
    partNumber: '923-15261',
    deliveredQty: 2,
    scannedSerials: [],
    siteCode: 'APP PPM',
    catalogItems: catalog,
    stockRows: [],
    toolAssets: [],
    actorName: 'DC Receiver',
    allowAdHoc: true
  });
  assert.strictEqual(recv.ok, true);
  assert.strictEqual(recv.updatedStockRow.pack_size, 10);
  assert.strictEqual(recv.updatedStockRow.individual_qty_on_hand, 20, '2 packs of 10PK must convert to 20 individual pieces');

  const deductRes = consumeConsumableStock({
    catalogItems: catalog,
    stockRows: recv.nextStockRows,
    partNumber: '923-15261',
    siteCode: 'APP PPM',
    quantity: 3,
    unitMode: 'piece',
    actorName: 'Jose Rizal (PMG)',
    notes: 'GSX Repair #G60123456'
  });
  assert.strictEqual(deductRes.ok, true);
  assert.strictEqual(deductRes.breakdown.individualUnits, 17, '20 - 3 must equal 17 pieces');
  assert.strictEqual(deductRes.breakdown.fullPacks, 1, '17 pieces of 10PK = 1 full pack');
  assert.strictEqual(deductRes.breakdown.looseUnits, 7, '17 pieces of 10PK = 7 loose pieces');
  assert.strictEqual(deductRes.movement.action, 'consumed');
  assert.strictEqual(deductRes.movement.quantity, 3);
  assert.strictEqual(deductRes.movement.performed_by_name, 'Jose Rizal (PMG)');
  console.log('  ✓ PASS: 2 packs (20 pcs) - 3 pcs = 17 pcs (1 full pk + 7 loose pcs) with full audit trail');

  // --- Test 3: Low-stock alert trigger when deducting below threshold ---
  console.log('\n--- Test 3: Low-stock warning triggers when reaching threshold ---');
  const lowDeduct = consumeConsumableStock({
    catalogItems: catalog,
    stockRows: deductRes.nextStockRows,
    partNumber: '923-15261',
    siteCode: 'APP PPM',
    quantity: 13,
    unitMode: 'piece',
    actorName: 'Jose Rizal (PMG)',
    notes: 'Weekly bench repairs'
  });
  assert.strictEqual(lowDeduct.ok, true);
  assert.strictEqual(lowDeduct.breakdown.individualUnits, 4);
  assert.strictEqual(lowDeduct.breakdown.isLowStock, true, '4 pcs <= 5 threshold must trigger isLowStock');
  assert.strictEqual(lowDeduct.lowStockAlert, true);
  console.log('  ✓ PASS: Low-stock alert triggered at 4 pcs remaining (threshold 5 pcs)');

  // --- Test 4: Inventory adjustment corrects discrepancy & logs audit trail ---
  console.log('\n--- Test 4: Inventory adjustment feature ---');
  const adjRes = adjustConsumableStock({
    catalogItems: catalog,
    stockRows: lowDeduct.nextStockRows,
    stockId: lowDeduct.updatedStockRow.id,
    newQty: 12,
    unitMode: 'piece',
    packSize: 10,
    minStockThreshold: 6,
    reason: 'Physical Cycle Count',
    notes: 'Found unopened pack in drawer',
    actorName: 'Branch Supervisor'
  });
  assert.strictEqual(adjRes.ok, true);
  assert.strictEqual(adjRes.deltaPieces, 8, '4 -> 12 pcs is +8 delta');
  assert.strictEqual(adjRes.breakdown.individualUnits, 12);
  assert.strictEqual(adjRes.breakdown.fullPacks, 1);
  assert.strictEqual(adjRes.breakdown.looseUnits, 2);
  assert.strictEqual(adjRes.movement.action, 'adjusted');
  assert.strictEqual(adjRes.movement.performed_by_name, 'Branch Supervisor');
  console.log('  ✓ PASS: Stock adjusted 4 -> 12 pcs (+8 delta) with audit trail entry');

  // --- Test 5: Usage analytics & DC multi-sheet Excel export ---
  console.log('\n--- Test 5: Usage analytics & DC Excel export workbook ---');
  const movements = [deductRes.movement, lowDeduct.movement, adjRes.movement];
  const analytics = computeConsumableUsageAnalytics(lowDeduct.nextStockRows, movements, { siteCode: 'APP PPM', days: 30 });
  assert.strictEqual(analytics.totalPiecesConsumed, 16, '3 + 13 = 16 total pieces consumed');
  assert.strictEqual(analytics.topConsumed.length, 1);
  assert.strictEqual(analytics.lowStockAlerts.length, 1);
  assert.strictEqual(analytics.auditLog.length, 3);

  const buf = await buildCtCenterExcelBuffer({
    toolAssets: [],
    consumablesStock: lowDeduct.nextStockRows,
    movements,
    catalog,
    siteFilter: 'ALL',
    generatedBy: 'DC Admin'
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheetNames = wb.worksheets.map(w => w.name);
  assert(sheetNames.includes('Consumables Stock'), 'Workbook must include Consumables Stock sheet');
  assert(sheetNames.includes('Low-Stock Alerts'), 'Workbook must include Low-Stock Alerts sheet');
  assert(sheetNames.includes('Usage & Audit Trail'), 'Workbook must include Usage & Audit Trail sheet');
  assert(sheetNames.includes('Consumption Trends'), 'Workbook must include Consumption Trends sheet');
  console.log(`  ✓ PASS: DC Excel workbook generated with sheets: ${sheetNames.join(', ')}`);

  console.log('\n========================================================================');
  console.log('ALL PACK-TO-PIECE, ADJUSTMENT, ALERTS & DC EXPORT TESTS PASSED (100%)');
  console.log('========================================================================\n');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
