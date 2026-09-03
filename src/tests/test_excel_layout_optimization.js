import assert from 'assert';
import {
  generateStyledStockExcel,
  exportDcCompleteStockInventoryToExcel,
  exportDcStockReceiptsToExcel
} from '../utils/stockExportUtils.js';

console.log('====================================================');
console.log('TEST SUITE: Excel Layout & UI Styling Optimization');
console.log('====================================================');

async function runTests() {
  const sampleUnits = [
    {
      id: 'unit-1',
      dateKey: '2026-09-03',
      timeStr: '16:27:29',
      category: 'Display',
      part_number: '661-2198',
      description: 'Display, iPhone 13 Pro Max OLED Screen',
      serial_number: 'GVH5472894CQ9PRSQNJ',
      intake_assignment: 'MDC - Forecasting',
      price: 279,
      po_number: 'PO-2026-081',
      intake_source: 'Barcode Scan'
    },
    {
      id: 'unit-2',
      dateKey: '2026-09-03',
      timeStr: '16:25:48',
      category: 'Battery',
      part_number: '661-5605',
      description: 'Battery, iPhone 14 Plus 4325mAh',
      serial_number: 'G9PHVXI86MDC7483921',
      intake_assignment: 'DC - CRBR',
      price: 99,
      po_number: 'PO-2026-082',
      intake_source: 'Direct Intake'
    },
    {
      id: 'unit-3',
      dateKey: '2026-09-03',
      timeStr: '16:21:45',
      category: 'Camera',
      part_number: '661-3670',
      description: 'Rear Camera System, iPhone 15',
      serial_number: 'G9Q6194MDC884920192',
      intake_assignment: 'SVNR - Service Non-Repair',
      price: 185,
      po_number: 'PO-2026-083',
      intake_source: 'Direct Intake'
    }
  ];

  // ── Test 1: Column Order Verification ──────────────────────────────────────
  console.log('\nTest 1: Column Order & "Category" Position');
  {
    const { workbook, buffer, fileName } = await generateStyledStockExcel({
      items: sampleUnits,
      sheetName: 'DC In-Stock Inventory',
      fileName: 'DC_Complete_Stock_Inventory_2026-09-03.xlsx'
    });

    assert.ok(workbook, 'Workbook must be created');
    assert.ok(buffer && buffer.byteLength > 0, 'Buffer must be non-empty');
    assert.strictEqual(fileName, 'DC_Complete_Stock_Inventory_2026-09-03.xlsx');

    const ws = workbook.getWorksheet('DC In-Stock Inventory');
    assert.ok(ws, 'Worksheet must exist');

    const expectedHeaders = [
      '#',
      'Receipt Date',
      'Time Received',
      'Category',
      'Part Number',
      'Description',
      'Serial Number',
      'Assignment / Destination',
      'Stocking Value ($)',
      'Linked PO',
      'Intake Source',
      'Status'
    ];

    const headerRow = ws.getRow(4);
    expectedHeaders.forEach((expected, idx) => {
      const cellVal = headerRow.getCell(idx + 1).value;
      assert.strictEqual(cellVal, expected, `Header column ${idx + 1} must be "${expected}", got "${cellVal}"`);
    });

    // Explicitly verify Category is col 4, Time Received is col 3, Part Number is col 5
    assert.strictEqual(headerRow.getCell(3).value, 'Time Received', 'Column 3 must be Time Received');
    assert.strictEqual(headerRow.getCell(4).value, 'Category', 'Column 4 must be Category');
    assert.strictEqual(headerRow.getCell(5).value, 'Part Number', 'Column 5 must be Part Number');
    console.log('  ✓ PASS: Column order correctly places Category between Time Received and Part Number');
  }

  // ── Test 2: Column Widths & Auto-Fit ───────────────────────────────────────
  console.log('\nTest 2: Column Widths & Layout Sizing');
  {
    const { workbook } = await generateStyledStockExcel({
      items: sampleUnits,
      sheetName: 'DC In-Stock Inventory'
    });
    const ws = workbook.getWorksheet('DC In-Stock Inventory');

    for (let c = 1; c <= 12; c++) {
      const col = ws.getColumn(c);
      assert.ok(col.width && col.width >= 7, `Column ${c} width (${col.width}) must be >= 7`);
    }

    // Check specific columns have comfortable space
    assert.ok(ws.getColumn(6).width >= 32, `Description column (6) width should be >= 32 (is ${ws.getColumn(6).width})`);
    assert.ok(ws.getColumn(7).width >= 20, `Serial Number column (7) width should be >= 20 (is ${ws.getColumn(7).width})`);
    assert.ok(ws.getColumn(8).width >= 24, `Assignment column (8) width should be >= 24 (is ${ws.getColumn(8).width})`);
    assert.ok(ws.getColumn(9).width >= 16, `Stocking Value column (9) width should be >= 16 (is ${ws.getColumn(9).width})`);
    console.log('  ✓ PASS: All 12 columns have generous, auto-fitted widths preventing text truncation');
  }

  // ── Test 3: Usability Features (Freeze Pane, AutoFilter, Gridlines) ─────────
  console.log('\nTest 3: Usability Features (Freeze Panes, AutoFilter, Gridlines)');
  {
    const { workbook } = await generateStyledStockExcel({
      items: sampleUnits,
      sheetName: 'DC In-Stock Inventory'
    });
    const ws = workbook.getWorksheet('DC In-Stock Inventory');

    // Freeze panes
    assert.ok(ws.views && ws.views.length > 0, 'Views must be defined');
    const view = ws.views[0];
    assert.strictEqual(view.state, 'frozen', 'View must have frozen state');
    assert.strictEqual(view.ySplit, 4, 'ySplit must freeze rows above data (split at row 4)');
    assert.strictEqual(view.showGridLines, true, 'showGridLines must be true');

    // Auto-filter
    assert.ok(ws.autoFilter, 'autoFilter must be set');
    assert.strictEqual(ws.autoFilter.from.row, 4, 'autoFilter must start at row 4');
    assert.strictEqual(ws.autoFilter.to.row, 4, 'autoFilter must end at row 4');
    assert.strictEqual(ws.autoFilter.from.column, 1, 'autoFilter must start at col 1');
    assert.strictEqual(ws.autoFilter.to.column, 12, 'autoFilter must cover up to col 12');
    console.log('  ✓ PASS: Freeze panes, autoFilter, and visible gridlines correctly configured');
  }

  // ── Test 4: Minimal System UI Colors & Styling ─────────────────────────────
  console.log('\nTest 4: System UI Aesthetic & Color Palette');
  {
    const { workbook } = await generateStyledStockExcel({
      items: sampleUnits,
      sheetName: 'DC In-Stock Inventory'
    });
    const ws = workbook.getWorksheet('DC In-Stock Inventory');

    // Title banner row 1
    const titleCell = ws.getCell('A1');
    assert.strictEqual(titleCell.fill?.fgColor?.argb, 'FF0F172A', 'Title banner must use Slate 900 (#0F172A)');
    assert.strictEqual(titleCell.font?.color?.argb, 'FFFFFFFF', 'Title text must be white');

    // Header row 4
    const hCell = ws.getCell('A4');
    assert.strictEqual(hCell.fill?.fgColor?.argb, 'FF0F172A', 'Header row must use Slate 900');
    assert.strictEqual(hCell.border?.bottom?.color?.argb, 'FF0284C7', 'Header bottom border must use Sky 600 (#0284C7)');

    // Row 5 (Display unit)
    const catCellDisplay = ws.getCell('D5');
    assert.strictEqual(catCellDisplay.value, 'Display');
    assert.strictEqual(catCellDisplay.fill?.fgColor?.argb, 'FFF0F9FF', 'Display category cell must have subtle sky background');
    assert.strictEqual(catCellDisplay.font?.color?.argb, 'FF0369A1', 'Display category font must be Sky 700');

    // Row 6 (Battery unit)
    const catCellBattery = ws.getCell('D6');
    assert.strictEqual(catCellBattery.value, 'Battery');
    assert.strictEqual(catCellBattery.fill?.fgColor?.argb, 'FFFEF3C7', 'Battery category cell must have subtle amber background');
    assert.strictEqual(catCellBattery.font?.color?.argb, 'FF92400E', 'Battery category font must be Amber 800');

    // Zebra striping on data rows
    const row5CellA = ws.getCell('A5');
    const row6CellA = ws.getCell('A6');
    assert.strictEqual(row5CellA.fill?.fgColor?.argb, 'FFFFFFFF', 'Row 5 (odd) background should be white');
    assert.strictEqual(row6CellA.fill?.fgColor?.argb, 'FFF8FAFC', 'Row 6 (even) background should be Slate 50 zebra stripe');

    // Price formatting
    const priceCell = ws.getCell('I5');
    assert.strictEqual(priceCell.numFmt, '$#,##0.00', 'Stocking value must have currency format $#,##0.00');
    assert.strictEqual(priceCell.alignment?.horizontal, 'right', 'Stocking value must be right-aligned');

    // Status badge styling
    const statusCell = ws.getCell('L5');
    assert.strictEqual(statusCell.value, 'IN STOCK');
    assert.strictEqual(statusCell.fill?.fgColor?.argb, 'FFDCFCE7', 'Status badge background must be soft Emerald 100');
    assert.strictEqual(statusCell.font?.color?.argb, 'FF15803D', 'Status badge text must be Emerald 700');

    console.log('  ✓ PASS: System UI color palette, badges, and typography strictly validated');
  }

  // ── Test 5: Totals Row & Excel Formulas ────────────────────────────────────
  console.log('\nTest 5: Totals Row & Formula Computation');
  {
    const { workbook } = await generateStyledStockExcel({
      items: sampleUnits,
      sheetName: 'DC In-Stock Inventory'
    });
    const ws = workbook.getWorksheet('DC In-Stock Inventory');

    // Footer row is row 8 (3 items: rows 5, 6, 7 => row 8 is footer)
    const footerRow = ws.getRow(8);
    assert.strictEqual(footerRow.getCell(1).value, 'TOTAL', 'Footer col 1 must be "TOTAL"');

    const sumCell = footerRow.getCell(9);
    assert.ok(sumCell.value?.formula, 'Footer valuation cell must contain an Excel formula');
    assert.strictEqual(sumCell.value.formula, 'SUM(I5:I7)', 'Footer formula must sum data rows I5:I7');
    assert.strictEqual(sumCell.value.result, 279 + 99 + 185, 'Formula result must match exact sum of units');
    assert.strictEqual(sumCell.numFmt, '$#,##0.00', 'Footer valuation cell must have currency formatting');

    console.log('  ✓ PASS: Totals row contains dynamic =SUM(...) formula and accurate result');
  }

  // ── Test 6: Convenience Methods (Complete Stock & Date Group) ──────────────
  console.log('\nTest 6: Convenience Export Methods');
  {
    const allStockResult = await exportDcCompleteStockInventoryToExcel(sampleUnits, '2026-09-03');
    assert.strictEqual(allStockResult.fileName, 'DC_Complete_Stock_Inventory_2026-09-03.xlsx');
    assert.ok(allStockResult.workbook.getWorksheet('DC In-Stock Inventory'));

    const dateGroup = {
      dateKey: '2026-09-03',
      dateLabel: 'Thursday, September 3, 2026',
      items: sampleUnits
    };
    const dateGroupResult = await exportDcStockReceiptsToExcel(dateGroup);
    assert.strictEqual(dateGroupResult.fileName, 'DC_Stock_Receipts_2026-09-03.xlsx');
    assert.ok(dateGroupResult.workbook.getWorksheet('Stock_2026-09-03'));

    console.log('  ✓ PASS: Both Complete Stock and Date Group export methods generate proper files');
  }

  console.log('\n====================================================');
  console.log('ALL EXCEL LAYOUT & STYLING TESTS PASSED (100%)');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
