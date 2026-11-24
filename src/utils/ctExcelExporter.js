import ExcelJS from 'exceljs';
import { getSiteColorTheme, isCanonicalToolKind } from './ctSpreadsheetImporter.js';
import { formatTo12HourTime } from './dateUtils.js';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5 };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
const SECTION_FONT = { bold: true, color: { argb: 'FF0369A1' }, size: 11 };
const META_LABEL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
const SUBHEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const ZEBRA_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
};

function formatIsoDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function formatReadableTime(iso) {
  if (!iso) return '';
  try {
    return formatTo12HourTime ? formatTo12HourTime(iso) : String(iso).slice(11, 19);
  } catch {
    return String(iso).slice(11, 19);
  }
}

function styleTableHeader(row) {
  row.height = 25;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = THIN_BORDER;
  });
}

function styleSectionBanner(ws, row, colSpan) {
  row.height = 22;
  const endCol = ws.getColumn(colSpan).letter;
  ws.mergeCells(`A${row.number}:${endCol}${row.number}`);
  const cell = row.getCell(1);
  cell.fill = SECTION_FILL;
  cell.font = SECTION_FONT;
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  cell.border = THIN_BORDER;
}

function styleMetaRow(row) {
  row.height = 20;
  [1, 3].forEach((colIdx) => {
    const c = row.getCell(colIdx);
    c.fill = META_LABEL_FILL;
    c.font = { bold: true, size: 10, color: { argb: 'FF334155' } };
    c.alignment = { vertical: 'middle', horizontal: 'left' };
    c.border = THIN_BORDER;
  });
  [2, 4].forEach((colIdx) => {
    const c = row.getCell(colIdx);
    c.font = { size: 10, color: { argb: 'FF0F172A' } };
    c.alignment = { vertical: 'middle', horizontal: 'left' };
    c.border = THIN_BORDER;
  });
}

function styleDataRow(row, isEven = false, { wrapCols = [] } = {}) {
  const wrapSet = new Set(wrapCols);
  row.eachCell((cell, colNumber) => {
    if (isEven) cell.fill = ZEBRA_FILL;
    cell.border = THIN_BORDER;
    const isNum = typeof cell.value === 'number';
    cell.alignment = {
      vertical: 'middle',
      horizontal: isNum ? 'center' : 'left',
      wrapText: wrapSet.has(colNumber)
    };
    cell.font = { size: 10, color: { argb: 'FF0F172A' } };
  });
}

function styleTotalsRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.fill = SUBHEADER_FILL;
    cell.font = { bold: true, size: 10.5, color: { argb: 'FF0F172A' } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: typeof cell.value === 'number' ? 'center' : 'left'
    };
    cell.border = THIN_BORDER;
  });
}

function applyStatusCellStyle(cell, status) {
  const s = String(status || '').toLowerCase();
  if (s === 'available' || s === 'delivered' || s === 'ok') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
    cell.font = { bold: true, size: 10, color: { argb: 'FF166534' } };
  } else if (s === 'in_use' || s === 'shipped') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    cell.font = { bold: true, size: 10, color: { argb: 'FF1D4ED8' } };
  } else if (s === 'missing' || s === 'low stock') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    cell.font = { bold: true, size: 10, color: { argb: 'FFB91C1C' } };
  } else if (s === 'retired') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.font = { bold: true, size: 10, color: { argb: 'FF475569' } };
  }
}

function triggerExcelDownload(buffer, fileName) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Builds an ExcelJS workbook buffer for Consumables & Service Tools Center.
 * Strictly filters tool assets and consumables stock to `siteFilter` when a specific site is selected,
 * or includes all sites when `siteFilter === 'ALL'`.
 * Sheet 1 (Summary) includes both Site Totals and a full Part Number + Description breakdown.
 */
