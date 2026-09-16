import assert from 'assert';
import { exportAllocationToExcel } from '../utils/excelParser.js';
import { getPartCategory, isPartMatchingCategoryFilter } from '../utils/categoryFilter.js';
import { CANONICAL_SITE_LIST } from '../constants/config.js';

console.log('====================================================');
console.log('TEST SUITE: Allocation Matrix Filtered XLSX Export');
console.log('====================================================');

async function runTests() {
  const sites = CANONICAL_SITE_LIST.map((s, idx) => ({
    id: `site-${idx + 1}`,
    code: s.code,
    name: s.name,
    is_dc: false
  }));

  // Create representative dataset with Display, Battery, Camera, Logic Board, Enclosure
  const fullAllocations = [
    // Displays
    {
      part_id: 'p-1',
      part_number: '661-21966',
      description: 'Display, iPhone 13',
      stocking_price: 279,
      exchange_price: 234.36,
      total_allocated_qty: 15,
      total_stock_cost: 4185,
      site_quantities: { 'site-1': 1, 'site-2': 2, 'site-3': 0 }
    },
    {
      part_id: 'p-2',
      part_number: '661-21993',
      description: 'Display, iPhone 13 Pro',
      stocking_price: 279,
      exchange_price: 234.36,
      total_allocated_qty: 10,
      total_stock_cost: 2790,
      site_quantities: { 'site-1': 0, 'site-2': 1, 'site-3': 1 }
    },
    // Batteries
    {
      part_id: 'p-3',
      part_number: '661-21991',
      description: 'Battery, iPhone 13',
      stocking_price: 99,
      exchange_price: 83.16,
      total_allocated_qty: 25,
      total_stock_cost: 2475,
      site_quantities: { 'site-1': 2, 'site-2': 3, 'site-3': 1 }
    },
    {
      part_id: 'p-4',
      part_number: '661-39373',
      description: 'Battery, iPhone 14',
      stocking_price: 99,
      exchange_price: 83.16,
      total_allocated_qty: 20,
      total_stock_cost: 1980,
      site_quantities: { 'site-1': 1, 'site-2': 2, 'site-3': 0 }
    },
    // Cameras (Non-Battery / Non-Display)
    {
      part_id: 'p-5',
      part_number: '661-54652',
      description: 'Camera, iPhone 17 Pro Max',
      stocking_price: 129,
      exchange_price: 108.36,
      total_allocated_qty: 5,
      total_stock_cost: 645,
      site_quantities: { 'site-1': 1, 'site-2': 0, 'site-3': 0 }
    },
    // Mid/Rear / Logic Board (Non-Battery / Non-Display)
    {
      part_id: 'p-6',
      part_number: 'PP661-23455',
      description: 'iPhone 13, Starlight, 128GB, Logic Board As',
      stocking_price: 389,
      exchange_price: 326.76,
      total_allocated_qty: 4,
      total_stock_cost: 1556,
      site_quantities: { 'site-1': 0, 'site-2': 1, 'site-3': 0 }
    },
    // Other (Speaker)
    {
      part_id: 'p-7',
      part_number: '923-00609',
      description: 'Speaker, iPhone XR',
      stocking_price: 45,
      exchange_price: 37.80,
      total_allocated_qty: 8,
      total_stock_cost: 360,
      site_quantities: { 'site-1': 0, 'site-2': 0, 'site-3': 1 }
    }
  ];

  // 1. Verify Category Filtering
  console.log('\n--- 1. Testing Category Classification & Filter Helper ---');
  assert.strictEqual(getPartCategory(fullAllocations[0]), 'DISPLAY');
  assert.strictEqual(getPartCategory(fullAllocations[2]), 'BATTERY');
  assert.strictEqual(getPartCategory(fullAllocations[4]), 'CAMERA');
  assert.strictEqual(getPartCategory(fullAllocations[5]), 'MID_REAR');
  assert.strictEqual(getPartCategory(fullAllocations[6]), 'OTHER');

  const selectedCategories = ['BATTERY', 'DISPLAY'];
  const filtered = fullAllocations.filter(item => isPartMatchingCategoryFilter(item, selectedCategories));
  assert.strictEqual(filtered.length, 4, `Filtered selection should contain exactly 4 parts (2 Display + 2 Battery), got ${filtered.length}`);
  assert.ok(filtered.every(it => ['DISPLAY', 'BATTERY'].includes(getPartCategory(it))), 'Filtered parts must only be DISPLAY or BATTERY');
  console.log('  ✓ PASS: Filtering by [BATTERY, DISPLAY] extracts strictly genuine Battery and Display parts');

  // 2. Test exportAllocationToExcel with Filtered Data (Battery and Display only)
  console.log('\n--- 2. Testing exportAllocationToExcel with Filtered Battery & Display Data ---');
  const periodLabel = 'October 2026';
  const { workbook } = await exportAllocationToExcel(filtered, sites, periodLabel);

  assert.ok(workbook, 'Workbook must be returned');
  const sheetNames = workbook.worksheets.map(w => w.name);
  assert.deepStrictEqual(sheetNames, ['Master Allocation', 'Week 1', 'Week 2', 'Week 3', 'Week 4']);
  console.log('  ✓ PASS: Master Allocation and Week 1-4 worksheets exist');

  const masterSheet = workbook.getWorksheet('Master Allocation');

  // Check KPI highlights banner (Row 3)
  const kpiTotalPartsCell = masterSheet.getCell('A3').value;
  const expectedTotalUnits = 15 + 10 + 25 + 20; // 70 units
  assert.ok(kpiTotalPartsCell.includes(`${expectedTotalUnits}`), `KPI 1 should display total parts: ${expectedTotalUnits}, got: ${kpiTotalPartsCell}`);

  // Check rows in Master Allocation
  const allRowValues = [];
  masterSheet.eachRow((row, rowNumber) => {
    if (rowNumber >= 5) { // data & subtotal rows
      allRowValues.push({
        rowNumber,
        col1: row.getCell(1).value,
        col2: row.getCell(2).value,
        col3: row.getCell(3).value
      });
    }
  });

  // Ensure no Camera, Logic Board, or Speaker appears anywhere in the sheet!
  const forbiddenParts = ['661-54652', 'PP661-23455', '923-00609'];
  forbiddenParts.forEach(pn => {
    const found = allRowValues.find(r => r.col2 === pn || (typeof r.col3 === 'string' && r.col3.includes(pn)));
    assert.strictEqual(found, undefined, `Forbidden part ${pn} must NOT be in exported filtered workbook`);
  });
  console.log('  ✓ PASS: Filtered out parts (Camera, Logic Board, Speaker) are completely absent from XLSX');

  // Verify categories present in Master sheet
  const categoriesInSheet = new Set(allRowValues.map(r => r.col1).filter(Boolean));
  assert.ok(categoriesInSheet.has('DISPLAY'), 'DISPLAY category must be present');
  assert.ok(categoriesInSheet.has('BATTERY'), 'BATTERY category must be present');
  assert.ok(!categoriesInSheet.has('CAMERA'), 'CAMERA category must NOT be present');
  assert.ok(!categoriesInSheet.has('MID/REAR'), 'MID/REAR category must NOT be present');
  assert.ok(!categoriesInSheet.has('OTHER'), 'OTHER category must NOT be present');
  console.log('  ✓ PASS: Only DISPLAY and BATTERY sections are present in the filtered spreadsheet');

  // Check Subtotals
  const displaySubtotal = allRowValues.find(r => r.col1 === 'DISPLAY' && r.col2 === 'SUB-TOTAL');
  assert.ok(displaySubtotal, 'Display Sub-total row must exist');
  assert.strictEqual(displaySubtotal.col3, '2 Parts Sub-Total');

  const batterySubtotal = allRowValues.find(r => r.col1 === 'BATTERY' && r.col2 === 'SUB-TOTAL');
  assert.ok(batterySubtotal, 'Battery Sub-total row must exist');
  assert.strictEqual(batterySubtotal.col3, '2 Parts Sub-Total');
  console.log('  ✓ PASS: Category subtotals reflect exactly 2 Display and 2 Battery parts');

  // Check Weekly worksheets
  for (let w = 1; w <= 4; w++) {
    const wSheet = workbook.getWorksheet(`Week ${w}`);
    const wRows = [];
    wSheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 4) {
        wRows.push({
          col1: row.getCell(1).value,
          col5: row.getCell(5).value,
          col6: row.getCell(6).value
        });
      }
    });

    forbiddenParts.forEach(pn => {
      const found = wRows.find(r => r.col5 === pn);
      assert.strictEqual(found, undefined, `Part ${pn} must not appear in Week ${w}`);
    });

    const wCats = new Set(wRows.map(r => r.col1).filter(Boolean));
    assert.ok(wCats.has('DISPLAY'), `Week ${w} has DISPLAY`);
    assert.ok(wCats.has('BATTERY'), `Week ${w} has BATTERY`);
    assert.ok(!wCats.has('CAMERA'), `Week ${w} has no CAMERA`);
  }
  console.log('  ✓ PASS: Weekly sheets 1-4 respect filtered parts and categories');

  // 3. Test export with All Categories
  console.log('\n--- 3. Testing exportAllocationToExcel with All Parts ---');
  const { workbook: allWorkbook } = await exportAllocationToExcel(fullAllocations, sites, periodLabel);
  const allMasterSheet = allWorkbook.getWorksheet('Master Allocation');
  const allSheetRows = [];
  allMasterSheet.eachRow((row, rowNumber) => {
    if (rowNumber >= 5) {
      allSheetRows.push({
        col1: row.getCell(1).value,
        col2: row.getCell(2).value,
        col3: row.getCell(3).value
      });
    }
  });

  const logicBoardRow = allSheetRows.find(r => r.col2 === 'PP661-23455');
  assert.ok(logicBoardRow, 'Logic Board row should be present');
  assert.strictEqual(logicBoardRow.col1, 'MID/REAR', 'Logic Board must be labeled MID/REAR, not BATTERY');

  const cameraRow = allSheetRows.find(r => r.col2 === '661-54652');
  assert.ok(cameraRow, 'Camera row should be present');
  assert.strictEqual(cameraRow.col1, 'CAMERA', 'Camera must be labeled CAMERA, not BATTERY');

  const speakerRow = allSheetRows.find(r => r.col2 === '923-00609');
  assert.ok(speakerRow, 'Speaker row should be present');
  assert.strictEqual(speakerRow.col1, 'OTHER', 'Speaker must be labeled OTHER, not BATTERY');

  console.log('  ✓ PASS: When exporting all parts, categories are accurately classified and never mislabeled as BATTERY');

  console.log('\n====================================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
