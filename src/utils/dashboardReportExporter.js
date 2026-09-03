import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { sanitizeForSpreadsheet } from './security.js';

const USD_TO_PHP_RATE = 57;

/**
 * Format currency in PHP
 */
function formatPHP(val) {
  return typeof val === 'number'
    ? `₱${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : '₱0';
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL EXPORTER: SYSTEM DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export Dashboard Distribution Intelligence reports as a styled XLSX workbook.
 */
export async function exportDashboardReportToExcel({
  activeTab = 'top-parts',
  masterPartsReport,
  masterSitesReport,
  sitePartsReport,
  masterSummary,
  selectedSiteName = 'MOBILECARE - NEWPOINT MALL',
  reportCategory = 'ALL',
  reportSearch = '',
  periodLabel = 'September 2026',
  exportMode = 'current' // 'current' | 'all'
} = {}) {
  const cleanPeriodLabel = typeof periodLabel === 'string'
    ? periodLabel
    : (periodLabel?.label || String(periodLabel?.name || 'September 2026'));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mobile Care Services Phils. Inc.';
  workbook.lastModifiedBy = 'MDC DC System 2';
  workbook.created = new Date();

  const totalDemand = masterSummary?.totalUnits || 8295;
  const totalValUSD = masterSummary?.totalValuationUSD || 1632575;
  const totalValPHP = masterSummary?.totalValuationPHP || (totalValUSD * USD_TO_PHP_RATE);
  const totalSKUs = masterSummary?.totalDistinctParts || 415;
  const totalSites = masterSummary?.totalSites || 28;

  // ── Helper: Style Table Header ─────────────────────────────────────────────
  const applyHeaderStyles = (row, bgArgb = 'FF0F172A') => {
    row.height = 24;
    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'medium', color: { argb: 'FF0284C7' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        right: { style: 'thin', color: { argb: 'FF334155' } }
      };
    });
  };

  // ── Helper: Apply Standard Data Row Borders & Fonts ─────────────────────────
  const applyDataRowStyles = (row, isEven = false) => {
    row.height = 20;
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (!cell.font) cell.font = { name: 'Arial', size: 9 };
      if (!cell.fill || cell.fill.type !== 'pattern') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' }
        };
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });
  };

  // ── SHEET: Executive Summary ───────────────────────────────────────────────
  const addSummarySheet = () => {
    const ws = workbook.addWorksheet('Executive Overview', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    // Title Banner
    ws.mergeCells('A1:F1');
    const tCell = ws.getCell('A1');
    tCell.value = `MOBILE CARE SERVICES PHILS. INC. — Distribution Center Intelligence Report (${cleanPeriodLabel})`;
    tCell.font = { name: 'Arial', size: 12.5, bold: true, color: { argb: 'FFFFFFFF' } };
    tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    tCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    // Subtitle / Metadata
    ws.mergeCells('A2:F2');
    const sCell = ws.getCell('A2');
    sCell.value = `Generated: ${new Date().toLocaleString('en-US')}  |  Source: Fixably / GSX Masterlist Analysis  |  Currency Rate: 1 USD = 57 PHP`;
    sCell.font = { name: 'Arial', size: 8.5, italic: true, color: { argb: 'FF64748B' } };
    sCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 18;

    // KPI Blocks Row
    ws.mergeCells('A4:B4');
    const k1 = ws.getCell('A4');
    k1.value = `TOTAL IPHONE DEMAND: ${totalDemand.toLocaleString()} units`;
    k1.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    k1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
    k1.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.mergeCells('C4:D4');
    const k2 = ws.getCell('C4');
    k2.value = `VALUATION: $${totalValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${formatPHP(totalValPHP)})`;
    k2.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    k2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
    k2.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.mergeCells('E4:F4');
    const k3 = ws.getCell('E4');
    k3.value = `NETWORK: ${totalSKUs} SKUs across ${totalSites} Service Hubs`;
    k3.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    k3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    k3.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(4).height = 24;

    // Category Breakdown Section
    ws.getCell('A6').value = 'IPHONE REPAIR DEMAND BY COMPONENT CATEGORY';
    ws.getCell('A6').font = { name: 'Arial', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };

    const catHeaders = ['Category / Component Family', 'Repairs / Units', 'Share of Demand (%)', 'Est. Valuation (USD)', 'Est. Valuation (PHP)'];
    const catHeaderRow = ws.addRow(catHeaders);
    applyHeaderStyles(catHeaderRow);

    const stats = masterSummary?.categoryStats || {};
    const catPrices = {
      'Battery': 89,
      'Display': 279,
      'Rear System & Logic': 329,
      'Camera': 129,
      'Back Glass': 99,
      'Component': 100
    };

    let catIdx = 0;
    Object.entries(stats).forEach(([cat, count]) => {
      const share = totalDemand > 0 ? (count / totalDemand) * 100 : 0;
      const unitPrice = catPrices[cat] || 100;
      const valUSD = count * unitPrice;
      const valPHP = valUSD * USD_TO_PHP_RATE;

      const r = ws.addRow([
        sanitizeForSpreadsheet(cat),
        count,
        Number((share / 100).toFixed(4)),
        valUSD,
        valPHP
      ]);
      applyDataRowStyles(r, catIdx % 2 === 1);
      r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(2).numFmt = '#,##0';
      r.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(3).numFmt = '0.0%';
      r.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(4).numFmt = '$#,##0';
      r.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(5).numFmt = '₱#,##0';
      catIdx++;
    });

    ws.columns = [
      { width: 32 },
      { width: 18 },
      { width: 22 },
      { width: 24 },
      { width: 24 },
      { width: 20 }
    ];
  };

  // ── SHEET: Top iPhone Parts ────────────────────────────────────────────────
  const addTopPartsSheet = (items = [], isFiltered = false) => {
    const sheetName = isFiltered ? 'Top iPhone Parts (Filtered)' : 'Top iPhone Parts';
    const ws = workbook.addWorksheet(sheetName, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    // Banner
    ws.mergeCells('A1:J1');
    const tCell = ws.getCell('A1');
    tCell.value = `MOBILE CARE SERVICES PHILS. INC. — National iPhone Parts Ranking (${cleanPeriodLabel})`;
    tCell.font = { name: 'Arial', size: 12.5, bold: true, color: { argb: 'FFFFFFFF' } };
    tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    tCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    // Filter information
    ws.mergeCells('A2:J2');
    const fCell = ws.getCell('A2');
    const filterInfo = [
      `Category Filter: ${reportCategory}`,
      reportSearch ? `Search Query: "${reportSearch}"` : null,
      `Items Listed: ${items.length} SKUs`,
      `Exported: ${new Date().toLocaleDateString('en-US')}`
    ].filter(Boolean).join('  |  ');
    fCell.value = filterInfo;
    fCell.font = { name: 'Arial', size: 8.5, italic: true, color: { argb: 'FF64748B' } };
    fCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 18;

    // Table Headers
    const headers = [
      'Rank',
      'Part Number',
      'iPhone Model & Description',
      'Category',
      'Stock Price (USD)',
      'Stock Price (PHP)',
      'Total Demand (Units)',
      'Total Valuation (USD)',
      'Total Valuation (PHP)',
      'Share of Demand (%)'
    ];
    const headerRow = ws.addRow(headers);
    applyHeaderStyles(headerRow);

    let sumUnits = 0;
    let sumValUSD = 0;

    items.forEach((item, idx) => {
      sumUnits += item.totalUnits || item.units || 0;
      sumValUSD += item.totalValUSD || 0;
      const priceUSD = item.priceUSD || 0;
      const pricePHP = priceUSD * USD_TO_PHP_RATE;
      const totalUnits = item.totalUnits || item.units || 0;
      const totalVal = item.totalValUSD || 0;
      const totalValPhp = totalVal * USD_TO_PHP_RATE;
      const share = (item.pctShare || 0) / 100;

      const r = ws.addRow([
        idx + 1,
        sanitizeForSpreadsheet(item.part_number || ''),
        sanitizeForSpreadsheet(item.description || ''),
        sanitizeForSpreadsheet(item.category || 'Component'),
        priceUSD,
        pricePHP,
        totalUnits,
        totalVal,
        totalValPhp,
        Number(share.toFixed(4))
      ]);
      applyDataRowStyles(r, idx % 2 === 1);

      r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(2).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      r.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
      r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(5).numFmt = '$#,##0';
      r.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(6).numFmt = '₱#,##0';
      r.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(7).numFmt = '#,##0';
      r.getCell(7).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0284C7' } };
      r.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(8).numFmt = '$#,##0';
      r.getCell(8).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF15803D' } };
      r.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(9).numFmt = '₱#,##0';
      r.getCell(10).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(10).numFmt = '0.0%';
    });

    // Summary Totals Row
    const totRow = ws.addRow([
      'TOTAL',
      '',
      `${items.length} SKUs Listed`,
      '',
      '',
      '',
      sumUnits,
      sumValUSD,
      sumValUSD * USD_TO_PHP_RATE,
      '100.0%'
    ]);
    totRow.height = 22;
    totRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF0F172A' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } }
      };
    });
    totRow.getCell(7).numFmt = '#,##0';
    totRow.getCell(8).numFmt = '$#,##0';
    totRow.getCell(9).numFmt = '₱#,##0';

    ws.columns = [
      { width: 8 },
      { width: 16 },
      { width: 38 },
      { width: 22 },
      { width: 18 },
      { width: 18 },
      { width: 22 },
      { width: 22 },
      { width: 22 },
      { width: 20 }
    ];
  };

  // ── SHEET: Service Hubs ────────────────────────────────────────────────────
  const addSitesSheet = (sites = []) => {
    const ws = workbook.addWorksheet('Service Hubs Network', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    ws.mergeCells('A1:I1');
    const tCell = ws.getCell('A1');
    tCell.value = `MOBILE CARE SERVICES PHILS. INC. — Service Hubs iPhone Demand Network (${cleanPeriodLabel})`;
    tCell.font = { name: 'Arial', size: 12.5, bold: true, color: { argb: 'FFFFFFFF' } };
    tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    tCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    const headers = [
      'Rank',
      'Service Branch Name',
      'Region',
      'iPhone Units Demand',
      'Distinct SKUs',
      'Total Valuation (USD)',
      'Total Valuation (PHP)',
      'Top Consumed iPhone Part',
      'Network Share (%)'
    ];
    const headerRow = ws.addRow(headers);
    applyHeaderStyles(headerRow);

    let sumUnits = 0;
    let sumVal = 0;

    sites.forEach((site, idx) => {
      sumUnits += site.totalUnits || 0;
      sumVal += site.totalValUSD || 0;
      const topPartText = site.topPart
        ? `${site.topPart.description || site.topPart.part_number} (${site.topPart.units} units)`
        : '—';

      const r = ws.addRow([
        idx + 1,
        sanitizeForSpreadsheet(site.siteName || site.shortName || ''),
        sanitizeForSpreadsheet(site.region || (site.isMM ? 'Metro Manila' : 'Provincial')),
        site.totalUnits || 0,
        site.distinctPartsCount || 0,
        site.totalValUSD || 0,
        (site.totalValUSD || 0) * USD_TO_PHP_RATE,
        sanitizeForSpreadsheet(topPartText),
        Number(((site.pctShare || 0) / 100).toFixed(4))
      ]);
      applyDataRowStyles(r, idx % 2 === 1);

      r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
      r.getCell(2).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      r.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(4).numFmt = '#,##0';
      r.getCell(4).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0284C7' } };
      r.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(5).numFmt = '#,##0';
      r.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(6).numFmt = '$#,##0';
      r.getCell(6).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF15803D' } };
      r.getCell(7).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(7).numFmt = '₱#,##0';
      r.getCell(8).alignment = { horizontal: 'left', vertical: 'middle' };
      r.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(9).numFmt = '0.0%';
    });

    const totRow = ws.addRow([
      'TOTAL',
      `${sites.length} Service Hubs`,
      'National Network',
      sumUnits,
      '',
      sumVal,
      sumVal * USD_TO_PHP_RATE,
      '',
      '100.0%'
    ]);
    totRow.height = 22;
    totRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF0F172A' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } }
      };
    });
    totRow.getCell(4).numFmt = '#,##0';
    totRow.getCell(6).numFmt = '$#,##0';
    totRow.getCell(7).numFmt = '₱#,##0';

    ws.columns = [
      { width: 8 },
      { width: 36 },
      { width: 18 },
      { width: 22 },
      { width: 16 },
      { width: 22 },
      { width: 22 },
      { width: 38 },
      { width: 18 }
    ];
  };

  // ── SHEET: Site Specific Parts ─────────────────────────────────────────────
  const addSitePartsSheet = (siteName, partsList = []) => {
    const cleanSheetName = `Branch - ${siteName.replace(/MOBILECARE - /gi, '').substring(0, 20)}`.trim();
    const ws = workbook.addWorksheet(cleanSheetName, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    ws.mergeCells('A1:J1');
    const tCell = ws.getCell('A1');
    tCell.value = `MOBILE CARE SERVICES PHILS. INC. — Branch Demand: ${siteName} (${cleanPeriodLabel})`;
    tCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    tCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    const headers = [
      'Rank',
      'Part Number',
      'iPhone Model & Description',
      'Category',
      'Stock Price (USD)',
      'Stock Price (PHP)',
      'Branch Demand (Units)',
      'Total Branch Cost (USD)',
      'Total Branch Cost (PHP)',
      'Branch Share (%)'
    ];
    const headerRow = ws.addRow(headers);
    applyHeaderStyles(headerRow);

    let sumUnits = 0;
    let sumCost = 0;

    partsList.forEach((item, idx) => {
      const units = item.units || item.totalUnits || 0;
      const costUSD = item.totalValUSD || 0;
      sumUnits += units;
      sumCost += costUSD;

      const r = ws.addRow([
        idx + 1,
        sanitizeForSpreadsheet(item.part_number || ''),
        sanitizeForSpreadsheet(item.description || ''),
        sanitizeForSpreadsheet(item.category || 'Component'),
        item.priceUSD || 0,
        (item.priceUSD || 0) * USD_TO_PHP_RATE,
        units,
        costUSD,
        costUSD * USD_TO_PHP_RATE,
        Number(((item.pctShare || 0) / 100).toFixed(4))
      ]);
      applyDataRowStyles(r, idx % 2 === 1);

      r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(2).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
      r.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
      r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(5).numFmt = '$#,##0';
      r.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(6).numFmt = '₱#,##0';
      r.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(7).numFmt = '#,##0';
      r.getCell(7).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0284C7' } };
      r.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(8).numFmt = '$#,##0';
      r.getCell(8).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF15803D' } };
      r.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(9).numFmt = '₱#,##0';
      r.getCell(10).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(10).numFmt = '0.0%';
    });

    const totRow = ws.addRow([
      'TOTAL',
      '',
      `${partsList.length} Branch SKUs`,
      '',
      '',
      '',
      sumUnits,
      sumCost,
      sumCost * USD_TO_PHP_RATE,
      '100.0%'
    ]);
    totRow.height = 22;
    totRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF0F172A' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } }
      };
    });
    totRow.getCell(7).numFmt = '#,##0';
    totRow.getCell(8).numFmt = '$#,##0';
    totRow.getCell(9).numFmt = '₱#,##0';

    ws.columns = [
      { width: 8 },
      { width: 16 },
      { width: 38 },
      { width: 22 },
      { width: 18 },
      { width: 18 },
      { width: 22 },
      { width: 22 },
      { width: 22 },
      { width: 20 }
    ];
  };

  // ── COMPILE WORKBOOK BASED ON EXPORT MODE ──────────────────────────────────
  let filename = '';

  if (exportMode === 'all') {
    // Full Comprehensive Package: Summary + All Parts + All Sites + Selected Site
    addSummarySheet();
    addTopPartsSheet(masterPartsReport?.all || [], false);
    addSitesSheet(masterSitesReport?.all || []);
    if (sitePartsReport?.all?.length > 0) {
      addSitePartsSheet(selectedSiteName, sitePartsReport.all);
    }
    filename = `MDC_Dashboard_Master_Intelligence_Package_${cleanPeriodLabel.replace(/\s+/g, '_')}.xlsx`;
  } else {
    // Export Active View
    if (activeTab === 'top-parts') {
      const isFiltered = reportCategory !== 'ALL' || Boolean(reportSearch);
      addTopPartsSheet(masterPartsReport?.all || masterPartsReport?.displayList || [], isFiltered);
      addSummarySheet();
      filename = `MDC_Top_iPhone_Parts_Report_${reportCategory}_${cleanPeriodLabel.replace(/\s+/g, '_')}.xlsx`;
    } else if (activeTab === 'top-sites') {
      addSitesSheet(masterSitesReport?.all || masterSitesReport?.displayList || []);
      addSummarySheet();
      filename = `MDC_Service_Hubs_Network_Report_${cleanPeriodLabel.replace(/\s+/g, '_')}.xlsx`;
    } else if (activeTab === 'site-parts') {
      addSitePartsSheet(selectedSiteName, sitePartsReport?.all || sitePartsReport?.displayList || []);
      filename = `MDC_Branch_Report_${selectedSiteName.replace(/[^a-zA-Z0-9]/g, '_')}_${cleanPeriodLabel.replace(/\s+/g, '_')}.xlsx`;
    }
  }

  // Write and download buffer in browser
  const buffer = await workbook.xlsx.writeBuffer();

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return { workbook, buffer, filename };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF EXPORTER: SYSTEM DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export Dashboard Distribution Intelligence report as a corporate PDF document.
 */
export function exportDashboardReportToPDF({
  activeTab = 'top-parts',
  masterPartsReport,
  masterSitesReport,
  sitePartsReport,
  masterSummary,
  selectedSiteName = 'MOBILECARE - NEWPOINT MALL',
  reportCategory = 'ALL',
  reportSearch = '',
  periodLabel = 'September 2026',
  exportMode = 'current', // 'current' | 'all'
  supervisorSettings = {}
} = {}) {
  const cleanPeriodLabel = typeof periodLabel === 'string'
    ? periodLabel
    : (periodLabel?.label || String(periodLabel?.name || 'September 2026'));

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;

  const totalDemand = masterSummary?.totalUnits || 8295;
  const totalValUSD = masterSummary?.totalValuationUSD || 1632575;
  const totalValPHP = masterSummary?.totalValuationPHP || (totalValUSD * USD_TO_PHP_RATE);
  const totalSKUs = masterSummary?.totalDistinctParts || 415;
  const totalSites = masterSummary?.totalSites || 28;

  // ── Header Helper ──────────────────────────────────────────────────────────
  const renderHeader = (title, subtitle) => {
    // Navy top bar
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, 8, pageWidth - (margin * 2), 12, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    doc.text(title, margin + 6, 15.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(56, 189, 248);
    doc.text(`Mobile Care Services Phils. Inc.  |  DC Operations`, pageWidth - margin - 6, 15.5, { align: 'right' });

    if (subtitle) {
      doc.setFontSize(7.8);
      doc.setTextColor(100, 116, 139);
      doc.text(subtitle, margin + 6, 24);
    }
  };

  // ── KPI Boxes Helper ───────────────────────────────────────────────────────
  const renderKpiCards = (startY = 27) => {
    const kpiBoxWidth = (pageWidth - (margin * 2) - 18) / 4;
    const kpis = [
      { label: 'TOTAL IPHONE DEMAND', val: `${totalDemand.toLocaleString()} units`, sub: 'Fixably Masterlist Usage' },
      { label: 'STOCK VALUATION', val: `$${totalValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: `~${formatPHP(totalValPHP)} PHP` },
      { label: 'ACTIVE IPHONE SKUS', val: `${totalSKUs} Parts`, sub: 'Standardized Catalog' },
      { label: 'RECEIVING SERVICE HUBS', val: `${totalSites} Branches`, sub: 'Metro Manila & Regional' }
    ];

    kpis.forEach((kpi, idx) => {
      const kpiX = margin + (idx * (kpiBoxWidth + 6));
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.rect(kpiX, startY, kpiBoxWidth, 18, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, kpiX + 4, startY + 5);

      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(kpi.val, kpiX + 4, startY + 11.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text(kpi.sub, kpiX + 4, startY + 15.5);
    });
  };

  // ── Footer Helper ──────────────────────────────────────────────────────────
  const attachFooters = (reportDoc) => {
    const totalPages = reportDoc.internal.getNumberOfPages();
    const supervisorName = supervisorSettings?.supervisor_name || 'Anjo Alcazar';
    const supervisorTitle = supervisorSettings?.supervisor_title || 'MDC Supervisor of DC';

    for (let i = 1; i <= totalPages; i++) {
      reportDoc.setPage(i);
      const y = pageHeight - 8;

      reportDoc.setFont('helvetica', 'normal');
      reportDoc.setFontSize(7);
      reportDoc.setTextColor(148, 163, 184);
      reportDoc.text('Confidential — Mobile Care Services Phils. Inc.  |  Distribution Center System', margin, y);

      reportDoc.text(`Authorized by: ${supervisorName} (${supervisorTitle})`, pageWidth / 2, y, { align: 'center' });
      reportDoc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, y, { align: 'right' });
    }
  };

  // ── BUILD TABLES ───────────────────────────────────────────────────────────
  let filename = '';

  if (activeTab === 'top-parts' || exportMode === 'all') {
    renderHeader(
      `DISTRIBUTION INTELLIGENCE — National iPhone Parts Ranking (${cleanPeriodLabel})`,
      `Category Filter: ${reportCategory}  |  Search: ${reportSearch ? `"${reportSearch}"` : 'All SKUs'}  |  Generated: ${new Date().toLocaleString('en-US')}`
    );
    renderKpiCards(27);

    const partsList = masterPartsReport?.all || masterPartsReport?.displayList || [];
    const tableBody = partsList.map((p, idx) => [
      idx + 1,
      p.part_number || '',
      p.description || '',
      p.category || 'Component',
      `$${p.priceUSD || 0}`,
      (p.totalUnits || p.units || 0).toLocaleString(),
      `$${(p.totalValUSD || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      `₱${((p.totalValUSD || 0) * USD_TO_PHP_RATE).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      `${(p.pctShare || 0).toFixed(1)}%`
    ]);

    autoTable(doc, {
      startY: 49,
      head: [['#', 'PART NUMBER', 'IPHONE MODEL & DESCRIPTION', 'CATEGORY', 'PRICE', 'DEMAND', 'VALUATION ($)', 'VALUATION (₱)', 'SHARE']],
      body: tableBody,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
      bodyStyles: { fontSize: 7.2, textColor: [15, 23, 42], cellPadding: 2 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { halign: 'center', fontStyle: 'bold', cellWidth: 26 },
        2: { halign: 'left', cellWidth: 'auto' },
        3: { halign: 'center', cellWidth: 32 },
        4: { halign: 'right', cellWidth: 18 },
        5: { halign: 'center', fontStyle: 'bold', cellWidth: 22 },
        6: { halign: 'right', fontStyle: 'bold', cellWidth: 26 },
        7: { halign: 'right', cellWidth: 28 },
        8: { halign: 'center', cellWidth: 16 }
      },
      margin: { left: margin, right: margin, bottom: 14 }
    });

    filename = `MDC_Top_iPhone_Parts_Report_${cleanPeriodLabel.replace(/\s+/g, '_')}.pdf`;
  }

  if (activeTab === 'top-sites' && exportMode !== 'all') {
    renderHeader(
      `DISTRIBUTION INTELLIGENCE — Service Hubs iPhone Ranking (${cleanPeriodLabel})`,
      `28 Service Branches Network  |  Generated: ${new Date().toLocaleString('en-US')}`
    );
    renderKpiCards(27);

    const sitesList = masterSitesReport?.all || masterSitesReport?.displayList || [];
    const tableBody = sitesList.map((s, idx) => [
      idx + 1,
      s.shortName || s.siteName || '',
      s.region || (s.isMM ? 'Metro Manila' : 'Provincial'),
      (s.totalUnits || 0).toLocaleString(),
      s.distinctPartsCount || 0,
      `$${(s.totalValUSD || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      `₱${((s.totalValUSD || 0) * USD_TO_PHP_RATE).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      s.topPart ? `${s.topPart.description || s.topPart.part_number} (${s.topPart.units})` : '—',
      `${(s.pctShare || 0).toFixed(1)}%`
    ]);

    autoTable(doc, {
      startY: 49,
      head: [['#', 'SERVICE BRANCH', 'REGION', 'IPHONE UNITS', 'DISTINCT SKUS', 'VALUATION ($)', 'VALUATION (₱)', 'TOP CONSUMED PART', 'SHARE']],
      body: tableBody,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
      bodyStyles: { fontSize: 7.2, textColor: [15, 23, 42], cellPadding: 2.2 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { halign: 'left', fontStyle: 'bold', cellWidth: 'auto' },
        2: { halign: 'center', cellWidth: 24 },
        3: { halign: 'center', fontStyle: 'bold', cellWidth: 22 },
        4: { halign: 'center', cellWidth: 18 },
        5: { halign: 'right', fontStyle: 'bold', cellWidth: 25 },
        6: { halign: 'right', cellWidth: 26 },
        7: { halign: 'left', cellWidth: 55 },
        8: { halign: 'center', cellWidth: 16 }
      },
      margin: { left: margin, right: margin, bottom: 14 }
    });

    filename = `MDC_Service_Hubs_Report_${cleanPeriodLabel.replace(/\s+/g, '_')}.pdf`;
  }

  if (activeTab === 'site-parts' && exportMode !== 'all') {
    renderHeader(
      `DISTRIBUTION INTELLIGENCE — Branch Parts Demand: ${selectedSiteName} (${cleanPeriodLabel})`,
      `Category Filter: ${reportCategory}  |  Search: ${reportSearch ? `"${reportSearch}"` : 'All Parts'}  |  Generated: ${new Date().toLocaleString('en-US')}`
    );

    const bDemand = sitePartsReport?.siteTotalUnits || 0;
    const bSpendUSD = sitePartsReport?.siteTotalValUSD || 0;
    const bSKUs = sitePartsReport?.totalPartsCount || 0;

    // Custom 3 KPI cards for the branch
    const startY = 27;
    const kpiBoxWidth = (pageWidth - (margin * 2) - 12) / 3;
    const branchKpis = [
      { label: 'BRANCH TOTAL DEMAND', val: `${bDemand.toLocaleString()} units`, sub: selectedSiteName },
      { label: 'BRANCH TOTAL SPEND', val: `$${bSpendUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: `~₱${(bSpendUSD * USD_TO_PHP_RATE).toLocaleString(undefined, { maximumFractionDigits: 0 })} PHP` },
      { label: 'BRANCH ACTIVE SKUS', val: `${bSKUs} SKUs`, sub: 'Allocated Components' }
    ];

    branchKpis.forEach((kpi, idx) => {
      const kpiX = margin + (idx * (kpiBoxWidth + 6));
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.rect(kpiX, startY, kpiBoxWidth, 18, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, kpiX + 4, startY + 5);

      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(kpi.val, kpiX + 4, startY + 11.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text(kpi.sub, kpiX + 4, startY + 15.5);
    });

    const partsList = sitePartsReport?.all || sitePartsReport?.displayList || [];
    const tableBody = partsList.map((p, idx) => [
      idx + 1,
      p.part_number || '',
      p.description || '',
      p.category || 'Component',
      `$${p.priceUSD || 0}`,
      (p.units || p.totalUnits || 0).toLocaleString(),
      `$${(p.totalValUSD || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      `₱${((p.totalValUSD || 0) * USD_TO_PHP_RATE).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      `${(p.pctShare || 0).toFixed(1)}%`
    ]);

    autoTable(doc, {
      startY: 49,
      head: [['#', 'PART NUMBER', 'IPHONE MODEL & DESCRIPTION', 'CATEGORY', 'PRICE', 'BRANCH DEMAND', 'BRANCH COST ($)', 'BRANCH COST (₱)', 'BRANCH SHARE']],
      body: tableBody,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
      bodyStyles: { fontSize: 7.2, textColor: [15, 23, 42], cellPadding: 2 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { halign: 'center', fontStyle: 'bold', cellWidth: 26 },
        2: { halign: 'left', cellWidth: 'auto' },
        3: { halign: 'center', cellWidth: 32 },
        4: { halign: 'right', cellWidth: 18 },
        5: { halign: 'center', fontStyle: 'bold', cellWidth: 22 },
        6: { halign: 'right', fontStyle: 'bold', cellWidth: 26 },
        7: { halign: 'right', cellWidth: 28 },
        8: { halign: 'center', cellWidth: 16 }
      },
      margin: { left: margin, right: margin, bottom: 14 }
    });

    filename = `MDC_Branch_Report_${selectedSiteName.replace(/[^a-zA-Z0-9]/g, '_')}_${cleanPeriodLabel.replace(/\s+/g, '_')}.pdf`;
  }

  // Attach footers to all pages
  attachFooters(doc);

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && doc.save) {
    doc.save(filename);
  }

  return { doc, filename };
}

// ─────────────────────────────────────────────────────────────────────────────
// DC WAREHOUSE INVENTORY EXPORTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export DC In-Stock Warehouse Inventory as XLSX
 */
export async function exportDcInventoryToExcel(groupedInventory = [], { filter = 'ALL', search = '' } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mobile Care Services Phils. Inc.';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('DC Warehouse In-Stock', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  ws.mergeCells('A1:G1');
  const tCell = ws.getCell('A1');
  tCell.value = 'MOBILE CARE SERVICES PHILS. INC. — Distribution Center Physical Stock Inventory Snapshot';
  tCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  tCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  ws.mergeCells('A2:G2');
  ws.getCell('A2').value = `Active Filter: ${filter}  |  Search: ${search || 'None'}  |  Total SKUs: ${groupedInventory.length}  |  Generated: ${new Date().toLocaleString('en-US')}`;
  ws.getCell('A2').font = { name: 'Arial', size: 8.5, italic: true, color: { argb: 'FF64748B' } };
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 18;

  const headers = ['#', 'Part Number', 'Description', 'Category', 'DC In-Stock Units', 'Aging Status (4+ Days)', 'Recent Serial Number'];
  const headerRow = ws.addRow(headers);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  let totalUnits = 0;
  groupedInventory.forEach((item, idx) => {
    const unitsCount = item.units?.length || 0;
    totalUnits += unitsCount;
    const agingLabel = item.maxDaysInDc >= 4 ? `Aging (${item.maxDaysInDc} days)` : `Fresh (${item.maxDaysInDc} days)`;

    const r = ws.addRow([
      idx + 1,
      sanitizeForSpreadsheet(item.part_number || ''),
      sanitizeForSpreadsheet(item.description || ''),
      sanitizeForSpreadsheet(String(item.category || '').replace('cat-', '').toUpperCase()),
      unitsCount,
      agingLabel,
      sanitizeForSpreadsheet(item.latest_serial || '—')
    ]);
    r.height = 20;
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Arial', size: 9 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });

    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(2).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
    r.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
    r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(5).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0284C7' } };
    r.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' };
    if (item.maxDaysInDc >= 4) {
      r.getCell(6).font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFB45309' } };
    }
    r.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
  });

  const totRow = ws.addRow(['TOTAL', '', `${groupedInventory.length} SKUs`, '', totalUnits, '', '']);
  totRow.height = 22;
  totRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  });

  ws.columns = [
    { width: 8 },
    { width: 18 },
    { width: 38 },
    { width: 20 },
    { width: 20 },
    { width: 24 },
    { width: 26 }
  ];

  const filename = `MDC_DC_InStock_Inventory_${new Date().toISOString().split('T')[0]}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return { workbook, buffer, filename };
}

/**
 * Export DC In-Stock Warehouse Inventory as PDF
 */
export function exportDcInventoryToPDF(groupedInventory = [], { filter = 'ALL', search = '', supervisorSettings = {} } = {}) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;

  doc.setFillColor(15, 23, 42);
  doc.rect(margin, 8, pageWidth - (margin * 2), 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text('MOBILE CARE SERVICES PHILS. INC. — Distribution Center Physical Stock Inventory', margin + 6, 15.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Active Filter: ${filter}  |  Search: ${search || 'None'}  |  Total SKUs: ${groupedInventory.length}  |  Generated: ${new Date().toLocaleString('en-US')}`, margin + 6, 24);

  const tableBody = groupedInventory.map((item, idx) => [
    idx + 1,
    item.part_number || '',
    item.description || '',
    String(item.category || '').replace('cat-', '').toUpperCase(),
    `${item.units?.length || 0} units`,
    item.maxDaysInDc >= 4 ? `Aging (${item.maxDaysInDc}d)` : `Fresh (${item.maxDaysInDc}d)`,
    item.latest_serial || '—'
  ]);

  autoTable(doc, {
    startY: 28,
    head: [['#', 'PART NUMBER', 'DESCRIPTION', 'CATEGORY', 'IN-STOCK UNITS', 'DC AGING STATUS', 'RECENT SERIAL NUMBER']],
    body: tableBody,
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'center' },
    bodyStyles: { fontSize: 7.5, textColor: [15, 23, 42], cellPadding: 2.2 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { halign: 'center', fontStyle: 'bold', cellWidth: 30 },
      2: { halign: 'left', cellWidth: 'auto' },
      3: { halign: 'center', cellWidth: 28 },
      4: { halign: 'center', fontStyle: 'bold', cellWidth: 28 },
      5: { halign: 'center', cellWidth: 32 },
      6: { halign: 'center', cellWidth: 36 }
    },
    margin: { left: margin, right: margin, bottom: 14 }
  });

  const totalPages = doc.internal.getNumberOfPages();
  const supervisorName = supervisorSettings?.supervisor_name || 'Anjo Alcazar';
  const supervisorTitle = supervisorSettings?.supervisor_title || 'MDC Supervisor of DC';

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const y = pageHeight - 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Confidential — Mobile Care Services Phils. Inc.  |  Distribution Center Warehouse Stock', margin, y);
    doc.text(`Authorized by: ${supervisorName} (${supervisorTitle})`, pageWidth / 2, y, { align: 'center' });
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, y, { align: 'right' });
  }

  const filename = `MDC_DC_InStock_Inventory_${new Date().toISOString().split('T')[0]}.pdf`;
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && doc.save) {
    doc.save(filename);
  }

  return { doc, filename };
}
