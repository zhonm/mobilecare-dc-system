import ExcelJS from 'exceljs';
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
    if (cat && cat.item_kind === 'tool') return false;
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
    { key: 'c2', width: 22 },
    { key: 'c3', width: 22 },
    { key: 'c4', width: 42 },
    { key: 'c5', width: 12 },
    { key: 'c6', width: 12 },
    { key: 'c7', width: 12 },
    { key: 'c8', width: 12 },
    { key: 'c9', width: 12 },
    { key: 'c10', width: 12 },
    { key: 'c11', width: 26 },
    { key: 'c12', width: 32 }
  ];

  const titleRow = summaryWs.addRow(['Consumables & Service Tools Center — Inventory Report']);
  titleRow.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
  titleRow.height = 28;
  summaryWs.mergeCells('A1:L1');

  const metaRows = [
    ['Site Scope', isAllSites ? 'All Sites' : cleanSite, 'Status Filter', cleanStatus === 'all' ? 'All Statuses' : cleanStatus.toUpperCase()],
    ['Search Filter', searchQuery || 'None', 'Generated By', generatedBy],
    ['Generated At', new Date().toLocaleString(), 'Total Tracked Tools', scopedTools.length],
    ['Consumables Qty On Hand', scopedConsumables.reduce((s, r) => s + Number(r.qty_on_hand || 0), 0), 'Consumable SKUs', scopedConsumables.length]
  ];
  metaRows.forEach(vals => styleMetaRow(summaryWs.addRow(vals)));
  summaryWs.addRow([]);

  // 1A. Detailed Breakdown by Part Number & Description (Primary view on Summary)
  styleSectionBanner(summaryWs, summaryWs.addRow(['Detailed Inventory Breakdown by Part Number & Description']), 12);
  const partHeader = summaryWs.addRow([
    'Site Code',
    'Item Kind',
    'Part Number',
    'Description',
    'Total Qty',
    'Available',
    'In Use',
    'Shipped',
    'Missing',
    'Retired',
    'Assigned To',
    'System / Admin Asset Tags'
  ]);
  styleTableHeader(partHeader);

  const partGroups = new Map();
  const getPartGroup = (site, kind, pn, desc) => {
    const sCode = String(site || 'UNASSIGNED').trim().toUpperCase();
    const pCode = String(pn || '').trim().toUpperCase();
    const key = `${sCode}::${kind}::${pCode}`;
    if (!partGroups.has(key)) {
      partGroups.set(key, {
        site: sCode,
        kind,
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
    const g = getPartGroup(a.site_code, 'TOOL', a.part_number, desc);
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
    const g = getPartGroup(c.site_code, 'CONSUMABLE', c.part_number, desc);
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
    sortedPartGroups.forEach((g, idx) => {
      const r = summaryWs.addRow([
        g.site,
        g.kind,
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
      styleDataRow(r, idx % 2 === 1, { wrapCols: [4, 11, 12] });
    });

    const partTotals = summaryWs.addRow([
      'TOTAL',
      `${sortedPartGroups.length} SKU(s)`,
      '',
      '',
      sortedPartGroups.reduce((a, b) => a + b.totalQty, 0),
      sortedPartGroups.reduce((a, b) => a + b.available, 0),
      sortedPartGroups.reduce((a, b) => a + b.inUse, 0),
      sortedPartGroups.reduce((a, b) => a + b.shipped, 0),
      sortedPartGroups.reduce((a, b) => a + b.missing, 0),
      sortedPartGroups.reduce((a, b) => a + b.retired, 0),
      '',
      ''
    ]);
    styleTotalsRow(partTotals);
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
  });

  if (sortedSites.length > 0) {
    const totalsRow = summaryWs.addRow([
      'TOTAL',
      sortedSites.reduce((a, b) => a + b.totalTools, 0),
      sortedSites.reduce((a, b) => a + b.available, 0),
      sortedSites.reduce((a, b) => a + b.inUse, 0),
      sortedSites.reduce((a, b) => a + b.shipped, 0),
      sortedSites.reduce((a, b) => a + b.missing, 0),
      sortedSites.reduce((a, b) => a + b.retired, 0),
      sortedSites.reduce((a, b) => a + b.taggedAdmin, 0),
      sortedSites.reduce((a, b) => a + b.consSkus, 0),
      sortedSites.reduce((a, b) => a + b.consQty, 0)
    ]);
    styleTotalsRow(totalsRow);
  }

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
    { header: 'Assigned Date', key: 'assigned_at', width: 14 },
    { header: 'PO Reference', key: 'po_number', width: 18 },
    { header: 'Last Updated', key: 'updated_at', width: 16 },
    { header: 'Notes', key: 'notes', width: 32 }
  ];
  styleTableHeader(toolsWs.getRow(1));
  toolsWs.autoFilter = 'A1:L1';

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
      assigned_at: formatIsoDate(a.assigned_at),
      po_number: a.po_number || a.order_po_number || '',
      updated_at: formatIsoDate(a.updated_at || a.created_at),
      notes: a.notes || ''
    });
    styleDataRow(r, idx % 2 === 1, { wrapCols: [5, 12] });
    applyStatusCellStyle(r.getCell('status'), a.status);
  });

  // ── Sheet 3: Consumables Stock ─────────────────────────────────────────
  const consWs = workbook.addWorksheet('Consumables Stock', { views: [{ state: 'frozen', ySplit: 1 }] });
  consWs.columns = [
    { header: 'Site', key: 'site_code', width: 16 },
    { header: 'Part Number', key: 'part_number', width: 18 },
    { header: 'Description', key: 'description', width: 44 },
    { header: 'Qty On Hand', key: 'qty_on_hand', width: 14 },
    { header: 'Reorder Level', key: 'reorder_level', width: 14 },
    { header: 'Stock Status', key: 'stock_status', width: 14 },
    { header: 'Last Updated', key: 'updated_at', width: 16 }
  ];
  styleTableHeader(consWs.getRow(1));
  consWs.autoFilter = 'A1:G1';

  scopedConsumables.forEach((row, idx) => {
    const cat = catalogDescMap.get(String(row.part_number || '').trim().toUpperCase());
    const qty = Number(row.qty_on_hand || 0);
    const reorder = Number(row.reorder_level ?? cat?.reorder_level ?? 0);
    const stockStatus = reorder > 0 && qty <= reorder ? 'Low Stock' : 'OK';
    const r = consWs.addRow({
      site_code: row.site_code || '',
      part_number: row.part_number || '',
      description: resolveDesc(row.part_number, row.description),
      qty_on_hand: qty,
      reorder_level: reorder,
      stock_status: stockStatus,
      updated_at: formatIsoDate(row.updated_at || row.last_received_at)
    });
    styleDataRow(r, idx % 2 === 1, { wrapCols: [3] });
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
