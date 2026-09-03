import ExcelJS from 'exceljs';
import { sanitizeForSpreadsheet } from './security.js';

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
      sanitizeForSpreadsheet(it.timeStr || ''),
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