export async function buildCtCenterExcelBuffer({
  toolAssets = [],
  consumablesStock = [],
  catalog = [],
  siteFilter = 'ALL',
  statusFilter = 'ALL',
  searchQuery = '',
  generatedBy = 'Admin'
} = {}) {
  const cleanSite = String(siteFilter || 'ALL').trim().toUpperCase();
  const isAllSites = !cleanSite || cleanSite === 'ALL';
  const cleanStatus = String(statusFilter || 'ALL').trim().toLowerCase();
  const q = String(searchQuery || '').trim().toLowerCase();

  const catalogDescMap = new Map();
  (catalog || []).forEach(c => {
    if (c?.part_number) {
      catalogDescMap.set(String(c.part_number).trim().toUpperCase(), c);
    }
  });

  const resolveDesc = (pn, fallback = '') => {
    if (fallback) return fallback;
    return catalogDescMap.get(String(pn || '').trim().toUpperCase())?.description || '';
  };

  const scopedTools = (toolAssets || []).filter(a => {
    if (!isAllSites && String(a.site_code || '').trim().toUpperCase() !== cleanSite) return false;
    if (cleanStatus && cleanStatus !== 'all' && String(a.status || '').toLowerCase() !== cleanStatus) return false;
    if (q) {
      const desc = resolveDesc(a.part_number, a.description);
      const hay = `${a.asset_tag || ''} ${a.admin_asset_tag || ''} ${a.serial_number || ''} ${a.part_number || ''} ${desc} ${a.assigned_to || ''} ${a.site_code || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const scopedConsumables = (consumablesStock || []).filter(row => {
    const qty = Number(row.qty_on_hand || 0);
    if (qty <= 0) return false;
    if (!isAllSites && String(row.site_code || '').trim().toUpperCase() !== cleanSite) return false;
    const cat = catalogDescMap.get(String(row.part_number || '').trim().toUpperCase());
    if (isCanonicalToolKind(row.part_number, row.description, row.item_kind || cat?.item_kind)) return false;
    if (q) {
      const desc = resolveDesc(row.part_number, row.description);
      const hay = `${row.part_number || ''} ${desc} ${row.site_code || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = generatedBy;
  workbook.created = new Date();

  // ── Sheet 1: Summary (Site Totals + Detailed Part Number & Description Breakdown) ──
  const summaryWs = workbook.addWorksheet('Summary');
  summaryWs.columns = [
    { key: 'c1', width: 22 },
    { key: 'c2', width: 18 },
    { key: 'c3', width: 18 },
    { key: 'c4', width: 20 },
    { key: 'c5', width: 42 },
    { key: 'c6', width: 12 },
    { key: 'c7', width: 12 },
    { key: 'c8', width: 12 },
    { key: 'c9', width: 12 },
    { key: 'c10', width: 12 },
    { key: 'c11', width: 12 },
    { key: 'c12', width: 24 },
    { key: 'c13', width: 32 }
  ];

  const titleRow = summaryWs.addRow(['Consumables & Service Tools Center — Inventory Report']);
  titleRow.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
  titleRow.height = 28;
  summaryWs.mergeCells('A1:M1');

  const metaRows = [
    ['Site Scope', isAllSites ? 'All Sites' : cleanSite, 'Status Filter', cleanStatus === 'all' ? 'All Statuses' : cleanStatus.toUpperCase()],
    ['Search Filter', searchQuery || 'None', 'Generated By', generatedBy],
    ['Generated At', new Date().toLocaleString(), 'Total Tracked Tools', scopedTools.length],
    ['Consumables Qty On Hand', scopedConsumables.reduce((s, r) => s + Number(r.qty_on_hand || 0), 0), 'Consumable SKUs', scopedConsumables.length]
  ];
  metaRows.forEach(vals => styleMetaRow(summaryWs.addRow(vals)));
  summaryWs.addRow([]);

  // 1A. Detailed Breakdown by Part Number & Description (Primary view on Summary)
  styleSectionBanner(summaryWs, summaryWs.addRow(['Detailed Inventory Breakdown by Part Number & Description']), 13);
  const partHeader = summaryWs.addRow([
    'Site Code',
    'Item Kind',
    'Ownership Tag',
    'Part Number',
    'Description',
    'Total Qty',
    'Available',
    'In Use',
    'Shipped',
    'Missing',
    'Retired',
    'Assigned To',
    'System / Asset Tags'
  ]);
  styleTableHeader(partHeader);

  const partGroups = new Map();
  const getPartGroup = (site, kind, pn, desc, ownershipTag = 'Apple-Owned') => {
    const sCode = String(site || 'UNASSIGNED').trim().toUpperCase();
    const pCode = String(pn || '').trim().toUpperCase();
    const key = `${sCode}::${kind}::${pCode}`;
    if (!partGroups.has(key)) {
      partGroups.set(key, {
        site: sCode,
        kind,
        ownershipTag: ownershipTag || 'Apple-Owned',
        partNumber: pCode,
        description: desc || '—',
        totalQty: 0,
        available: 0,
        inUse: 0,
        shipped: 0,
        missing: 0,
        retired: 0,
        assignees: new Set(),
        tags: []
      });
    }
    return partGroups.get(key);
  };

  scopedTools.forEach(a => {
    const desc = resolveDesc(a.part_number, a.description);
    const g = getPartGroup(a.site_code, 'TOOL', a.part_number, desc, a.ownership_tag || 'Apple-Owned');
    g.totalQty += 1;
    const st = String(a.status || '').toLowerCase();
    if (st === 'available') g.available += 1;
    else if (st === 'in_use') g.inUse += 1;
    else if (st === 'shipped') g.shipped += 1;
    else if (st === 'missing') g.missing += 1;
    else if (st === 'retired') g.retired += 1;
    if (a.assigned_to) g.assignees.add(a.assigned_to);
    if (a.asset_tag) {
      g.tags.push(a.admin_asset_tag ? `${a.asset_tag} [${a.admin_asset_tag}]` : a.asset_tag);
    }
  });

  scopedConsumables.forEach(c => {
    const desc = resolveDesc(c.part_number, c.description);
    const qty = Number(c.qty_on_hand || 0);
    const g = getPartGroup(c.site_code, 'CONSUMABLE', c.part_number, desc, c.ownership_tag || 'Apple-Owned');
    g.totalQty += qty;
    g.available += qty;
  });

  const sortedPartGroups = Array.from(partGroups.values()).sort((a, b) => {
    const siteCmp = a.site.localeCompare(b.site);
    if (siteCmp !== 0) return siteCmp;
    const kindCmp = a.kind.localeCompare(b.kind);
    if (kindCmp !== 0) return kindCmp;
    return a.partNumber.localeCompare(b.partNumber);
  });

  if (sortedPartGroups.length === 0) {
    const emptyRow = summaryWs.addRow(['No tools or consumables match the selected filter.']);
    emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };
  } else {
    const partFirstRow = summaryWs.rowCount + 1;
    sortedPartGroups.forEach((g, idx) => {
      const r = summaryWs.addRow([
        g.site,
        g.kind,
        g.ownershipTag,
        g.partNumber,
        g.description,
        g.totalQty,
        g.available,
        g.inUse,
        g.shipped,
        g.missing,
        g.retired,
        g.assignees.size > 0 ? Array.from(g.assignees).join(', ') : '—',
        g.tags.length > 0 ? g.tags.join(', ') : '—'
      ]);
      styleDataRow(r, idx % 2 === 1, { wrapCols: [5, 12, 13] });
      const theme = getSiteColorTheme(g.site);
      r.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.excelFill } };
      });
      for (let c = 6; c <= 11; c++) r.getCell(c).numFmt = '#,##0';
    });
    const partLastRow = summaryWs.rowCount;

    const partTotals = summaryWs.addRow([
      'TOTAL',
      `${sortedPartGroups.length} SKU(s)`,
      '',
      '',
      '',
      { formula: `SUM(F${partFirstRow}:F${partLastRow})`, result: sortedPartGroups.reduce((a, b) => a + b.totalQty, 0) },
      { formula: `SUM(G${partFirstRow}:G${partLastRow})`, result: sortedPartGroups.reduce((a, b) => a + b.available, 0) },
      { formula: `SUM(H${partFirstRow}:H${partLastRow})`, result: sortedPartGroups.reduce((a, b) => a + b.inUse, 0) },
      { formula: `SUM(I${partFirstRow}:I${partLastRow})`, result: sortedPartGroups.reduce((a, b) => a + b.shipped, 0) },
      { formula: `SUM(J${partFirstRow}:J${partLastRow})`, result: sortedPartGroups.reduce((a, b) => a + b.missing, 0) },
      { formula: `SUM(K${partFirstRow}:K${partLastRow})`, result: sortedPartGroups.reduce((a, b) => a + b.retired, 0) },
      '',
      ''
    ]);
    styleTotalsRow(partTotals);
    for (let c = 6; c <= 11; c++) partTotals.getCell(c).numFmt = '#,##0';
  }

  summaryWs.addRow([]);

  // 1B. Site-by-Site Rollup Table
  styleSectionBanner(summaryWs, summaryWs.addRow(['Site-by-Site Totals Rollup']), 10);
  const sumHeader = summaryWs.addRow([
    'Site Code',
    'Total Tools',
    'Available',
    'In Use',
    'Shipped',
    'Missing',
    'Retired',
    'With Admin Tag',
    'Consumable SKUs',
    'Consumables Qty'
  ]);
  styleTableHeader(sumHeader);

  const siteMap = new Map();
  const ensureSite = (code) => {
    const k = String(code || 'UNASSIGNED').trim().toUpperCase();
    if (!siteMap.has(k)) {
      siteMap.set(k, {
        site: k,
        totalTools: 0,
        available: 0,
        inUse: 0,
        shipped: 0,
        missing: 0,
        retired: 0,
        taggedAdmin: 0,
        consSkus: 0,
        consQty: 0
      });
    }
    return siteMap.get(k);
  };

  scopedTools.forEach(a => {
    const bucket = ensureSite(a.site_code);
    bucket.totalTools += 1;
    const st = String(a.status || '').toLowerCase();
    if (st === 'available') bucket.available += 1;
    else if (st === 'in_use') bucket.inUse += 1;
    else if (st === 'shipped') bucket.shipped += 1;
    else if (st === 'missing') bucket.missing += 1;
    else if (st === 'retired') bucket.retired += 1;
    if (a.admin_asset_tag) bucket.taggedAdmin += 1;
  });

  scopedConsumables.forEach(c => {
    const bucket = ensureSite(c.site_code);
    bucket.consSkus += 1;
    bucket.consQty += Number(c.qty_on_hand || 0);
  });

  const sortedSites = Array.from(siteMap.values()).sort((a, b) => a.site.localeCompare(b.site));
  const siteFirstRow = summaryWs.rowCount + 1;
  sortedSites.forEach((s, idx) => {
    const r = summaryWs.addRow([
      s.site,
      s.totalTools,
      s.available,
      s.inUse,
      s.shipped,
      s.missing,
      s.retired,
      s.taggedAdmin,
      s.consSkus,
      s.consQty
    ]);
    styleDataRow(r, idx % 2 === 1);
    const theme = getSiteColorTheme(s.site);
    r.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.excelFill } };
    });
    for (let c = 2; c <= 10; c++) r.getCell(c).numFmt = '#,##0';
  });
  const siteLastRow = summaryWs.rowCount;

  if (sortedSites.length > 0) {
    const totalsRow = summaryWs.addRow([
      'TOTAL',
      { formula: `SUM(B${siteFirstRow}:B${siteLastRow})`, result: sortedSites.reduce((a, b) => a + b.totalTools, 0) },
      { formula: `SUM(C${siteFirstRow}:C${siteLastRow})`, result: sortedSites.reduce((a, b) => a + b.available, 0) },
      { formula: `SUM(D${siteFirstRow}:D${siteLastRow})`, result: sortedSites.reduce((a, b) => a + b.inUse, 0) },
      { formula: `SUM(E${siteFirstRow}:E${siteLastRow})`, result: sortedSites.reduce((a, b) => a + b.shipped, 0) },
      { formula: `SUM(F${siteFirstRow}:F${siteLastRow})`, result: sortedSites.reduce((a, b) => a + b.missing, 0) },
      { formula: `SUM(G${siteFirstRow}:G${siteLastRow})`, result: sortedSites.reduce((a, b) => a + b.retired, 0) },
      { formula: `SUM(H${siteFirstRow}:H${siteLastRow})`, result: sortedSites.reduce((a, b) => a + b.taggedAdmin, 0) },
      { formula: `SUM(I${siteFirstRow}:I${siteLastRow})`, result: sortedSites.reduce((a, b) => a + b.consSkus, 0) },
      { formula: `SUM(J${siteFirstRow}:J${siteLastRow})`, result: sortedSites.reduce((a, b) => a + b.consQty, 0) }
    ]);
    styleTotalsRow(totalsRow);
    for (let c = 2; c <= 10; c++) totalsRow.getCell(c).numFmt = '#,##0';
  }

  summaryWs.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ── Sheet 2: Tracked Tool Units ────────────────────────────────────────
  const toolsWs = workbook.addWorksheet('Tracked Tool Units', { views: [{ state: 'frozen', ySplit: 1 }] });
  toolsWs.columns = [
    { header: 'System Asset Tag', key: 'asset_tag', width: 24 },
    { header: 'Admin Asset Tag', key: 'admin_asset_tag', width: 22 },
    { header: 'Serial Number', key: 'serial_number', width: 20 },
    { header: 'Part Number', key: 'part_number', width: 16 },
    { header: 'Description', key: 'description', width: 42 },
    { header: 'Site', key: 'site_code', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Assigned To', key: 'assigned_to', width: 22 },
    { header: 'Ownership Tag', key: 'ownership_tag', width: 18 },
    { header: 'Assigned Date', key: 'assigned_at', width: 14 },
    { header: 'PO Reference', key: 'po_number', width: 18 },
    { header: 'Last Updated', key: 'updated_at', width: 16 },
    { header: 'Notes', key: 'notes', width: 32 }
  ];
  styleTableHeader(toolsWs.getRow(1));
  toolsWs.autoFilter = 'A1:M1';

  scopedTools.forEach((a, idx) => {
    const r = toolsWs.addRow({
      asset_tag: a.asset_tag || '',
      admin_asset_tag: a.admin_asset_tag || '',
      serial_number: a.serial_number || '',
      part_number: a.part_number || '',
      description: resolveDesc(a.part_number, a.description),
      site_code: a.site_code || '',
      status: String(a.status || '').toUpperCase(),
      assigned_to: a.assigned_to || '',
      ownership_tag: a.ownership_tag || 'Apple-Owned',
      assigned_at: formatIsoDate(a.assigned_at),
      po_number: a.po_number || a.order_po_number || '',
      updated_at: formatIsoDate(a.updated_at || a.created_at),
      notes: a.notes || ''
    });
    styleDataRow(r, idx % 2 === 1, { wrapCols: [5, 13] });
    applyStatusCellStyle(r.getCell('status'), a.status);
  });

  // ── Sheet 3: Consumables Stock ─────────────────────────────────────────
  const consWs = workbook.addWorksheet('Consumables Stock', { views: [{ state: 'frozen', ySplit: 1 }] });
  consWs.columns = [
    { header: 'Site', key: 'site_code', width: 16 },
    { header: 'Ownership Tag', key: 'ownership_tag', width: 18 },
    { header: 'Part Number', key: 'part_number', width: 18 },
    { header: 'Description', key: 'description', width: 44 },
    { header: 'Qty On Hand', key: 'qty_on_hand', width: 14 },
    { header: 'Reorder Level', key: 'reorder_level', width: 14 },
    { header: 'Stock Status', key: 'stock_status', width: 14 },
    { header: 'Last Updated', key: 'updated_at', width: 16 }
  ];
  styleTableHeader(consWs.getRow(1));
  consWs.autoFilter = 'A1:H1';

  scopedConsumables.forEach((row, idx) => {
    const cat = catalogDescMap.get(String(row.part_number || '').trim().toUpperCase());
    const qty = Number(row.qty_on_hand || 0);
    const reorder = Number(row.reorder_level ?? cat?.reorder_level ?? 0);
    const stockStatus = reorder > 0 && qty <= reorder ? 'Low Stock' : 'OK';
    const r = consWs.addRow({
      site_code: row.site_code || '',
      ownership_tag: row.ownership_tag || 'Apple-Owned',
      part_number: row.part_number || '',
      description: resolveDesc(row.part_number, row.description),
      qty_on_hand: qty,
      reorder_level: reorder,
      stock_status: stockStatus,
      updated_at: formatIsoDate(row.updated_at || row.last_received_at)
    });
    styleDataRow(r, idx % 2 === 1, { wrapCols: [4] });
    applyStatusCellStyle(r.getCell('stock_status'), stockStatus);
  });

  return workbook.xlsx.writeBuffer();
}

