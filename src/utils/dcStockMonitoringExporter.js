import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { sanitizeForSpreadsheet } from './security.js';
import { MOBILECARE_LOGO_BASE64, MOBILECARE_NO_BG_LOGO_BASE64 } from '../assets/logoBase64.js';

const getPdfDoc = (options = {}) => {
  const Constructor = typeof jsPDF === 'function' ? jsPDF : (jsPDF.jsPDF || jsPDF.default);
  return new Constructor(options);
};

function triggerBrowserDownload(blob, filename) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

function addStyledTableSheet(workbook, sheetTitle, headers, rows, headerHex = 'FF0F172A') {
  const ws = workbook.addWorksheet(sheetTitle.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerHex } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
  headerRow.height = 24;

  for (const row of rows) {
    ws.addRow(row.map(v => sanitizeForSpreadsheet(v)));
  }

  headers.forEach((h, idx) => {
    const col = ws.getColumn(idx + 1);
    col.width = Math.min(42, Math.max(14, String(h).length + 6));
  });
  return ws;
}

/**
 * Builds an ExcelJS workbook buffer for the full DC Stock Monitoring suite
 * (usable directly in automated Node tests without a browser DOM, or downloaded in UI).
 */
export async function buildDcMonitoringExcelBuffer(analytics, remarksMap = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mobile Care Services Phils. Inc.';
  wb.lastModifiedBy = 'MDC DC Stock Monitoring Module';
  wb.created = new Date();

  const kpis = analytics?.kpis || {};
  const rep = analytics?.sdrAndRepTat || {};
  const sales = analytics?.salesDc || {};
  const ex = analytics?.exceptionsAndQueues || {};
  const transfers = analytics?.transferAnalytics || {};

  // Sheet 1: Executive Summary & KPI Scorecard
  addStyledTableSheet(
    wb,
    'Executive Scorecard',
    ['Metric', 'Value', 'Notes'],
    [
      ['Snapshot Generated At', analytics?.generatedAt || '', 'Automated System Computation'],
      ['Reference Aging Date', analytics?.referenceDate || '', 'Aging Anchor Date'],
      ['Total DC Transferred Serials', kpis.dcTransferSerialCount || 0, 'Unique serials dispatched from DC'],
      ['DC Serials Used in Repairs', kpis.dcUsedCount || 0, 'Matched against Fixably iPhone KGB Used'],
      ['Unused DC Stock On-Hand', kpis.dcUnusedOnHandCount || 0, 'Remaining at branches'],
      ['DC Sales Revenue (PHP)', Number((kpis.totalDcSalesPhp || 0).toFixed(2)), 'Order Picked Up on DC-sourced KGB serials'],
      ['DC Delivery Shipping Cost (PHP)', Number((kpis.totalShippingCostPhp || 0).toFixed(2)), 'Logged courier expenses'],
      ['DC Stock SDR Count (2026)', kpis.dcSdrCount || 0, `Out of ${kpis.dcRepTatMatchedCount || 0} RepTAT-matched DC repairs`],
      ['DC Stock SDR Rate (%)', `${(kpis.dcSdrRatePct || 0).toFixed(2)}%`, `vs ${(kpis.baseline2025SdrRatePct || 0).toFixed(2)}% in 2025 Non-DC`],
      ['DOA DC Stocks', kpis.doaDcCount || 0, `Total DOA across Masterlist: ${kpis.doaAllCount || 0}`],
      ['GPR Tagged Lines', kpis.gprCount || 0, 'Line status contains GPR'],
      ['Undispatched (CIN DC)', kpis.undispatchedCinCount || 0, 'Line is dispatched = No'],
      ['Unused S2S Transfers', kpis.unusedS2SCount || 0, 'Inter-branch transfers not yet closed'],
      ['Non-Serial Repairs', kpis.nonSerialRepairCount || 0, 'iPhone KGB Used with blank KGB serial']
    ],
    'FF0F172A'
  );

  // Sheet 2: RepTAT Breakdown & Multi-Site SDR Shift
  addStyledTableSheet(
    wb,
    'RepTAT & SDR Breakdown',
    ['Section', 'Category / Site', '2025 Non-DC', '2026 DC Stock', 'Difference / Lift'],
    [
      ...(rep.repTatComparison?.tatComparison || []).map(r => [
        'TAT Distribution',
        r.category,
        `${r.count2025} (${(r.pct2025 * 100).toFixed(2)}%)`,
        `${r.count2026Dc} (${(r.pct2026Dc * 100).toFixed(2)}%)`,
        `${r.pctPointDiff >= 0 ? '+' : ''}${r.pctPointDiff.toFixed(2)} pp`
      ]),
      ...(rep.repTatComparison?.multiSiteShiftSummary || []).map(s => [
        'Multi-Site SDR Shift',
        s.site,
        s.sdr2025,
        s.sdr2026,
        s.difference
      ])
    ],
    'FF1D4ED8'
  );

  // Sheet 3: DC Used Serials & RepTAT
  addStyledTableSheet(
    wb,
    'DC Used Serials',
    ['Transfer Date', 'Repair Closed Date', 'To Stock', 'Serial Used By', 'Part Number', 'Part Description', 'Serial Number', 'Order ID', 'RepTAT'],
    (analytics?.dcUsedSerials || []).map(r => [
      r.transferReceivedDate,
      r.repairClosedDate,
      r.toStock,
      r.serialUsedBy,
      r.partNumber,
      r.partDescription,
      r.transferredSerial,
      r.orderId,
      r.repTat
    ]),
    'FF0369A1'
  );

  // Sheet 4: Reconciled Site Stocks & Aging
  addStyledTableSheet(
    wb,
    'Site Stocks Reconciliation',
    ['Adjusted Received Date', 'Repair Closed Date', 'Stock Name', 'Serial Used By', 'Part Number', 'Part Description', 'Serial', 'Order ID', 'Stock Type', 'Aging Status', 'Duplicate Flag'],
    (analytics?.siteStocks?.reconciledInventory || []).map(r => [
      r.adjustedReceivedDate,
      r.repairClosedDate,
      r.stockName,
      r.serialUsedBy,
      r.partNumber,
      r.partDescription,
      r.transferredSerial,
      r.orderNumber,
      r.stockType,
      r.agingStatus,
      r.isDuplicate ? 'DUPLICATE' : ''
    ]),
    'FF15803D'
  );

  // Sheet 5: Sales (DC) & Shipping Ledger
  addStyledTableSheet(
    wb,
    'Sales DC',
    ['Month', 'Order ID', 'Closed Date', 'Location Name', 'Product Code', 'Product Name', 'Line KGB', 'Warranty', 'Status', 'Dispatched', 'Line Price (PHP)'],
    (sales.rows || []).map(r => [
      r.month, r.orderId, r.closedDate, r.locationName, r.lineProductCode, r.lineProductName,
      r.lineKgb, r.deviceWarrantyName, r.status, r.lineIsDispatched, Number((r.linePriceTotal || 0).toFixed(2))
    ]),
    'FF047857'
  );

  addStyledTableSheet(
    wb,
    'Shipping Cost & Transfers',
    ['Month', 'Courier', 'Amount (PHP)', 'Notes'],
    (transfers.shippingCosts || []).map(c => [c.month, c.courier, c.amount, c.notes || '']),
    'FF7C3AED'
  );

  if (transfers.orderReportDetails?.orders?.length > 0) {
    addStyledTableSheet(
      wb,
      'Order Report Deliveries',
      ['Order ID', 'Month', 'Year', 'Status', 'Final Charge (PHP)', 'Completed Time', 'Route / Path', 'Distance (KM)', 'Remark / TS Ref', 'Service Type'],
      transfers.orderReportDetails.orders.map(o => [
        o.orderId,
        o.month,
        o.year,
        o.status,
        o.finalCharge,
        o.completedTime || o.createdTime,
        o.orderPath,
        o.distanceKm,
        o.remark,
        o.serviceType
      ]),
      'FF059669'
    );
  }

  // Sheet 6: Exceptions & Investigation Queues
  addStyledTableSheet(
    wb,
    'Exceptions & Audit Queue',
    ['Queue Type', 'Order ID', 'Date', 'Location / To Stock', 'Part Number', 'Part Description', 'Serial / KGB', 'Auto Diagnostic / Warranty', 'Investigation Remark'],
    [
      ...(ex.doaDcStockRows || []).map(r => [
        'DOA (DC Stock)', r.orderId, r.closedDate, r.locationName, r.lineProductCode, r.lineProductName, r.lineKgb, r.deviceWarrantyName, remarksMap[`doa::${r.orderId}::${r.lineKgb}`]?.remark || ''
      ]),
      ...(ex.gprRows || []).map(r => [
        'GPR', r.orderId, r.closedDate, r.locationName, r.lineProductCode, r.lineProductName, r.lineKgb, r.lineStatusName, remarksMap[`gpr::${r.orderId}`]?.remark || ''
      ]),
      ...(ex.unusedS2SSerials || []).map(r => [
        'Unused S2S Transfer', r.orderNumber || '-', r.transferReceivedDate, `${r.fromStock} -> ${r.toStock}`, r.partNumber, r.partDescription, r.transferredSerial, 'S2S Unconsumed', remarksMap[`s2s::${r.transferredSerial}`]?.remark || ''
      ]),
      ...(ex.nonSerialRepairs || []).map(r => [
        'Non-Serial Repair', r.orderId, r.repairClosedDate, r.locationName, r.productCode, r.productDescription, r.inferredKgb || '(Missing)', r.autoDiagnostic, remarksMap[`nsr::${r.orderId}`]?.remark || ''
      ])
    ],
    'FFB91C1C'
  );

  return wb.xlsx.writeBuffer();
}

