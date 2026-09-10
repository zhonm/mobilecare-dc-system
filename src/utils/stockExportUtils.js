import ExcelJS from 'exceljs';
import { sanitizeForSpreadsheet } from './security.js';
import { formatTo12HourTime } from './dateUtils.js';

/**
 * Normalizes numeric price
 */
function parseNumericPrice(val) {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]+/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Builds and exports a professionally styled Excel spreadsheet for DC Stock Inventory
 * matching the system's Slate & Sky Blue UI aesthetic.
 *
 * Column Order:
 * 1. # (Index)
 * 2. Receipt Date
 * 3. Time Received
 * 4. Category (Moved between Time Received and Part Number)
 * 5. Part Number
 * 6. Description
 * 7. Serial Number
 * 8. Assignment / Destination
 * 9. Stocking Value ($)
 * 10. Linked PO
 * 11. Intake Source
 * 12. Status
 */
export async function generateStyledStockExcel({
  items = [],
  sheetName = 'DC In-Stock Inventory',
  fileName = 'DC_Complete_Stock_Inventory.xlsx',
  title = 'Distribution Center In-Stock Inventory Manifest',
  scopeLabel = 'All Warehouse In-Stock Units'
} = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mobile Care Services Phils. Inc.';
  workbook.lastModifiedBy = 'MDC DC Warehouse System';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31), {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 4, showGridLines: true }]
  });

  // Calculate Metrics
  const totalUnits = items.length;
  let totalValuation = 0;
  let displayCount = 0;
  let batteryCount = 0;
  let otherCount = 0;

  items.forEach(it => {
    const price = parseNumericPrice(it.price);
    totalValuation += price;
    const cat = String(it.category || '').toLowerCase();
    if (cat.includes('display')) displayCount++;
    else if (cat.includes('battery')) batteryCount++;
    else otherCount++;
  });

  const nowFormatted = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  // ── ROW 1: System Title Banner ─────────────────────────────────────────────
  worksheet.mergeCells('A1:L1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `MOBILE CARE SERVICES PHILS. INC. — ${title.toUpperCase()}`;
  titleCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Slate 900
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 28;

  // ── ROW 2: Metadata Sub-Banner ─────────────────────────────────────────────
  worksheet.mergeCells('A2:L2');
  const metaCell = worksheet.getCell('A2');
  metaCell.value = `Generated: ${nowFormatted}   |   Scope: ${scopeLabel}   |   Total Verified In-Stock: ${totalUnits.toLocaleString()} units   |   Warehouse: MDC Central DC`;
  metaCell.font = { name: 'Arial', size: 8.5, color: { argb: 'FF94A3B8' } }; // Slate 400
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Slate 800
  metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(2).height = 18;

  // ── ROW 3: Executive KPI Summary Cards ─────────────────────────────────────
  worksheet.mergeCells('A3:C3');
  const kpiUnits = worksheet.getCell('A3');
  kpiUnits.value = `TOTAL UNITS: ${totalUnits.toLocaleString()} units`;
  kpiUnits.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
  kpiUnits.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } }; // Sky 600
  kpiUnits.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells('D3:F3');
  const kpiVal = worksheet.getCell('D3');
  kpiVal.value = `TOTAL VALUATION: $${totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  kpiVal.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
  kpiVal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Slate 900
  kpiVal.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells('G3:I3');
  const kpiCats = worksheet.getCell('G3');
  kpiCats.value = `DISPLAYS: ${displayCount}  |  BATTERIES: ${batteryCount}  |  OTHER: ${otherCount}`;
  kpiCats.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
  kpiCats.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; // Slate 700
  kpiCats.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells('J3:L3');
  const kpiStatus = worksheet.getCell('J3');
  kpiStatus.value = 'STATUS: 100% VERIFIED IN STOCK';
  kpiStatus.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
  kpiStatus.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } }; // Emerald 700
  kpiStatus.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(3).height = 22;

  // ── ROW 4: Table Headers (Repositioned: Category between Time Received & Part Number)
  const headers = [
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

  const headerRow = worksheet.addRow(headers);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Slate 900
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'medium', color: { argb: 'FF0284C7' } }, // Sky 600 bottom accent border
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } }
    };
  });

  // Enable Auto-Filter on Table Headers (A4 to L4)
  worksheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: 12 }
  };

  // Base Column Width Tracking
  const colWidths = {
    1: 7,   // #
    2: 15,  // Receipt Date
    3: 15,  // Time Received
    4: 15,  // Category
    5: 16,  // Part Number
    6: 32,  // Description
    7: 22,  // Serial Number
    8: 26,  // Assignment / Destination
    9: 20,  // Stocking Value ($)
    10: 17, // Linked PO
    11: 17, // Intake Source
    12: 15  // Status
  };

  // ── DATA ROWS ──────────────────────────────────────────────────────────────
  const startDataRow = 5;
  items.forEach((it, idx) => {
    const isEven = idx % 2 === 1;
    const rowBg = isEven ? 'FFF8FAFC' : 'FFFFFFFF'; // Subtle Slate 50 zebra striping

    const priceNum = parseNumericPrice(it.price);
    const categoryVal = it.category || (it.part_number?.startsWith('661-') ? 'Display' : 'Part');
    const assignmentVal = it.intake_assignment || (it.isSvnr ? 'SVNR - Service Non-Repair' : it.isCrbr ? 'DC - CRBR' : 'MDC - Forecasting');
    const poVal = it.po_number || it.po_id || 'Direct Intake';
    const sourceVal = it.intake_source || 'Barcode Scan';
    const statusVal = 'IN STOCK';

    const rowValues = [
      idx + 1,
      sanitizeForSpreadsheet(it.dateKey || ''),
      sanitizeForSpreadsheet(formatTo12HourTime(it.timeStr || it.received_at || '')),
      sanitizeForSpreadsheet(categoryVal),
      sanitizeForSpreadsheet(it.part_number || ''),
      sanitizeForSpreadsheet(it.description || ''),
      sanitizeForSpreadsheet(it.serial_number || ''),
      sanitizeForSpreadsheet(assignmentVal),
      priceNum,
      sanitizeForSpreadsheet(poVal),
      sanitizeForSpreadsheet(sourceVal),
      statusVal
    ];

    const dRow = worksheet.addRow(rowValues);
    dRow.height = 21;

    // Track dynamic column widths for text overflow prevention
    rowValues.forEach((val, cIdx) => {
      const colNum = cIdx + 1;
      const strLen = typeof val === 'number' ? 12 : String(val || '').length;
      if (strLen + 3 > colWidths[colNum]) {
        colWidths[colNum] = Math.min(strLen + 3, colNum === 6 ? 50 : 35);
      }
    });

    dRow.eachCell({ includeEmpty: true }, (cell, cNum) => {
      cell.font = { name: 'Arial', size: 9, color: { argb: 'FF0F172A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      // Specific Column Alignment & Styling
      if (cNum === 1) {
        // # (Index)
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 8.5, color: { argb: 'FF64748B' } };
      } else if (cNum === 2) {
        // Receipt Date
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 3) {
        // Time Received
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 8.5, color: { argb: 'FF475569' } };
      } else if (cNum === 4) {
        // Category (Badge Styling)
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 9, bold: true };
        const catUpper = String(categoryVal).toUpperCase();
        if (catUpper.includes('DISPLAY')) {
          cell.font.color = { argb: 'FF0369A1' }; // Sky 700
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } };
        } else if (catUpper.includes('BATTERY')) {
          cell.font.color = { argb: 'FF92400E' }; // Amber 800
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        } else {
          cell.font.color = { argb: 'FF475569' };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        }
      } else if (cNum === 5) {
        // Part Number
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
      } else if (cNum === 6) {
        // Description
        cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      } else if (cNum === 7) {
        // Serial Number
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1E293B' } };
      } else if (cNum === 8) {
        // Assignment / Destination
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 8.5, bold: true };
        const assignStr = String(assignmentVal).toUpperCase();
        if (assignStr.includes('CRBR')) {
          cell.font.color = { argb: 'FF92400E' };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        } else if (assignStr.includes('SVNR')) {
          cell.font.color = { argb: 'FF7E22CE' };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
        } else {
          cell.font.color = { argb: 'FF0369A1' };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
        }
      } else if (cNum === 9) {
        // Stocking Value ($)
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '$#,##0.00';
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      } else if (cNum === 10 || cNum === 11) {
        // Linked PO / Intake Source
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 8.5, color: { argb: 'FF475569' } };
      } else if (cNum === 12) {
        // Status (Soft Emerald Badge)
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 8.5, bold: true, color: { argb: 'FF15803D' } }; // Emerald 700
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } }; // Emerald 100
      }
    });
  });

  // ── ROW: TOTAL / SUMMARY FOOTER ────────────────────────────────────────────
  const lastDataRow = startDataRow + items.length - 1;
  const footerRowIndex = lastDataRow + 1;

  const footerRow = worksheet.addRow([
    'TOTAL',
    '',
    '',
    `${items.length} Items`,
    '',
    `Total Active Warehouse Inventory: ${items.length} Units`,
    '',
    'SUM VALUATION:',
    items.length > 0 ? { formula: `SUM(I${startDataRow}:I${lastDataRow})`, result: totalValuation } : 0,
    '',
    '',
    '100% IN STOCK'
  ]);
  footerRow.height = 24;

  footerRow.eachCell({ includeEmpty: true }, (cell, cNum) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Slate 900
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0284C7' } }, // Accent line above total
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } }
    };

    if (cNum === 1) {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    } else if (cNum === 4 || cNum === 6) {
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
    } else if (cNum === 8) {
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    } else if (cNum === 9) {
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    } else {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  });

  // Merge A..C for "TOTAL" label
  worksheet.mergeCells(`A${footerRowIndex}:C${footerRowIndex}`);

  // Apply Computed Column Widths with comfortable margins
  for (let c = 1; c <= 12; c++) {
    worksheet.getColumn(c).width = colWidths[c] || 15;
  }

  // Write Workbook Buffer and Trigger Download if in browser
  const buffer = await workbook.xlsx.writeBuffer();

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return { workbook, buffer, fileName };
}

/**
 * Convenience method for exporting All In-Stock DC Warehouse Inventory
 */
export async function exportDcCompleteStockInventoryToExcel(enrichedStockUnits = [], todayDateStr = '') {
  const dateSuffix = todayDateStr || new Date().toISOString().split('T')[0];
  return generateStyledStockExcel({
    items: enrichedStockUnits,
    sheetName: 'DC In-Stock Inventory',
    fileName: `DC_Complete_Stock_Inventory_${dateSuffix}.xlsx`,
    title: 'Distribution Center Complete Stock Inventory Manifest',
    scopeLabel: 'Complete In-Stock Physical Inventory'
  });
}

/**
 * Convenience method for exporting a specific Date Group's stock receipts
 */
export async function exportDcStockReceiptsToExcel(dateGroup) {
  if (!dateGroup || !dateGroup.items) return null;
  const dateKey = dateGroup.dateKey || new Date().toISOString().split('T')[0];
  const dateLabel = dateGroup.dateLabel || dateKey;

  return generateStyledStockExcel({
    items: dateGroup.items,
    sheetName: `Stock_${dateKey}`,
    fileName: `DC_Stock_Receipts_${dateKey}.xlsx`,
    title: `Distribution Center Stock Receipts Manifest (${dateLabel})`,
    scopeLabel: `Receipt Session Date: ${dateLabel}`
  });
}

/**
 * Builds and exports a professionally styled Excel spreadsheet for PMG Retail Branch inventory
 * featuring:
 * 1. Sheet 1: Detailed Branch Parts Inventory (with 12-hour timestamps, authentic/protected serials, category badges)
 * 2. Sheet 2: Parts Summary by Part Number (aggregating P/N quantities for branch inventory management)
 * 3. Sheet 3: Direct Import Template Guide (ready for filling and re-importing via parseScanInPartsFile)
 */
export async function exportPmgBranchInventoryToExcel({
  items = [],
  summaryItems = [],
  siteCode = 'BRANCH',
  siteName = '',
  userName = '',
  pmgViewMode = 'my_added',
  customFileName = null
} = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mobile Care Services Phils. Inc.';
  workbook.lastModifiedBy = userName || 'PMG Specialist';
  workbook.created = new Date();

  const branchCode = String(siteCode || 'BRANCH').toUpperCase();
  const fileBranchCode = branchCode.replace(/[^A-Z0-9_-]+/gi, '_');
  const cleanSiteName = siteName || branchCode;
  const dateSuffix = new Date().toISOString().split('T')[0];
  const fileName = customFileName || `${fileBranchCode}_Parts_Inventory_${dateSuffix}.xlsx`;

  const nowFormatted = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const scopeLabel = pmgViewMode === 'my_added'
    ? 'My Added Parts (Private Serials)'
    : pmgViewMode === 'site_summary'
    ? 'Designated Sites Summary (P/N & Qty Only)'
    : `${branchCode} All Available Stock`;

  // Calculate Category Counts
  let displayCount = 0;
  let batteryCount = 0;
  let otherCount = 0;

  items.forEach(it => {
    const cat = String(it.category_name || it.category || '').toLowerCase();
    if (cat.includes('display')) displayCount++;
    else if (cat.includes('battery')) batteryCount++;
    else otherCount++;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 1: Detailed Branch Parts Inventory
  // ═══════════════════════════════════════════════════════════════════════════
  const sheet1Name = `${branchCode.slice(0, 15)} Inventory`.slice(0, 31);
  const ws1 = workbook.addWorksheet(sheet1Name, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 4, showGridLines: true }]
  });

  // Row 1: System Title Banner
  ws1.mergeCells('A1:J1');
  const title1 = ws1.getCell('A1');
  title1.value = `MOBILE CARE SERVICES PHILS. INC. — ${branchCode} INVENTORY INTAKE`;
  title1.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  title1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Slate 900
  title1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(1).height = 28;

  // Row 2: Metadata Sub-Banner
  ws1.mergeCells('A2:J2');
  const meta1 = ws1.getCell('A2');
  meta1.value = `Branch: ${cleanSiteName}   |   Receiver / Specialist: ${userName || 'Branch Staff'}   |   View Scope: ${scopeLabel}   |   Total Verified Units: ${items.length.toLocaleString()} units   |   Generated: ${nowFormatted}`;
  meta1.font = { name: 'Arial', size: 8.5, color: { argb: 'FF94A3B8' } };
  meta1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Slate 800
  meta1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(2).height = 18;

  // Row 3: KPI Metrics Cards
  ws1.mergeCells('A3:C3');
  const kpi1 = ws1.getCell('A3');
  kpi1.value = `TOTAL UNITS: ${items.length.toLocaleString()} units`;
  kpi1.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
  kpi1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } }; // Sky 600
  kpi1.alignment = { horizontal: 'center', vertical: 'middle' };

  ws1.mergeCells('D3:G3');
  const kpi2 = ws1.getCell('D3');
  kpi2.value = `DISPLAYS: ${displayCount}   |   BATTERIES: ${batteryCount}   |   OTHER PARTS: ${otherCount}`;
  kpi2.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
  kpi2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; // Slate 700
  kpi2.alignment = { horizontal: 'center', vertical: 'middle' };

  ws1.mergeCells('H3:J3');
  const kpi3 = ws1.getCell('H3');
  kpi3.value = `STATUS: 100% VERIFIED IN-STOCK`;
  kpi3.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
  kpi3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } }; // Emerald 600
  kpi3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(3).height = 22;

  // Row 4: Column Headers
  const headers1 = [
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

  const headerRow1 = ws1.addRow(headers1);
  headerRow1.height = 24;
  headerRow1.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } }; // Sky 600
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF38BDF8' } },
      bottom: { style: 'medium', color: { argb: 'FF0369A1' } },
      left: { style: 'thin', color: { argb: 'FF38BDF8' } },
      right: { style: 'thin', color: { argb: 'FF38BDF8' } }
    };
  });

  const colWidths1 = { 1: 6, 2: 14, 3: 16, 4: 16, 5: 16, 6: 34, 7: 24, 8: 20, 9: 18, 10: 14 };

  // Populate Data Rows
  items.forEach((it, idx) => {
    const isEven = idx % 2 === 0;
    const dateVal = it.dateKey || (it.received_at ? String(it.received_at).slice(0, 10) : dateSuffix);
    const timeVal = formatTo12HourTime(it.timeStr || it.received_at || '12:00:00 PM');
    const catVal = it.category_name || it.category || 'Service Part';
    const pnVal = it.part_number || '';
    const descVal = it.description || (it.iphone_model ? `${catVal}, ${it.iphone_model}` : 'Apple Service Part');
    const serialVal = it.serial_number || 'PROTECTED-SERIAL';
    const branchVal = it.site_code || branchCode;
    const sourceVal = it.isImported || (it.received_by && it.received_by.includes('Import')) ? 'Spreadsheet Import' : 'Barcode Scan';
    const statusVal = 'IN STOCK';

    const rowValues = [
      idx + 1,
      sanitizeForSpreadsheet(dateVal),
      sanitizeForSpreadsheet(timeVal),
      sanitizeForSpreadsheet(catVal),
      sanitizeForSpreadsheet(pnVal),
      sanitizeForSpreadsheet(descVal),
      sanitizeForSpreadsheet(serialVal),
      sanitizeForSpreadsheet(branchVal),
      sanitizeForSpreadsheet(sourceVal),
      statusVal
    ];

    const dRow = ws1.addRow(rowValues);
    dRow.height = 21;

    rowValues.forEach((val, cIdx) => {
      const colNum = cIdx + 1;
      const strLen = String(val || '').length;
      if (strLen + 3 > (colWidths1[colNum] || 10)) {
        colWidths1[colNum] = Math.min(strLen + 3, 50);
      }
    });

    dRow.eachCell((cell, cNum) => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFF1F5F9' } },
        right: { style: 'thin', color: { argb: 'FFF1F5F9' } }
      };

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' }
      };

      if (cNum === 1) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Courier New', size: 9, color: { argb: 'FF94A3B8' } };
      } else if (cNum === 2) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      } else if (cNum === 3) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Courier New', size: 8.5, color: { argb: 'FF64748B' } };
      } else if (cNum === 4) {
        // Category Badge
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        const cLower = String(catVal).toLowerCase();
        if (cLower.includes('display')) {
          cell.font = { name: 'Arial', size: 8.5, bold: true, color: { argb: 'FF1E40AF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
        } else if (cLower.includes('battery')) {
          cell.font = { name: 'Arial', size: 8.5, bold: true, color: { argb: 'FF166534' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
        } else {
          cell.font = { name: 'Arial', size: 8.5, bold: true, color: { argb: 'FF6B21A8' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF5FF' } };
        }
      } else if (cNum === 5) {
        // Part Number
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Courier New', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      } else if (cNum === 6) {
        // Description
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF1E293B' } };
      } else if (cNum === 7) {
        // Serial Number
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Courier New', size: 9, bold: true, color: { argb: 'FF0284C7' } };
      } else if (cNum === 8 || cNum === 9) {
        // Branch / Source
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 8.5, color: { argb: 'FF475569' } };
      } else if (cNum === 10) {
        // Status Badge
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 8.5, bold: true, color: { argb: 'FF15803D' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
      }
    });
  });

  // Total Summary Footer
  const footerRow1 = ws1.addRow([
    'TOTAL',
    '',
    '',
    `${items.length} Units`,
    '',
    `Total In-Stock Units for ${branchCode}: ${items.length} Parts`,
    '',
    '',
    '',
    '100% IN STOCK'
  ]);
  footerRow1.height = 24;
  const lastRowIdx1 = 4 + items.length + 1;
  ws1.mergeCells(`A${lastRowIdx1}:C${lastRowIdx1}`);

  footerRow1.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0284C7' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } }
    };
  });

  for (let c = 1; c <= 10; c++) {
    ws1.getColumn(c).width = colWidths1[c] || 15;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 2: Parts Summary by Part Number (P/N & Qty)
  // ═══════════════════════════════════════════════════════════════════════════
  const effectiveSummary = (summaryItems && summaryItems.length > 0)
    ? summaryItems
    : (() => {
        const grouped = {};
        items.forEach(u => {
          const pn = String(u.part_number || '').trim().toUpperCase();
          if (!pn) return;
          if (!grouped[pn]) {
            grouped[pn] = {
              part_number: pn,
              description: u.description || 'Apple Service Part',
              iphone_model: u.iphone_model || 'Universal',
              category_name: u.category_name || u.category || 'Service Part',
              site_code: u.site_code || branchCode,
              total_qty: 0
            };
          }
          grouped[pn].total_qty += 1;
        });
        return Object.values(grouped).sort((a, b) => b.total_qty - a.total_qty || a.part_number.localeCompare(b.part_number));
      })();

  const ws2 = workbook.addWorksheet('Parts Summary', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    views: [{ state: 'frozen', ySplit: 3, showGridLines: true }]
  });

  // Banner
  ws2.mergeCells('A1:G1');
  const title2 = ws2.getCell('A1');
  title2.value = `MOBILE CARE SERVICES PHILS. INC. — ${branchCode} PARTS INVENTORY SUMMARY`;
  title2.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  title2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  title2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(1).height = 26;

  ws2.mergeCells('A2:G2');
  const meta2 = ws2.getCell('A2');
  meta2.value = `Branch: ${cleanSiteName}   |   Distinct Part Numbers: ${effectiveSummary.length} SKUs   |   Total Units: ${items.length} units   |   Generated: ${nowFormatted}`;
  meta2.font = { name: 'Arial', size: 8.5, color: { argb: 'FF94A3B8' } };
  meta2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  meta2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(2).height = 18;

  // Headers
  const headers2 = ['#', 'Part Number', 'Description', 'iPhone Model', 'Category', 'Branch Site', 'In-Stock Quantity'];
  const hRow2 = ws2.addRow(headers2);
  hRow2.height = 22;
  hRow2.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } }; // Emerald 600
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  effectiveSummary.forEach((s, idx) => {
    const isEven = idx % 2 === 0;
    const row = ws2.addRow([
      idx + 1,
      s.part_number,
      s.description,
      s.iphone_model || 'Universal',
      s.category_name || 'Service Part',
      s.site_code || branchCode,
      s.total_qty || 0
    ]);
    row.height = 20;
    row.eachCell((cell, cNum) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      if (cNum === 1 || cNum === 6) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 2) {
        cell.font = { name: 'Courier New', size: 9, bold: true, color: { argb: 'FF0F172A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 7) {
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF059669' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    });
  });

  ws2.getColumn(1).width = 6;
  ws2.getColumn(2).width = 16;
  ws2.getColumn(3).width = 34;
  ws2.getColumn(4).width = 20;
  ws2.getColumn(5).width = 16;
  ws2.getColumn(6).width = 14;
  ws2.getColumn(7).width = 18;

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 3: Direct Import Template Guide
  // ═══════════════════════════════════════════════════════════════════════════
  const ws3 = workbook.addWorksheet('Import Template Guide', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    views: [{ state: 'frozen', ySplit: 3, showGridLines: true }]
  });

  ws3.mergeCells('A1:B1');
  const title3 = ws3.getCell('A1');
  title3.value = `MOBILECARE INTAKE IMPORT TEMPLATE — RE-IMPORT OR BATCH UPLOAD`;
  title3.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  title3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  title3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws3.getRow(1).height = 26;

  ws3.mergeCells('A2:B2');
  const meta3 = ws3.getCell('A2');
  meta3.value = `Please input only the Part Number and Serial Number of the specific part.`;
  meta3.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF475569' } };
  meta3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  meta3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws3.getRow(2).height = 20;

  const headers3 = ['Part Number', 'Serial Number'];
  const hRow3 = ws3.addRow(headers3);
  hRow3.height = 22;
  hRow3.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } }; // Purple 600
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  const sampleTemplateRows = [
    ['661-21991', 'F8Y6304C9QV18FKBQ'],
    ['661-21988', 'GVH54810YM8PR5PAD'],
    ['661-39373', 'F8Y6234C9AR231LB3'],
    ['661-30401', 'GH371284920000MUZ'],
    ['661-22294', 'F8Y6285C30S13XCBB']
  ];

  sampleTemplateRows.forEach((r, idx) => {
    const row = ws3.addRow(r);
    row.height = 20;
    row.eachCell((cell, cNum) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      cell.font = { name: 'Courier New', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  });

  ws3.getColumn(1).width = 20;
  ws3.getColumn(2).width = 28;

  // ═══════════════════════════════════════════════════════════════════════════
  // Trigger Browser Download & Return Buffer
  // ═══════════════════════════════════════════════════════════════════════════
  const buffer = await workbook.xlsx.writeBuffer();

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return { workbook, buffer, fileName };
}