export async function exportCtCenterToExcel(options = {}) {
  const buffer = await buildCtCenterExcelBuffer(options);
  const cleanSite = String(options.siteFilter || 'ALL').trim().toUpperCase();
  const siteSlug = !cleanSite || cleanSite === 'ALL'
    ? 'All_Sites'
    : cleanSite.replace(/[^A-Z0-9_-]+/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `MDC_Consumables_Tools_${siteSlug}_${dateStr}.xlsx`;
  triggerExcelDownload(buffer, fileName);
  return fileName;
}

/**
 * Builds an ExcelJS workbook buffer for CT Movement & Shipment Archive.
 * Includes Movement Summary (with Part Number & Description breakdown + Action rollup),
 * All Item Movements, and Shipments Archive tabs reflecting active UI filters.
 */
export async function buildCtMovementsExcelBuffer({
  movements = [],
  shipments = [],
  siteRegionMap = null,
  regionFilter = 'ALL',
  siteFilter = 'ALL',
  actionFilter = 'ALL',
  dateFrom = '',
  dateTo = '',
  searchQuery = '',
  generatedBy = 'Admin'
} = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = generatedBy;
  workbook.created = new Date();

  const resolveRegion = (code) => {
    if (!code) return '';
    if (siteRegionMap && typeof siteRegionMap.get === 'function') {
      return siteRegionMap.get(String(code).toUpperCase()) || 'Province';
    }
    return String(code).toUpperCase() === 'DC-MDC' ? 'Metro Manila' : 'Province';
  };

  // ── Sheet 1: Movement Summary (Part Breakdown + Action Summary) ────────
  const summaryWs = workbook.addWorksheet('Movement Summary');
  summaryWs.columns = [
    { key: 'c1', width: 22 },
    { key: 'c2', width: 42 },
    { key: 'c3', width: 16 },
    { key: 'c4', width: 14 },
    { key: 'c5', width: 16 },
    { key: 'c6', width: 32 },
    { key: 'c7', width: 24 },
    { key: 'c8', width: 16 }
  ];

  const titleRow = summaryWs.addRow(['Consumables & Tools — Movement & Shipment Archive Report']);
  titleRow.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
  titleRow.height = 28;
  summaryWs.mergeCells('A1:H1');

  const metaRows = [
    ['Region Filter', regionFilter === 'ALL' ? 'All Sites' : regionFilter, 'Site Filter', siteFilter === 'ALL' ? 'All Locations' : siteFilter],
    ['Action Filter', actionFilter === 'ALL' ? 'All Actions' : String(actionFilter).toUpperCase(), 'Date Range', (dateFrom || dateTo) ? `${dateFrom || 'Start'} → ${dateTo || 'Present'}` : 'All Dates'],
    ['Search Filter', searchQuery || 'None', 'Generated By', generatedBy],
    ['Total Shipments', shipments.length, 'Total Movements', movements.length]
  ];
  metaRows.forEach(vals => styleMetaRow(summaryWs.addRow(vals)));
  summaryWs.addRow([]);

  // 1A. Part Number & Description Movement Breakdown
  styleSectionBanner(summaryWs, summaryWs.addRow(['Movement Breakdown by Part Number & Description']), 8);
  const partMovHeader = summaryWs.addRow([
    'Part Number',
    'Description',
    'Item Kind',
    'Events',
    'Total Qty Moved',
    'Actions Breakdown',
    'Sites Involved',
    'Latest Activity'
  ]);
  styleTableHeader(partMovHeader);

  const movPartMap = new Map();
  (movements || []).forEach(m => {
    const pn = String(m.part_number || 'UNKNOWN').trim().toUpperCase();
    if (!movPartMap.has(pn)) {
      movPartMap.set(pn, {
        partNumber: pn,
        description: m.description || '—',
        kind: String(m.item_kind || '').toUpperCase() || '—',
        events: 0,
        totalQty: 0,
        actions: new Map(),
        sites: new Set(),
        latestDate: ''
      });
    }
    const g = movPartMap.get(pn);
    if ((!g.description || g.description === '—') && m.description) g.description = m.description;
    g.events += 1;
    const qty = Number(m.quantity || 0);
    g.totalQty += qty;
    const act = String(m.action || 'other').replace(/_/g, ' ').toUpperCase();
    g.actions.set(act, (g.actions.get(act) || 0) + qty);
    if (m.from_site_code) g.sites.add(m.from_site_code);
    if (m.to_site_code) g.sites.add(m.to_site_code);
    const dStr = formatIsoDate(m.created_at);
    if (dStr && dStr > g.latestDate) g.latestDate = dStr;
  });

  const sortedMovParts = Array.from(movPartMap.values()).sort((a, b) => b.totalQty - a.totalQty || a.partNumber.localeCompare(b.partNumber));
  sortedMovParts.forEach((g, idx) => {
    const actionsStr = Array.from(g.actions.entries()).map(([k, v]) => `${k}: ${v}`).join(', ');
    const r = summaryWs.addRow([
      g.partNumber,
      g.description,
      g.kind,
      g.events,
      g.totalQty,
      actionsStr,
      Array.from(g.sites).join(', ') || '—',
      g.latestDate || '—'
    ]);
    styleDataRow(r, idx % 2 === 1, { wrapCols: [2, 6, 7] });
  });

  if (sortedMovParts.length > 0) {
    const movPartTotals = summaryWs.addRow([
      'TOTAL',
      `${sortedMovParts.length} Part(s)`,
      '',
      sortedMovParts.reduce((a, b) => a + b.events, 0),
      sortedMovParts.reduce((a, b) => a + b.totalQty, 0),
      '',
      '',
      ''
    ]);
    styleTotalsRow(movPartTotals);
  }

  summaryWs.addRow([]);

  // 1B. Action Breakdown
  styleSectionBanner(summaryWs, summaryWs.addRow(['Movement Summary by Action Type']), 4);
  const actHeader = summaryWs.addRow(['Movement Action', 'Event Count', 'Total Units', 'Share of Events']);
  styleTableHeader(actHeader);

  const actionBuckets = new Map();
  (movements || []).forEach(m => {
    const key = String(m.action || 'other').toLowerCase();
    if (!actionBuckets.has(key)) actionBuckets.set(key, { count: 0, qty: 0 });
    const b = actionBuckets.get(key);
    b.count += 1;
    b.qty += Number(m.quantity || 0);
  });

  const totalMovEvents = Math.max(1, (movements || []).length);
  Array.from(actionBuckets.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([action, stats], idx) => {
      const r = summaryWs.addRow([
        action.replace(/_/g, ' ').toUpperCase(),
        stats.count,
        stats.qty,
        `${((stats.count / totalMovEvents) * 100).toFixed(1)}%`
      ]);
      styleDataRow(r, idx % 2 === 1);
    });

  // ── Sheet 2: All Item Movements ────────────────────────────────────────
  const movWs = workbook.addWorksheet('All Item Movements', { views: [{ state: 'frozen', ySplit: 1 }] });
  movWs.columns = [
    { header: 'Date', key: 'date', width: 13 },
    { header: 'Time', key: 'time', width: 13 },
    { header: 'Action', key: 'action', width: 15 },
    { header: 'Part Number', key: 'part_number', width: 16 },
    { header: 'Description', key: 'description', width: 42 },
    { header: 'Kind', key: 'item_kind', width: 13 },
    { header: 'Qty', key: 'quantity', width: 9 },
    { header: 'From Site', key: 'from_site', width: 16 },
    { header: 'To Site', key: 'to_site', width: 16 },
    { header: 'Serial Numbers', key: 'serials', width: 26 },
    { header: 'Asset Tags', key: 'tags', width: 30 },
    { header: 'Reference #', key: 'ref', width: 20 },
    { header: 'Performed By', key: 'user', width: 20 },
    { header: 'Notes', key: 'notes', width: 38 }
  ];
  styleTableHeader(movWs.getRow(1));
  movWs.autoFilter = 'A1:N1';

  (movements || []).forEach((m, idx) => {
    const r = movWs.addRow({
      date: formatIsoDate(m.created_at),
      time: formatReadableTime(m.created_at),
      action: String(m.action || '').replace(/_/g, ' ').toUpperCase(),
      part_number: m.part_number || '',
      description: m.description || '',
      item_kind: String(m.item_kind || '').toUpperCase(),
      quantity: Number(m.quantity || 0),
      from_site: m.from_site_code || '',
      to_site: m.to_site_code || '',
      serials: (m.serial_numbers || []).join(', '),
      tags: (m.asset_tags || []).join(', '),
      ref: m.reference_number || '',
      user: m.performed_by_name || '',
      notes: m.notes || ''
    });
    styleDataRow(r, idx % 2 === 1, { wrapCols: [5, 11, 14] });
  });

  // ── Sheet 3: Shipments Archive ─────────────────────────────────────────
  const shpWs = workbook.addWorksheet('Shipments Archive', { views: [{ state: 'frozen', ySplit: 1 }] });
  shpWs.columns = [
    { header: 'Packing List #', key: 'pl', width: 20 },
    { header: 'TS #', key: 'ts', width: 16 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Ship Date', key: 'ship_date', width: 13 },
    { header: 'Received Date', key: 'recv_date', width: 14 },
    { header: 'From Site', key: 'from_site', width: 14 },
    { header: 'Destination Site', key: 'to_site', width: 16 },
    { header: 'Destination Name', key: 'to_name', width: 26 },
    { header: 'Region', key: 'region', width: 15 },
    { header: 'Courier', key: 'carrier', width: 18 },
    { header: 'Waybill / Tracking #', key: 'tracking', width: 20 },
    { header: 'Total Units', key: 'total_units', width: 12 },
    { header: 'Line Count', key: 'line_count', width: 11 },
    { header: 'Prepared By', key: 'prep_by', width: 20 },
    { header: 'Received By', key: 'recv_by', width: 20 },
    { header: 'Items Summary (Part # & Description)', key: 'items_summary', width: 52 }
  ];
  styleTableHeader(shpWs.getRow(1));
  shpWs.autoFilter = 'A1:P1';

  (shipments || []).forEach((shp, idx) => {
    const items = Array.isArray(shp.items) ? shp.items : [];
    const totalUnits = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    const itemsSummary = items
      .map(it => `${it.part_number} — ${it.description || 'Item'} (x${it.quantity})`)
      .join('; ');
    const r = shpWs.addRow({
      pl: shp.packing_list_number || shp.shipment_number || '',
      ts: shp.ts_number || '',
      status: shp.status === 'delivered' ? 'DELIVERED' : String(shp.status || '').toUpperCase(),
      ship_date: shp.shipment_date || formatIsoDate(shp.created_at),
      recv_date: formatIsoDate(shp.received_at),
      from_site: shp.from_site_code || 'DC-MDC',
      to_site: shp.to_site_code || '',
      to_name: shp.to_site_name || shp.to_site_code || '',
      region: resolveRegion(shp.to_site_code),
      carrier: shp.carrier || 'Lalamove',
      tracking: shp.tracking_number || '',
      total_units: totalUnits,
      line_count: items.length,
      prep_by: shp.prepared_by_name || '',
      recv_by: shp.received_by_name || '',
      items_summary: itemsSummary
    });
    styleDataRow(r, idx % 2 === 1, { wrapCols: [16] });
    applyStatusCellStyle(r.getCell('status'), shp.status);
  });

  return workbook.xlsx.writeBuffer();
}

export async function exportCtMovementsToExcel(options = {}) {
  const buffer = await buildCtMovementsExcelBuffer(options);
  const cleanSite = String(options.siteFilter || 'ALL').trim().toUpperCase();
  const siteSlug = !cleanSite || cleanSite === 'ALL'
    ? (options.regionFilter && options.regionFilter !== 'ALL' ? String(options.regionFilter).replace(/\s+/g, '_') : 'All_Sites')
    : cleanSite.replace(/[^A-Z0-9_-]+/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `MDC_CT_Movement_Archive_${siteSlug}_${dateStr}.xlsx`;
  triggerExcelDownload(buffer, fileName);
  return fileName;
}

/**
 * Builds the 3-tab Consolidated Multi-Site Audit Excel Workbook:
 *  - Tab 1: "Summary by Site" (KPI header, pastel site colors, dynamic =SUM() totals)
 *  - Tab 2: "Summary by Part Number" (Sorted by Type -> Part Number, dynamic =SUM() totals)
 *  - Tab 3: "All Line Items" (Pastel site colors, amber #FFF3CD on blank Report Ref, =Qty*USD Price formulas)
 */
export async function buildCtConsolidatedAuditExcelBuffer({
  items = [],
  sites = [],
  generatedBy = 'System',
  reportTitle = 'Consumables & Service Tools — Consolidated All-Sites Audit Report'
} = {}) {
  const siteNameByCode = new Map();
  (sites || []).forEach(s => {
    const c = String(s.site_code || s.code || '').trim().toUpperCase();
    if (c) siteNameByCode.set(c, s.site_name || s.name || c);
  });

  const normalizedRows = (items || [])
    .filter(it => it && it.selected !== false)
    .map(it => {
      const siteCode = String(it.site_code || 'UNMAPPED').trim().toUpperCase() || 'UNMAPPED';
      const isTool = isCanonicalToolKind(it.part_number, it.description, it.item_kind || it.type);
      const qty = Math.max(1, parseInt(it.quantity ?? it.qty, 10) || 1);
      const unitCost = Math.max(0, Number(it.unit_cost ?? it.usd_price ?? 0) || 0);
      return {
        site_code: siteCode,
        receiving_site: it.raw_site_label || siteNameByCode.get(siteCode) || siteCode,
        ship_to_id: it.ship_to_id || '',
        report_ref: String(it.report_ref || '').trim(),
        hawb_number: String(it.hawb_number || '').trim(),
        delivery_number: String(it.delivery_number || '').trim(),
        box_number: String(it.box_number || '').trim(),
        document_date: String(it.document_date || '').trim(),
        po_number: String(it.po_number || '').trim(),
        supplier: String(it.supplier || 'Apple South Asia Pte Ltd').trim(),
        part_number: String(it.part_number || '').trim().toUpperCase(),
        description: String(it.description || '').trim(),
        isTool,
        typeLabel: isTool ? 'Tool (Asset)' : 'Consumable',
        ownership_tag: String(it.ownership_tag || 'Apple-Owned').trim() || 'Apple-Owned',
        quantity: qty,
        unit_cost: unitCost,
        line_total: Math.round(qty * unitCost * 100) / 100,
        serial_numbers: Array.isArray(it.serial_numbers)
          ? it.serial_numbers.join(', ')
          : String(it.serial_numbers || '').trim(),
        notes: String(it.notes || '').trim()
      };
    });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = generatedBy;
  workbook.created = new Date();

  // ── TAB 1: Summary by Site ──────────────────────────────────────────────
  const siteWs = workbook.addWorksheet('Summary by Site', {
    views: [{ state: 'frozen', ySplit: 6 }]
  });
  siteWs.columns = [
    { key: 'site_code', width: 22 },
    { key: 'site_name', width: 38 },
    { key: 'tools_qty', width: 14 },
    { key: 'consumables_qty', width: 17 },
    { key: 'total_units', width: 14 },
    { key: 'tools_share', width: 13 },
    { key: 'unique_docs', width: 15 },
    { key: 'missing_refs', width: 16 },
    { key: 'total_usd', width: 18 }
  ];

  const t1 = siteWs.addRow([reportTitle]);
  t1.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
  t1.height = 28;
  siteWs.mergeCells('A1:I1');

  const totalToolsAll = normalizedRows.filter(r => r.isTool).reduce((s, r) => s + r.quantity, 0);
  const totalConsAll = normalizedRows.filter(r => !r.isTool).reduce((s, r) => s + r.quantity, 0);
  const totalUsdAll = normalizedRows.reduce((s, r) => s + r.line_total, 0);
  const uniqueSitesAll = new Set(normalizedRows.map(r => r.site_code)).size;

  const kpiRow1 = siteWs.addRow([
    'Total Sites', uniqueSitesAll, 'Tools (Assets)', totalToolsAll,
    'Consumables', totalConsAll, 'Total Units', totalToolsAll + totalConsAll, ''
  ]);
  styleMetaRow(kpiRow1);
  const kpiRow2 = siteWs.addRow([
    'Generated By', generatedBy, 'Generated At', new Date().toLocaleString(),
    'Total Customs Value (USD)', totalUsdAll, '', '', ''
  ]);
  styleMetaRow(kpiRow2);
  kpiRow2.getCell(6).numFmt = '$#,##0.00';
  siteWs.addRow([]);

  styleSectionBanner(siteWs, siteWs.addRow(['Site-by-Site Breakdown (Dynamic =SUM Totals)']), 9);
  const siteHeader = siteWs.addRow([
    'Site Code',
    'Receiving Site',
    'Tools Qty',
    'Consumables Qty',
    'Total Units',
    'Tools Share',
    'Docs / HAWBs',
    'Missing Inv. Ref',
    'Total Value (USD)'
  ]);
  styleTableHeader(siteHeader);

  const siteBuckets = new Map();
  normalizedRows.forEach(r => {
    if (!siteBuckets.has(r.site_code)) {
      siteBuckets.set(r.site_code, {
        site_code: r.site_code,
        site_name: r.receiving_site,
        toolsQty: 0,
        consQty: 0,
        docs: new Set(),
        missingRefs: 0,
        totalUsd: 0
      });
    }
    const b = siteBuckets.get(r.site_code);
    if (r.isTool) b.toolsQty += r.quantity;
    else b.consQty += r.quantity;
    if (r.report_ref) b.docs.add(r.report_ref);
    else if (r.hawb_number) b.docs.add(`HAWB-${r.hawb_number}`);
    if (!r.report_ref) b.missingRefs += 1;
    b.totalUsd = Math.round((b.totalUsd + r.line_total) * 100) / 100;
  });

  const sortedSiteBuckets = Array.from(siteBuckets.values()).sort((a, b) => a.site_code.localeCompare(b.site_code));
  const siteStartRow = siteWs.rowCount + 1;
  sortedSiteBuckets.forEach((b, idx) => {
    const rowNum = siteStartRow + idx;
    const totalU = b.toolsQty + b.consQty;
    const r = siteWs.addRow([
      b.site_code,
      b.site_name,
      b.toolsQty,
      b.consQty,
      { formula: `C${rowNum}+D${rowNum}`, result: totalU },
      { formula: `IF(E${rowNum}>0,C${rowNum}/E${rowNum},0)`, result: totalU > 0 ? b.toolsQty / totalU : 0 },
      b.docs.size,
      b.missingRefs,
      b.totalUsd
    ]);
    styleDataRow(r, idx % 2 === 1);
    const theme = getSiteColorTheme(b.site_code);
    r.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.excelFill } };
    });
    r.getCell(1).font = { bold: true, size: 10, color: { argb: theme.text.replace('#', 'FF') } };
    r.getCell(3).numFmt = '#,##0';
    r.getCell(4).numFmt = '#,##0';
    r.getCell(5).numFmt = '#,##0';
    r.getCell(6).numFmt = '0.0%';
    r.getCell(7).numFmt = '#,##0';
    r.getCell(8).numFmt = '#,##0';
    r.getCell(9).numFmt = '$#,##0.00';
    if (b.missingRefs > 0) {
      r.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
      r.getCell(8).font = { bold: true, size: 10, color: { argb: 'FF92400E' } };
    }
  });
  const siteEndRow = siteWs.rowCount;

  if (sortedSiteBuckets.length > 0) {
    const totRowNum = siteEndRow + 1;
    const totRow = siteWs.addRow([
      'TOTAL',
      `${sortedSiteBuckets.length} Site(s)`,
      { formula: `SUM(C${siteStartRow}:C${siteEndRow})`, result: totalToolsAll },
      { formula: `SUM(D${siteStartRow}:D${siteEndRow})`, result: totalConsAll },
      { formula: `SUM(E${siteStartRow}:E${siteEndRow})`, result: totalToolsAll + totalConsAll },
      { formula: `IF(E${totRowNum}>0,C${totRowNum}/E${totRowNum},0)`, result: (totalToolsAll + totalConsAll) > 0 ? totalToolsAll / (totalToolsAll + totalConsAll) : 0 },
      { formula: `SUM(G${siteStartRow}:G${siteEndRow})`, result: sortedSiteBuckets.reduce((s, b) => s + b.docs.size, 0) },
      { formula: `SUM(H${siteStartRow}:H${siteEndRow})`, result: sortedSiteBuckets.reduce((s, b) => s + b.missingRefs, 0) },
      { formula: `SUM(I${siteStartRow}:I${siteEndRow})`, result: Math.round(totalUsdAll * 100) / 100 }
    ]);
    styleTotalsRow(totRow);
    totRow.getCell(3).numFmt = '#,##0';
    totRow.getCell(4).numFmt = '#,##0';
    totRow.getCell(5).numFmt = '#,##0';
    totRow.getCell(6).numFmt = '0.0%';
    totRow.getCell(7).numFmt = '#,##0';
    totRow.getCell(8).numFmt = '#,##0';
    totRow.getCell(9).numFmt = '$#,##0.00';
  }
  siteWs.autoFilter = { from: 'A6', to: 'I6' };
  siteWs.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ── TAB 2: Summary by Part Number ───────────────────────────────────────
  const partWs = workbook.addWorksheet('Summary by Part Number', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  partWs.columns = [
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Ownership Tag', key: 'ownership_tag', width: 18 },
    { header: 'Part Number', key: 'pn', width: 18 },
    { header: 'Description', key: 'desc', width: 46 },
    { header: 'Sites Count', key: 'sites_count', width: 14 },
    { header: 'Total Qty', key: 'total_qty', width: 14 },
    { header: 'USD Unit Price', key: 'unit_price', width: 16 },
    { header: 'Total Value (USD)', key: 'total_usd', width: 18 }
  ];
  styleTableHeader(partWs.getRow(1));

  const partBuckets = new Map();
  normalizedRows.forEach(r => {
    const key = `${r.typeLabel}::${r.part_number}`;
    if (!partBuckets.has(key)) {
      partBuckets.set(key, {
        type: r.typeLabel,
        ownership_tag: r.ownership_tag || 'Apple-Owned',
        isTool: r.isTool,
        pn: r.part_number,
        desc: r.description,
        sites: new Set(),
        qty: 0,
        unitPrice: r.unit_cost,
        totalUsd: 0
      });
    }
    const b = partBuckets.get(key);
    b.sites.add(r.site_code);
    b.qty += r.quantity;
    if (r.unit_cost > 0 && b.unitPrice === 0) b.unitPrice = r.unit_cost;
    b.totalUsd = Math.round((b.totalUsd + r.line_total) * 100) / 100;
  });

  const sortedPartBuckets = Array.from(partBuckets.values()).sort((a, b) => {
    if (a.isTool !== b.isTool) return a.isTool ? -1 : 1;
    return a.pn.localeCompare(b.pn);
  });

  const pStart = 2;
  sortedPartBuckets.forEach((b, idx) => {
    const rowNum = pStart + idx;
    const r = partWs.addRow([
      b.type,
      b.ownership_tag,
      b.pn,
      b.desc,
      b.sites.size,
      b.qty,
      b.unitPrice,
      { formula: `F${rowNum}*G${rowNum}`, result: b.totalUsd }
    ]);
    styleDataRow(r, idx % 2 === 1, { wrapCols: [4] });
    r.getCell(5).numFmt = '#,##0';
    r.getCell(6).numFmt = '#,##0';
    r.getCell(7).numFmt = '$#,##0.00';
    r.getCell(8).numFmt = '$#,##0.00';
  });
  const pEnd = partWs.rowCount;
  if (sortedPartBuckets.length > 0) {
    const pTot = partWs.addRow([
      'TOTAL',
      '',
      `${sortedPartBuckets.length} SKU(s)`,
      '',
      '',
      { formula: `SUM(F${pStart}:F${pEnd})`, result: sortedPartBuckets.reduce((s, b) => s + b.qty, 0) },
      '',
      { formula: `SUM(H${pStart}:H${pEnd})`, result: Math.round(totalUsdAll * 100) / 100 }
    ]);
    styleTotalsRow(pTot);
    pTot.getCell(6).numFmt = '#,##0';
    pTot.getCell(8).numFmt = '$#,##0.00';
  }
  partWs.autoFilter = { from: 'A1', to: 'H1' };
  partWs.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ── TAB 3: All Line Items ───────────────────────────────────────────────
  const allWs = workbook.addWorksheet('All Line Items', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  allWs.columns = [
    { header: 'Site Code', key: 'site_code', width: 16 },
    { header: 'Receiving Site', key: 'receiving_site', width: 34 },
    { header: 'Ship-To ID', key: 'ship_to_id', width: 15 },
    { header: 'Report Ref / Doc #', key: 'report_ref', width: 18 },
    { header: 'HAWB #', key: 'hawb_number', width: 16 },
    { header: 'Delivery #', key: 'delivery_number', width: 16 },
    { header: 'Box #', key: 'box_number', width: 15 },
    { header: 'Document Date', key: 'document_date', width: 14 },
    { header: 'Linked PO #', key: 'po_number', width: 16 },
    { header: 'Supplier', key: 'supplier', width: 24 },
    { header: 'Part Number', key: 'part_number', width: 15 },
    { header: 'Description', key: 'description', width: 42 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Ownership Tag', key: 'ownership_tag', width: 18 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'USD Price', key: 'unit_cost', width: 14 },
    { header: 'Line Total USD', key: 'line_total', width: 16 },
    { header: 'Serial #(s)', key: 'serials', width: 22 },
    { header: 'Notes', key: 'notes', width: 34 }
  ];
  styleTableHeader(allWs.getRow(1));

  const aStart = 2;
  normalizedRows.forEach((row, idx) => {
    const rowNum = aStart + idx;
    const r = allWs.addRow({
      site_code: row.site_code,
      receiving_site: row.receiving_site,
      ship_to_id: row.ship_to_id,
      report_ref: row.report_ref,
      hawb_number: row.hawb_number,
      delivery_number: row.delivery_number,
      box_number: row.box_number,
      document_date: row.document_date,
      po_number: row.po_number,
      supplier: row.supplier,
      part_number: row.part_number,
      description: row.description,
      type: row.typeLabel,
      ownership_tag: row.ownership_tag || 'Apple-Owned',
      qty: row.quantity,
      unit_cost: row.unit_cost,
      line_total: { formula: `O${rowNum}*P${rowNum}`, result: row.line_total },
      serials: row.serial_numbers,
      notes: row.notes
    });
    styleDataRow(r, idx % 2 === 1, { wrapCols: [12, 19] });
    const theme = getSiteColorTheme(row.site_code);
    r.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.excelFill } };
    });
    r.getCell(1).font = { bold: true, size: 10, color: { argb: theme.text.replace('#', 'FF') } };
    // Highlight blank Report Ref / Doc # cells in soft amber (#FFF3CD)
    if (!row.report_ref) {
      r.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    }
    r.getCell(15).numFmt = '#,##0';
    r.getCell(16).numFmt = '$#,##0.00';
    r.getCell(17).numFmt = '$#,##0.00';
  });
  const aEnd = allWs.rowCount;
  if (normalizedRows.length > 0) {
    const aTot = allWs.addRow({
      site_code: 'TOTAL',
      receiving_site: `${normalizedRows.length} Line Item(s)`,
      qty: { formula: `SUM(O${aStart}:O${aEnd})`, result: totalToolsAll + totalConsAll },
      line_total: { formula: `SUM(Q${aStart}:Q${aEnd})`, result: Math.round(totalUsdAll * 100) / 100 }
    });
    styleTotalsRow(aTot);
    aTot.getCell(15).numFmt = '#,##0';
    aTot.getCell(17).numFmt = '$#,##0.00';
  }
  allWs.autoFilter = { from: 'A1', to: 'S1' };
  allWs.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  return workbook.xlsx.writeBuffer();
}

export async function exportCtConsolidatedAuditToExcel(options = {}) {
  const buffer = await buildCtConsolidatedAuditExcelBuffer(options);
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileName = `MDC_Consumables_Tools_All_Sites_${dateStr}.xlsx`;
  triggerExcelDownload(buffer, fileName);
  return fileName;
}