export async function exportDcMonitoringToExcel(analytics, remarksMap = {}, fileName = 'MDC_DC_Stock_Monitoring_Report') {
  const buffer = await buildDcMonitoringExcelBuffer(analytics, remarksMap);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerBrowserDownload(blob, `${fileName}_${dateTag}.xlsx`);
}

/**
 * Generates an executive PDF Summary specifically for SDR & RepTAT Breakdown Analytics
 * (2025 Baseline vs 2026 DC Stock, TAT buckets, Warranty Mix, Multi-Site Shift).
 */
export function buildSdrRepTatPdfDocument(analytics) {
  const doc = getPdfDoc({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const kpis = analytics?.kpis || {};
  const rep = analytics?.sdrAndRepTat || {};

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 24, 'F');
  try {
    const logo = MOBILECARE_NO_BG_LOGO_BASE64 || MOBILECARE_LOGO_BASE64;
    if (logo) doc.addImage(logo, 'PNG', 12, 6, 22, 10.65);
  } catch (_) {}

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MOBILECARE DC SYSTEM — SDR & RepTAT Breakdown Executive Report', 40, 11);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleString()} | DC SDR Rate: ${(kpis.dcSdrRatePct || 0).toFixed(2)}% vs 2025 Non-DC: ${(kpis.baseline2025SdrRatePct || 0).toFixed(2)}%`, 40, 17.5);

  // Section 1: TAT Distribution Comparison
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Turnaround Time (TAT) Distribution: 2025 Non-DC Stock vs 2026 DC Stock', 14, 32);

  autoTable(doc, {
    startY: 35,
    head: [['TAT Category', '2025 Non-DC Count', '2025 Share %', '2026 DC Stock Count', '2026 DC Share %', 'Shift (pp)']],
    body: (rep.repTatComparison?.tatComparison || []).map(r => [
      r.category,
      r.count2025.toLocaleString(),
      `${(r.pct2025 * 100).toFixed(2)}%`,
      r.count2026Dc.toLocaleString(),
      `${(r.pct2026Dc * 100).toFixed(2)}%`,
      `${r.pctPointDiff >= 0 ? '+' : ''}${r.pctPointDiff.toFixed(2)} pp`
    ]),
    theme: 'grid',
    headStyles: { fillColor: [29, 78, 216], textColor: 255, fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5 },
    margin: { left: 14, right: 14 }
  });

  // Section 2: Multi-Site SDR Growth Top 15
  const afterY = (doc.lastAutoTable?.finalY || 95) + 8;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('2. Multi-Site SDR Volume Shift (2025 Non-DC Baseline vs 2026 DC Stock)', 14, afterY);

  autoTable(doc, {
    startY: afterY + 3,
    head: [['Branch Site', 'SDR - 2025 (Non-DC)', 'SDR - 2026 (DC)', 'Difference (2026 - 2025)']],
    body: (rep.repTatComparison?.multiSiteShiftSummary || []).slice(0, 18).map(s => [
      s.site,
      s.sdr2025.toLocaleString(),
      s.sdr2026.toLocaleString(),
      `${s.difference >= 0 ? '+' : ''}${s.difference.toLocaleString()}`
    ]),
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8.5 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 14, right: 14 }
  });

  return doc;
}

export function exportSdrRepTatToPdf(analytics, fileName = 'MDC_SDR_RepTAT_Breakdown_Report') {
  const doc = buildSdrRepTatPdfDocument(analytics);
  const dateTag = new Date().toISOString().slice(0, 10);
  doc.save(`${fileName}_${dateTag}.pdf`);
}

/**
 * Exports any filtered table slice safely to CSV with formula-injection protection.
 */
export function exportRowsToCsv(headers = [], rows = [], fileName = 'mdc_export') {
  const escapeCell = (val) => {
    const safe = sanitizeForSpreadsheet(val);
    const s = String(safe ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map(r => r.map(escapeCell).join(','))
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerBrowserDownload(blob, `${fileName}_${dateTag}.csv`);
}
