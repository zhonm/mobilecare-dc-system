import assert from 'assert';
import * as XLSX from 'xlsx';
import { exportPmgBranchInventoryToExcel } from '../utils/stockExportUtils.js';
import { parseScanInPartsFile } from '../utils/excelParser.js';

console.log('====================================================');
console.log('TEST SUITE: PMG Receive Scan-In XLSX Export & Import Integration');
console.log('====================================================');

async function runTests() {
  const samplePmgUnits = [
    {
      id: 'unit-pmg-1',
      dateKey: '2026-09-10',
      timeStr: '14:45:08',
      received_at: '2026-09-10T06:45:08.000Z',
      category_name: 'Battery',
      part_number: '661-39373',
      description: 'Battery, iPhone 14',
      iphone_model: 'iPhone 14',
      serial_number: 'F8Y6234C9AR231LB3',
      site_code: 'ASP ZAM',
      intake_source: 'Barcode Scan',
      isImported: false
    },
    {
      id: 'unit-pmg-2',
      dateKey: '2026-09-10',
      timeStr: '14:50:22',
      received_at: '2026-09-10T06:50:22.000Z',
      category_name: 'Display',
      part_number: '661-30401',
      description: 'Display, iPhone 14 Pro Max',
      iphone_model: 'iPhone 14 Pro Max',
      serial_number: 'GH371284920000MUZ',
      site_code: 'ASP ZAM',
      intake_source: 'Spreadsheet Import',
      isImported: true
    },
    {
      id: 'unit-pmg-3',
      dateKey: '2026-09-10',
      timeStr: '15:10:00',
      received_at: '2026-09-10T07:10:00.000Z',
      category_name: 'Battery',
      part_number: '661-21991',
      description: 'Battery, iPhone 13',
      iphone_model: 'iPhone 13',
      serial_number: 'PROTECTED-SERIAL',
      site_code: 'ASP ZAM',
      intake_source: 'Barcode Scan',
      isImported: false
    }
  ];

  const sampleSummary = [
    {
      part_number: '661-39373',
      description: 'Battery, iPhone 14',
      iphone_model: 'iPhone 14',
      category_name: 'Battery',
      site_code: 'ASP ZAM',
      total_qty: 1
    },
    {
      part_number: '661-30401',
      description: 'Display, iPhone 14 Pro Max',
      iphone_model: 'iPhone 14 Pro Max',
      category_name: 'Display',
      site_code: 'ASP ZAM',
      total_qty: 1
    },
    {
      part_number: '661-21991',
      description: 'Battery, iPhone 13',
      iphone_model: 'iPhone 13',
      category_name: 'Battery',
      site_code: 'ASP ZAM',
      total_qty: 1
    }
  ];

  // ── Test 1: Workbook Generation & Multi-Sheet Architecture ─────────────────
  console.log('\n--- 1. Testing Workbook Generation & Multi-Sheet Structure ---');
  const { workbook, buffer, fileName } = await exportPmgBranchInventoryToExcel({
    items: samplePmgUnits,
    summaryItems: sampleSummary,
    siteCode: 'ASP ZAM',
    siteName: 'MOBILECARE - ZAMBOANGA (ASP ZAM)',
    userName: 'Andres Bonifacio',
    pmgViewMode: 'my_added'
  });

  assert.ok(workbook, 'Workbook must be generated');
  assert.ok(buffer && buffer.byteLength > 0, 'Buffer must be valid');
  assert.ok(fileName.includes('ASP_ZAM_Parts_Inventory_'), `Filename must include branch code: got ${fileName}`);

  const sheetNames = workbook.worksheets.map(w => w.name);
  console.log('Generated sheets in workbook:', sheetNames);
  assert.ok(sheetNames.some(name => name.includes('Inventory')), 'Should contain branch inventory sheet');
  assert.ok(sheetNames.includes('Parts Summary'), 'Should contain Parts Summary sheet');
  assert.ok(sheetNames.includes('Import Template Guide'), 'Should contain Import Template Guide sheet');
  console.log('  ✓ PASS: Multi-sheet architecture (Inventory, Summary, Import Guide) verified');

  // ── Test 2: Sheet 1 Column Headers and 12-Hour Time Format ─────────────────
  console.log('\n--- 2. Testing Sheet 1 Headers and 12-Hour Time Formatting ---');
  const ws1 = workbook.getWorksheet(sheetNames.find(n => n.includes('Inventory')));
  const headerRow1 = ws1.getRow(4);
  const expectedHeaders1 = [
    '#',
    'Receipt Date',
    'Time Received',
    'Category',
    'Part Number',
    'Description',
    'Serial Number',
    'Receiving Branch',
    'Intake Source',
    'Status'
  ];

  expectedHeaders1.forEach((expected, idx) => {
    const val = headerRow1.getCell(idx + 1).value;
    assert.strictEqual(val, expected, `Header column ${idx + 1} must be "${expected}", got "${val}"`);
  });

  // Verify first data row formatting
  const dataRow1 = ws1.getRow(5);
  const timeReceivedCell = dataRow1.getCell(3).value;
  assert.strictEqual(timeReceivedCell, '02:45:08 PM', `Time Received should be 12-hour: got "${timeReceivedCell}"`);
  assert.strictEqual(dataRow1.getCell(5).value, '661-39373', 'Part Number must be 661-39373');
  assert.strictEqual(dataRow1.getCell(7).value, 'F8Y6234C9AR231LB3', 'Serial Number must match sample');
  assert.strictEqual(dataRow1.getCell(10).value, 'IN STOCK', 'Status must be IN STOCK');
  console.log('  ✓ PASS: Sheet 1 column headers and 12-hour timestamp format verified');

  // ── Test 3: Sheet 2 Parts Summary & Totals ─────────────────────────────────
  console.log('\n--- 3. Testing Sheet 2 Parts Summary by Part Number ---');
  const ws2 = workbook.getWorksheet('Parts Summary');
  assert.ok(ws2, 'Parts Summary sheet must exist');
  const headerRow2 = ws2.getRow(3);
  assert.strictEqual(headerRow2.getCell(2).value, 'Part Number');
  assert.strictEqual(headerRow2.getCell(7).value, 'In-Stock Quantity');

  const summaryRow1 = ws2.getRow(4);
  assert.strictEqual(summaryRow1.getCell(2).value, '661-39373');
  assert.strictEqual(summaryRow1.getCell(7).value, 1);
  console.log('  ✓ PASS: Sheet 2 aggregates part numbers and quantities accurately');

  // ── Test 4: Sheet 3 Import Compatibility with parseScanInPartsFile ──────────
  console.log('\n--- 4. Testing Sheet 3 Import Compatibility & 2-Column Structure ---');
  const ws3 = workbook.getWorksheet('Import Template Guide');
  assert.ok(ws3, 'Import Template Guide sheet must exist');
  
  // Verify Note
  const noteCell = ws3.getCell('A2').value;
  assert.strictEqual(noteCell, 'Please input only the Part Number and Serial Number of the specific part.', 'Note row must have exact prompt text');

  // Verify Headers - ONLY 2 COLUMNS
  const headerRow3 = ws3.getRow(3);
  assert.strictEqual(headerRow3.getCell(1).value, 'Part Number', 'Col 1 must be Part Number');
  assert.strictEqual(headerRow3.getCell(2).value, 'Serial Number', 'Col 2 must be Serial Number');
  assert.strictEqual(headerRow3.getCell(3).value, null, 'Col 3 must be empty - only 2 columns allowed');

  // Verify parsing this workbook with parseScanInPartsFile
  const mockFile = {
    name: 'ASP_ZAM_Parts_Inventory_2026-09-10.xlsx',
    arrayBuffer: async () => buffer
  };

  const parsedResult = await parseScanInPartsFile(mockFile, [], [], [], 'site-zam', 'ASP ZAM');
  assert.strictEqual(parsedResult.success, true, `Importer must succeed: ${parsedResult.error}`);
  assert.ok(parsedResult.items && parsedResult.items.length > 0, 'Must parse items from workbook');
  console.log(`  ✓ PASS: Successfully parsed ${parsedResult.items.length} parts from generated XLSX!`);

  // ── Test 5: Serial Privacy Rule Preservation ───────────────────────────────
  console.log('\n--- 5. Testing Serial Privacy Preservation in Export ---');
  const dataRow3 = ws1.getRow(7); // third item
  const protectedSerialCell = dataRow3.getCell(7).value;
  assert.strictEqual(protectedSerialCell, 'PROTECTED-SERIAL', `Protected serial must remain masked: got "${protectedSerialCell}"`);
  console.log('  ✓ PASS: Protected serials safely preserved in exported XLSX');

  // ── Test 6: Pure 2-Column Template Import with Note Row ────────────────────
  console.log('\n--- 6. Testing Import with ONLY 2 Columns and Note Row ---');
  const sampleAoa = [
    ['Please input only the Part Number and Serial Number of the specific part.'],
    ['Part Number', 'Serial Number'],
    ['661-21991', 'F8Y6304C9QV18FKBQ'],
    ['661-39373', 'F8Y6234C9AR231LB3']
  ];
  const templateWs = XLSX.utils.aoa_to_sheet(sampleAoa);
  const templateWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(templateWb, templateWs, 'Parts Intake');
  const templateBuffer = XLSX.write(templateWb, { bookType: 'xlsx', type: 'array' });

  const twoColFile = {
    name: 'MDC_Receive_Parts_Import_Template.xlsx',
    arrayBuffer: async () => templateBuffer
  };

  const existingPartsMock = [
    { part_number: '661-21991', description: 'Battery, iPhone 13' },
    { part_number: '661-39373', description: 'Battery, iPhone 14' }
  ];

  const twoColResult = await parseScanInPartsFile(twoColFile, existingPartsMock, [], [], 'site-zam', 'ASP ZAM');
  assert.strictEqual(twoColResult.success, true, `2-column template import must succeed: ${twoColResult.error}`);
  assert.strictEqual(twoColResult.items.length, 2, 'Should parse exactly 2 items');
  assert.strictEqual(twoColResult.items[0].partNumber, '661-21991');
  assert.strictEqual(twoColResult.items[0].serialNumber, 'F8Y6304C9QV18FKBQ');
  assert.strictEqual(twoColResult.items[0].description, 'Battery, iPhone 13');
  assert.strictEqual(twoColResult.items[0].status, 'VALID');
  assert.strictEqual(twoColResult.items[1].partNumber, '661-39373');
  assert.strictEqual(twoColResult.items[1].serialNumber, 'F8Y6234C9AR231LB3');
  assert.strictEqual(twoColResult.items[1].status, 'VALID');
  console.log('  ✓ PASS: Pure 2-column file with note parsed perfectly and validated!');

  console.log('\n====================================================');
  console.log('ALL PMG SCAN-IN XLSX EXPORT TESTS PASSED (100%)');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
