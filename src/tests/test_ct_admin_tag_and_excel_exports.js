import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  updateToolAssetMetadata,
  validateAndScanPackItem
} from '../utils/consumablesToolsEngine.js';
import {
  buildCtCenterExcelBuffer,
  buildCtMovementsExcelBuffer
} from '../utils/ctExcelExporter.js';

async function runTests() {
  console.log('====================================================');
  console.log('TEST SUITE: CT Admin Asset Tag, Assignee & Excel Exports');
  console.log('====================================================');

  // ── 1. updateToolAssetMetadata: Edit Admin Tag & Assignee + Duplicate Guard ──
  const seedAssets = [
    {
      id: 'asset-1',
      catalog_id: 'cat-1',
      asset_tag: 'MDC-TL-92309176-0001',
      admin_asset_tag: null,
      serial_number: 'SN-TL-001',
      part_number: '923-09176',
      description: 'Adhesive Removal Tool, iPhone',
      site_code: 'ASP LAU',
      status: 'available',
      assigned_to: null,
      updated_at: '2026-11-19T01:00:00.000Z'
    },
    {
      id: 'asset-2',
      catalog_id: 'cat-2',
      asset_tag: 'MDC-TL-9230246-0001',
      admin_asset_tag: null,
      serial_number: 'SN-TL-002',
      part_number: '923-0246',
      description: 'Tool, Crosshead (JCIS) 44 mm half-moon bit',
      site_code: 'APP MOA',
      status: 'in_use',
      assigned_to: 'Juan Dela Cruz',
      updated_at: '2026-11-19T01:00:00.000Z'
    }
  ];

  const editRes = updateToolAssetMetadata({
    toolAssets: seedAssets,
    assetId: 'asset-1',
    adminAssetTag: 'ADM-LAU-001',
    assignedTo: 'Maria Santos',
    actorName: 'Zhon Manaois'
  });
  assert.strictEqual(editRes.ok, true);
  assert.strictEqual(editRes.changed, true);
  assert.strictEqual(editRes.updatedAsset.admin_asset_tag, 'ADM-LAU-001');
  assert.strictEqual(editRes.updatedAsset.assigned_to, 'Maria Santos');
  assert.strictEqual(editRes.movement.action, 'updated');
  assert.ok(editRes.movement.asset_tags.includes('MDC-TL-92309176-0001'));
  assert.ok(editRes.movement.asset_tags.includes('ADM-LAU-001'));

  // Idempotent no-op when values are unchanged
  const noopRes = updateToolAssetMetadata({
    toolAssets: editRes.nextToolAssets,
    assetId: 'asset-1',
    adminAssetTag: 'ADM-LAU-001',
    assignedTo: 'Maria Santos',
    actorName: 'Zhon Manaois'
  });
  assert.strictEqual(noopRes.ok, true);
  assert.strictEqual(noopRes.changed, false);
  assert.strictEqual(noopRes.movement, null);

  // Duplicate Admin Asset Tag guard (case-insensitive)
  const dupRes = updateToolAssetMetadata({
    toolAssets: editRes.nextToolAssets,
    assetId: 'asset-2',
    adminAssetTag: 'adm-lau-001',
    assignedTo: 'Juan Dela Cruz',
    actorName: 'Zhon Manaois'
  });
  assert.strictEqual(dupRes.ok, false);
  assert.strictEqual(dupRes.errorCode, 'DUPLICATE_ADMIN_TAG');
  console.log('  ✓ PASS: Admin Asset Tag & Assigned To update, audit log, no-op & duplicate guard verified');

  // ── 2. Packing Scan-Out recognizes Admin Asset Tag ───────────────────────
  const scanRes = validateAndScanPackItem({
    scanToken: 'ADM-LAU-001',
    targetSiteCode: 'ASP LAU',
    fromSiteCode: 'DC-MDC',
    catalogItems: [
      { id: 'cat-1', part_number: '923-09176', description: 'Adhesive Removal Tool, iPhone', item_kind: 'tool', is_serialized: true }
    ],
    stockRows: [],
    toolAssets: editRes.nextToolAssets,
    orders: [],
    existingShipments: [],
    stagedLines: []
  });
  assert.strictEqual(scanRes.ok, true, 'Scanning Admin Asset Tag must match the tool asset');
  assert.strictEqual(scanRes.packedPartNumber, '923-09176');
  console.log('  ✓ PASS: Packing Scan-Out recognizes Admin Asset Tag');

  // ── 3. Consumables & Service Tools Center Excel Export (Site Filter vs All Sites) ──
  const sampleStock = [
    { part_number: '923-14100', description: 'Adhesive, Display, iPhone 15', site_code: 'ASP LAU', qty_on_hand: 5, reorder_level: 2 },
    { part_number: '923-03045', description: 'Adhesive, Battery, iPhone 14', site_code: 'APP MOA', qty_on_hand: 2, reorder_level: 3 }
  ];

  // 3a. Specific site filter: ASP LAU
  const lauBuf = await buildCtCenterExcelBuffer({
    toolAssets: editRes.nextToolAssets,
    consumablesStock: sampleStock,
    siteFilter: 'ASP LAU',
    generatedBy: 'Zhon Manaois'
  });
  const lauWb = new ExcelJS.Workbook();
  await lauWb.xlsx.load(lauBuf);
  assert.deepStrictEqual(
    lauWb.worksheets.map(w => w.name),
    ['Summary', 'Tracked Tool Units', 'Consumables Stock']
  );
  const lauToolsWs = lauWb.getWorksheet('Tracked Tool Units');
  assert.strictEqual(lauToolsWs.rowCount, 2, 'ASP LAU filter must include only 1 tool row + header');
  assert.strictEqual(lauToolsWs.getRow(2).getCell(1).value, 'MDC-TL-92309176-0001');
  assert.strictEqual(lauToolsWs.getRow(2).getCell(2).value, 'ADM-LAU-001');
  assert.strictEqual(lauToolsWs.getRow(2).getCell(8).value, 'Maria Santos');

  const lauConsWs = lauWb.getWorksheet('Consumables Stock');
  assert.strictEqual(lauConsWs.rowCount, 2, 'ASP LAU filter must include only 1 consumable row + header');
  assert.strictEqual(lauConsWs.getRow(2).getCell(1).value, 'ASP LAU');

  // Verify Summary sheet itself includes Part Number & Description details (not just bare site counts)
  const lauSummaryTexts = [];
  lauWb.getWorksheet('Summary').eachRow((r) => {
    r.eachCell((c) => lauSummaryTexts.push(String(c.value || '')));
  });
  assert.ok(lauSummaryTexts.includes('923-09176'), 'Center Summary sheet must include tool Part Number');
  assert.ok(lauSummaryTexts.includes('Adhesive Removal Tool, iPhone'), 'Center Summary sheet must include tool Description');
  assert.ok(lauSummaryTexts.includes('923-14100'), 'Center Summary sheet must include consumable Part Number');
  assert.ok(lauSummaryTexts.includes('Adhesive, Display, iPhone 15'), 'Center Summary sheet must include consumable Description');

  // 3b. All Sites filter
  const allBuf = await buildCtCenterExcelBuffer({
    toolAssets: editRes.nextToolAssets,
    consumablesStock: sampleStock,
    siteFilter: 'ALL',
    generatedBy: 'Zhon Manaois'
  });
  const allWb = new ExcelJS.Workbook();
  await allWb.xlsx.load(allBuf);
  assert.strictEqual(allWb.getWorksheet('Tracked Tool Units').rowCount, 3, 'All Sites must include both tools + header');
  assert.strictEqual(allWb.getWorksheet('Consumables Stock').rowCount, 3, 'All Sites must include both consumables + header');
  console.log('  ✓ PASS: Consumables & Service Tools Center Excel export respects site filter & All Sites');

  // ── 4. CT Movement & Shipment Archive Excel Export ───────────────────────
  const movBuf = await buildCtMovementsExcelBuffer({
    movements: [editRes.movement],
    shipments: [
      {
        id: 'shp-1',
        packing_list_number: 'CT-PL-202611-0001',
        ts_number: '2323232',
        status: 'shipped',
        shipment_date: '2026-11-19',
        from_site_code: 'DC-MDC',
        to_site_code: 'ASP LAU',
        to_site_name: 'MOBILECARE - LA UNION',
        carrier: 'Lite Express (Land)',
        tracking_number: '2323723',
        prepared_by_name: 'Zhon Manaois',
        items: [{ part_number: '923-09176', description: 'Adhesive Removal Tool, iPhone', quantity: 4 }]
      }
    ],
    generatedBy: 'Zhon Manaois'
  });
  const movWb = new ExcelJS.Workbook();
  await movWb.xlsx.load(movBuf);
  assert.deepStrictEqual(
    movWb.worksheets.map(w => w.name),
    ['Movement Summary', 'All Item Movements', 'Shipments Archive']
  );
  assert.strictEqual(movWb.getWorksheet('All Item Movements').rowCount, 2);
  assert.strictEqual(movWb.getWorksheet('Shipments Archive').rowCount, 2);
  const movSummaryTexts = [];
  movWb.getWorksheet('Movement Summary').eachRow((r) => {
    r.eachCell((c) => movSummaryTexts.push(String(c.value || '')));
  });
  assert.ok(movSummaryTexts.includes('923-09176'), 'Movement Summary sheet must include Part Number');
  assert.ok(movSummaryTexts.includes('Adhesive Removal Tool, iPhone'), 'Movement Summary sheet must include Description');
  console.log('  ✓ PASS: CT Movement & Shipment Archive 3-sheet Excel export verified');

  // ── 5. UI Wiring Checks ──────────────────────────────────────────────────
  const ctModuleSrc = fs.readFileSync(path.resolve('src/components/ConsumablesToolsModule.jsx'), 'utf8');
  assert.ok(ctModuleSrc.includes('System Asset Tag'), 'ConsumablesToolsModule must display System Asset Tag column');
  assert.ok(ctModuleSrc.includes('Admin Asset Tag'), 'ConsumablesToolsModule must display Admin Asset Tag column');
  assert.ok(ctModuleSrc.includes('handleExportCenterExcel'), 'ConsumablesToolsModule must wire Center Excel export');
  assert.ok(ctModuleSrc.includes('handleExportMovementsExcel'), 'ConsumablesToolsModule must wire Movements Excel export');
  assert.ok(ctModuleSrc.includes('historyDateFrom'), 'CT Movement Archive must include Date Range filter');
  console.log('  ✓ PASS: UI wiring checks verified');
  console.log('ALL CT ADMIN TAG, ASSIGNEE & EXCEL EXPORT TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ FAIL:', err);
  process.exit(1);
});
