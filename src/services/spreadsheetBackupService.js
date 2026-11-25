/**
 * Mobile Care DC System — Spreadsheet (XLSX / CSV) Backup & Restore Service
 *
 * Lightweight, human-readable, Excel/CSV-native full-system backup and restore engine.
 * Exports all operational domains (Parts Catalog, DC Stock, Branch Stock, Sites, Categories,
 * Users, Tools, Consumables, C&T Catalog/Movements/Orders/Shipments, Outbound Shipments,
 * Purchase Orders, DC Intake Batches, Parts Requests, Forecasts, Allocations, Transfer History,
 * and System Settings) into either:
 *   1. Multi-sheet Excel Workbook (.xlsx) — recommended, compact & easy to inspect in Excel
 *   2. Unified CSV Backup (.csv) — plain-text universal archive
 *
 * Also parses and validates .xlsx, .csv, and legacy .json backup packages seamlessly.
 */

import * as XLSX from 'xlsx';
import {
  compileSystemBackupPackage,
  computeBackupStats,
  validateBackupPackage
} from './backupRestoreService.js';

export const SPREADSHEET_BACKUP_SCHEMA = 'XLSX-1.0';
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const CSV_MIME_TYPE = 'text/csv;charset=utf-8';
const EXCEL_SAFE_CELL_LIMIT = 30000;

/**
 * Splits any string cell exceeding Excel's 32,767-character cell limit across continuation
 * columns (`<key>__p2`, `<key>__p3`, ...) so XLSX export never throws and preserves 100% of data.
 */
function chunkOversizedCellsForExcel(rows = []) {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    let needsChunking = false;
    for (const val of Object.values(row)) {
      if (typeof val === 'string' && val.length > EXCEL_SAFE_CELL_LIMIT) {
        needsChunking = true;
        break;
      }
    }
    if (!needsChunking) return row;

    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && v.length > EXCEL_SAFE_CELL_LIMIT) {
        out[k] = v.slice(0, EXCEL_SAFE_CELL_LIMIT);
        let partIdx = 2;
        for (let offset = EXCEL_SAFE_CELL_LIMIT; offset < v.length; offset += EXCEL_SAFE_CELL_LIMIT) {
          out[`${k}__p${partIdx}`] = v.slice(offset, offset + EXCEL_SAFE_CELL_LIMIT);
          partIdx++;
        }
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

/**
 * Reassembles any continuation columns (`<key>__p2`, `<key>__p3`, ...) back into `<key>` on parse.
 */
function reassembleChunkedExcelCells(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const chunkGroups = new Map();
    const out = {};

    for (const [k, v] of Object.entries(row)) {
      const match = /^(.*)__p(\d+)$/.exec(k);
      if (match) {
        const baseKey = match[1];
        const partNum = Number(match[2]);
        if (!chunkGroups.has(baseKey)) chunkGroups.set(baseKey, []);
        chunkGroups.get(baseKey).push({ partNum, val: String(v ?? '') });
      } else {
        out[k] = v;
      }
    }

    if (chunkGroups.size === 0) return row;

    chunkGroups.forEach((parts, baseKey) => {
      parts.sort((a, b) => a.partNum - b.partNum);
      const head = String(out[baseKey] ?? '');
      out[baseKey] = head + parts.map((p) => p.val).join('');
    });
    return out;
  });
}

function isDcUnit(u) {
  const sId = String(u?.current_site_id || u?.site_id || '').trim().toLowerCase();
  const sCode = String(u?.site_code || '').trim().toUpperCase();
  return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || Boolean(u?.is_dc);
}

function safeJsonStr(val) {
  if (val === undefined || val === null) return '';
  try {
    return JSON.stringify(val);
  } catch (_) {
    return '';
  }
}

function safeParseJson(str, fallback = null) {
  if (str === undefined || str === null || str === '') return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(String(str));
  } catch (_) {
    return fallback;
  }
}

function toBool(val, defaultVal = false) {
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null || val === '') return defaultVal;
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return defaultVal;
}

function toNum(val, defaultVal = 0) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const n = Number(val);
  return Number.isFinite(n) ? n : defaultVal;
}

function buildTimestampTag(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function formatUnitRow(u) {
  return {
    serial_number: String(u?.serial_number || u?.serialNumber || '').trim(),
    part_number: String(u?.part_number || '').trim(),
    description: u?.description || '',
    iphone_model: u?.iphone_model || '',
    status: u?.status || 'in_stock',
    intake_assignment: u?.intake_assignment || u?.assignment || 'MDC - Forecasting',
    current_site_id: u?.current_site_id || u?.site_id || '',
    site_code: u?.site_code || (isDcUnit(u) ? 'DC-MDC' : ''),
    site_name: u?.site_name || '',
    box_number: toNum(u?.box_number, 1),
    po_number: u?.po_number || '',
    work_order_number: u?.work_order_number || '',
    received_at: u?.received_at || '',
    updated_at: u?.updated_at || '',
    used_at: u?.used_at || '',
    usage_notes: u?.usage_notes || '',
    outtake_at: u?.outtake_at || '',
    outtake_reason: u?.outtake_reason || '',
    transferred_at: u?.transferred_at || '',
    transfer_slip_number: u?.transfer_slip_number || '',
    transferred_to_site_code: u?.transferred_to_site_code || '',
    notes: u?.notes || '',
    part_id: u?.part_id || '',
    id: u?.id || ''
  };
}

function parseUnitRow(r, forceDc = false) {
  const serial = String(r?.serial_number || r?.serialNumber || '').trim();
  const pn = String(r?.part_number || '').trim();
  if (!serial && !pn) return null;
  const siteCode = String(r?.site_code || (forceDc ? 'DC-MDC' : '')).trim();
  const siteId = String(r?.current_site_id || (forceDc ? 'site-dc' : '')).trim();
  const unit = {
    id: r?.id ? String(r.id).trim() : `unit-${serial || Date.now()}`,
    serial_number: serial,
    part_number: pn,
    description: r?.description || '',
    iphone_model: r?.iphone_model || '',
    status: String(r?.status || 'in_stock').trim() || 'in_stock',
    intake_assignment: String(r?.intake_assignment || 'MDC - Forecasting').trim() || 'MDC - Forecasting',
    current_site_id: siteId || (forceDc ? 'site-dc' : ''),
    site_code: siteCode,
    site_name: r?.site_name || '',
    box_number: toNum(r?.box_number, 1),
    received_at: r?.received_at || new Date().toISOString(),
    updated_at: r?.updated_at || new Date().toISOString(),
    notes: r?.notes || ''
  };
  if (r?.part_id) unit.part_id = String(r.part_id).trim();
  if (r?.po_number) unit.po_number = String(r.po_number).trim();
  if (r?.work_order_number) unit.work_order_number = String(r.work_order_number).trim();
  if (r?.used_at) unit.used_at = String(r.used_at).trim();
  if (r?.usage_notes) unit.usage_notes = String(r.usage_notes).trim();
  if (r?.outtake_at) unit.outtake_at = String(r.outtake_at).trim();
  if (r?.outtake_reason) unit.outtake_reason = String(r.outtake_reason).trim();
  if (r?.transferred_at) unit.transferred_at = String(r.transferred_at).trim();
  if (r?.transfer_slip_number) unit.transfer_slip_number = String(r.transfer_slip_number).trim();
  if (r?.transferred_to_site_code) unit.transferred_to_site_code = String(r.transferred_to_site_code).trim();
  if (forceDc) unit.is_dc = true;
  return unit;
}

/**
 * Builds normalized sheet tables from the current application state.
 */
export function buildSpreadsheetBackupTables(appState = {}, currentUser = null, options = {}) {
  const pkg = compileSystemBackupPackage(appState, currentUser, options);
  const d = pkg.data;

  const dcUnits = (d.inventoryUnits || []).filter(isDcUnit);
  const branchUnits = (d.inventoryUnits || []).filter((u) => !isDcUnit(u));

  const partsRows = (d.parts || []).map((p) => ({
    part_number: String(p?.part_number || '').trim(),
    description: p?.description || '',
    iphone_model: p?.iphone_model || '',
    category_code: p?.category_code || '',
    category_id: p?.category_id || '',
    catalog_type: p?.catalog_type || p?.item_type || '',
    stocking_price: toNum(p?.stocking_price, 0),
    safety_stock_pct: toNum(p?.safety_stock_pct, 0.05),
    is_active: p?.is_active !== false,
    id: p?.id || ''
  }));

  const dcStockRows = dcUnits.map(formatUnitRow);
  const branchStockRows = branchUnits.map(formatUnitRow);

  const sitesRows = (d.sites || []).map((s) => ({
    code: String(s?.code || '').trim(),
    name: s?.name || '',
    region: s?.region || '',
    address: s?.address || '',
    full_address: s?.full_address || '',
    contact_person: s?.contact_person || '',
    contact_phone: s?.contact_phone || '',
    contact_email: s?.contact_email || '',
    invoice_prefix: s?.invoice_prefix || '',
    is_dc: Boolean(s?.is_dc),
    is_active: s?.is_active !== false,
    ship_to_json: s?.ship_to ? safeJsonStr(s.ship_to) : '',
    sold_to_json: s?.sold_to ? safeJsonStr(s.sold_to) : '',
    id: s?.id || ''
  }));

  const categoriesRows = (d.categories || []).map((c, idx) => ({
    code: String(c?.code || '').trim(),
    name: c?.name || '',
    has_imei: Boolean(c?.has_imei),
    is_serialized: c?.is_serialized !== false,
    sort_order: toNum(c?.sort_order, idx + 1),
    id: c?.id || ''
  }));

  const usersRows = (d.usersList || []).map((u) => {
    const safeUser = { ...u };
    delete safeUser.password;
    return {
      email: String(u?.email || '').trim(),
      fullName: u?.fullName || u?.full_name || '',
      role: u?.role || 'pmg',
      siteId: u?.siteId || u?.site_id || '',
      siteCode: u?.siteCode || u?.site_code || '',
      siteName: u?.siteName || u?.site_name || '',
      isActive: u?.isActive !== false && u?.is_active !== false,
      id: u?.id || '',
      extra_json: safeJsonStr(safeUser)
    };
  });

  const toolsRows = (d.ctToolAssets || []).map((t) => ({
    asset_tag: t?.asset_tag || t?.assetTag || '',
    ownership_tag: t?.ownership_tag || t?.ownershipTag || '',
    ownership_type: t?.ownership_type || t?.ownershipType || 'APPLE_OWNED',
    part_number: t?.part_number || t?.partNumber || '',
    description: t?.description || '',
    serial_number: t?.serial_number || t?.serialNumber || '',
    site_code: t?.site_code || t?.siteCode || '',
    site_id: t?.site_id || t?.siteId || '',
    status: t?.status || 'available',
    assigned_to: t?.assigned_to || t?.assignedTo || '',
    source_ref: t?.source_ref || t?.sourceRef || '',
    notes: t?.notes || '',
    created_at: t?.created_at || '',
    id: t?.id || '',
    extra_json: safeJsonStr(t)
  }));

  const consumablesRows = (d.ctStock || []).map((c) => ({
    part_number: c?.part_number || c?.partNumber || '',
    description: c?.description || '',
    ownership_tag: c?.ownership_tag || c?.ownershipTag || '',
    ownership_type: c?.ownership_type || c?.ownershipType || 'APPLE_OWNED',
    site_code: c?.site_code || c?.siteCode || '',
    site_id: c?.site_id || c?.siteId || '',
    qty_on_hand: toNum(c?.qty_on_hand ?? c?.quantity ?? c?.qty, 0),
    pack_size: toNum(c?.pack_size ?? c?.packSize, 1),
    min_threshold: toNum(c?.min_threshold ?? c?.minThreshold, 2),
    unit_type: c?.unit_type || c?.unitType || 'pcs',
    source_ref: c?.source_ref || c?.sourceRef || '',
    updated_at: c?.updated_at || '',
    id: c?.id || '',
    extra_json: safeJsonStr(c)
  }));

  const ctCatalogRows = (d.ctCatalog || []).map((item) => ({
    part_number: item?.part_number || '',
    description: item?.description || '',
    item_type: item?.item_type || 'consumable',
    ownership_type: item?.ownership_type || 'APPLE_OWNED',
    pack_size: toNum(item?.pack_size, 1),
    default_min_threshold: toNum(item?.default_min_threshold, 2),
    unit_type: item?.unit_type || 'pcs',
    is_active: item?.is_active !== false,
    id: item?.id || '',
    extra_json: safeJsonStr(item)
  }));

  const ctMovementsRows = (d.ctMovements || []).map((m) => ({
    movement_type: m?.movement_type || m?.type || '',
    item_type: m?.item_type || '',
    part_number: m?.part_number || '',
    description: m?.description || '',
    site_code: m?.site_code || '',
    qty_delta: toNum(m?.qty_delta ?? m?.qty ?? 0, 0),
    actor_name: m?.actor_name || m?.performed_by || '',
    reason: m?.reason || m?.notes || '',
    created_at: m?.created_at || m?.timestamp || '',
    id: m?.id || '',
    extra_json: safeJsonStr(m)
  }));

  const ctOrdersShipmentsRows = [
    ...(d.ctOrders || []).map((o) => ({
      record_kind: 'order',
      ref_number: o?.po_number || o?.order_number || o?.id || '',
      status: o?.status || '',
      site_code: o?.site_code || '',
      created_at: o?.created_at || '',
      id: o?.id || '',
      payload_json: safeJsonStr(o)
    })),
    ...(d.ctShipments || []).map((s) => ({
      record_kind: 'shipment',
      ref_number: s?.shipment_number || s?.packing_list_no || s?.id || '',
      status: s?.status || '',
      site_code: s?.destination_site_code || s?.site_code || '',
      created_at: s?.created_at || '',
      id: s?.id || '',
      payload_json: safeJsonStr(s)
    }))
  ];

  const shipmentsRows = (d.shipments || []).map((sh) => ({
    id: sh?.id || '',
    shipment_number: sh?.shipment_number || '',
    invoice_ref: sh?.invoice_ref || '',
    destination_site_id: sh?.destination_site_id || sh?.site_id || '',
    destination_site_code: sh?.destination_site_code || sh?.site_code || '',
    destination_site_name: sh?.destination_site_name || sh?.site_name || '',
    status: sh?.status || '',
    courier: sh?.courier || '',
    tracking_number: sh?.tracking_number || '',
    prepared_by_name: sh?.prepared_by_name || '',
    created_at: sh?.created_at || '',
    items_count: Array.isArray(sh?.items) ? sh.items.length : (Array.isArray(sh?.shipment_items) ? sh.shipment_items.length : 0),
    payload_json: safeJsonStr(sh)
  }));

  const purchaseOrdersRows = (d.purchaseOrders || []).map((po) => ({
    id: po?.id || '',
    po_number: po?.po_number || '',
    order_date: po?.order_date || '',
    expected_date: po?.expected_date || '',
    status: po?.status || '',
    remarks: po?.remarks || '',
    items_count: Array.isArray(po?.items) ? po.items.length : 0,
    payload_json: safeJsonStr(po)
  }));

  const dcIntakeRows = (d.dcIntakeRecords || []).map((rec) => ({
    id: rec?.id || '',
    record_name: rec?.record_name || '',
    site_code: rec?.site_code || 'DC-MDC',
    received_by: rec?.received_by || rec?.created_by || '',
    created_at: rec?.created_at || rec?.intake_date || '',
    items_count: Array.isArray(rec?.items) ? rec.items.length : toNum(rec?.total_units, 0),
    payload_json: safeJsonStr(rec)
  }));

  const partsRequestsRows = (d.partsRequests || []).map((req) => ({
    id: req?.id || '',
    request_number: req?.request_number || req?.id || '',
    site_code: req?.site_code || '',
    site_id: req?.site_id || '',
    status: req?.status || '',
    requested_by: req?.requested_by_name || req?.requested_by || '',
    created_at: req?.created_at || '',
    payload_json: safeJsonStr(req)
  }));

  const forecastsAllocRows = [
    ...(d.forecastItems || []).map((f) => ({
      record_kind: 'forecast',
      part_number: f?.part_number || '',
      site_code: f?.site_code || '',
      qty: toNum(f?.forecast_qty ?? f?.recommended_qty ?? f?.qty, 0),
      payload_json: safeJsonStr(f)
    })),
    ...(d.allocations || []).map((a) => ({
      record_kind: 'allocation',
      part_number: a?.part_number || '',
      site_code: a?.site_code || '',
      qty: toNum(a?.allocated_qty ?? a?.qty, 0),
      payload_json: safeJsonStr(a)
    }))
  ];

  const transferHistoryRows = (d.partTransferHistory || []).map((tr) => ({
    serial_number: tr?.serial_number || '',
    part_number: tr?.part_number || '',
    from_site_code: tr?.from_site_code || tr?.source_site_code || '',
    to_site_code: tr?.to_site_code || tr?.destination_site_code || '',
    transfer_slip_number: tr?.transfer_slip_number || '',
    transferred_at: tr?.transferred_at || tr?.created_at || '',
    payload_json: safeJsonStr(tr)
  }));

  const settingsRows = [
    { key: 'activePeriod', value_json: safeJsonStr(d.activePeriod || null) },
    { key: 'forecastingModel', value_json: safeJsonStr(d.forecastingModel || 'linear') },
    { key: 'supervisorSettings', value_json: safeJsonStr(d.supervisorSettings || {}) },
    { key: 'autoLogoutConfig', value_json: safeJsonStr(d.autoLogoutConfig || {}) }
  ];

  const manifestRows = [
    { field: 'schema_version', value: SPREADSHEET_BACKUP_SCHEMA },
    { field: 'created_at', value: pkg.createdAt },
    { field: 'created_by_name', value: pkg.createdBy?.fullName || 'Superadmin' },
    { field: 'created_by_email', value: pkg.createdBy?.email || '' },
    { field: 'label', value: options.label || '' },
    { field: 'notes', value: options.notes || '' },
    { field: 'checksum', value: pkg.integrity?.checksum || '' },
    { field: 'parts_count', value: String(partsRows.length) },
    { field: 'dc_stock_count', value: String(dcStockRows.length) },
    { field: 'branch_stock_count', value: String(branchStockRows.length) },
    { field: 'sites_count', value: String(sitesRows.length) },
    { field: 'categories_count', value: String(categoriesRows.length) },
    { field: 'users_count', value: String(usersRows.length) },
    { field: 'tools_count', value: String(toolsRows.length) },
    { field: 'consumables_count', value: String(consumablesRows.length) },
    { field: 'shipments_count', value: String(shipmentsRows.length) },
    { field: 'purchase_orders_count', value: String(purchaseOrdersRows.length) },
    { field: 'dc_intakes_count', value: String(dcIntakeRows.length) },
    { field: 'parts_requests_count', value: String(partsRequestsRows.length) },
    { field: 'total_records', value: String(pkg.stats?.totalRecordsCount || 0) }
  ];

  const tables = {
    Manifest: manifestRows,
    Parts_Catalog: partsRows,
    DC_Stock: dcStockRows,
    Branch_Stock: branchStockRows,
    Sites: sitesRows,
    Categories: categoriesRows,
    Users: usersRows,
    Tools_Inventory: toolsRows,
    Consumables_Stock: consumablesRows,
    CT_Catalog: ctCatalogRows,
    CT_Movements: ctMovementsRows,
    CT_Orders_Shipments: ctOrdersShipmentsRows,
    Shipments: shipmentsRows,
    Purchase_Orders: purchaseOrdersRows,
    DC_Intake_Batches: dcIntakeRows,
    Parts_Requests: partsRequestsRows,
    Forecasts_Allocations: forecastsAllocRows,
    Transfer_History: transferHistoryRows,
    System_Settings: settingsRows
  };

  const sheetSummary = Object.entries(tables)
    .filter(([name]) => name !== 'Manifest')
    .map(([name, rows]) => ({ sheet: name, count: rows.length }));

  return {
    pkg,
    tables,
    sheetSummary,
    dcStockCount: dcStockRows.length,
    branchStockCount: branchStockRows.length
  };
}

/**
 * Generates a multi-sheet .xlsx backup workbook as a Uint8Array ready for download or Google Drive upload.
 */
export function generateXlsxBackupWorkbook(appState = {}, currentUser = null, options = {}) {
  const { pkg, tables, sheetSummary, dcStockCount, branchStockCount } = buildSpreadsheetBackupTables(
    appState,
    currentUser,
    options
  );

  const wb = XLSX.utils.book_new();
  Object.entries(tables).forEach(([sheetName, rows]) => {
    const safeRows = rows.length > 0 ? chunkOversizedCellsForExcel(rows) : [{ _empty: true }];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  });

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  const bytes = new Uint8Array(out);
  const tag = buildTimestampTag(new Date());
  const safeLabel = options.label
    ? `_${String(options.label).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 28)}`
    : '';
  const filename = `MDC_SYSTEM_BACKUP_${tag}${safeLabel}.xlsx`;

  return {
    format: 'XLSX',
    filename,
    mimeType: XLSX_MIME_TYPE,
    bytes,
    sizeBytes: bytes.byteLength,
    stats: {
      ...pkg.stats,
      dcStockCount,
      branchStockCount
    },
    checksum: pkg.integrity?.checksum || null,
    sheetSummary,
    package: pkg
  };
}

function escapeCsvCell(val) {
  const s = val === undefined || val === null ? '' : String(val);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Generates a unified, RFC-4180 compliant .csv backup containing all system sections.
 */
export function generateCsvBackupContent(appState = {}, currentUser = null, options = {}) {
  const { pkg, tables, sheetSummary, dcStockCount, branchStockCount } = buildSpreadsheetBackupTables(
    appState,
    currentUser,
    options
  );

  const header = ['Section', 'Record_Key', 'Part_Number', 'Serial_Or_Tag', 'Site_Code', 'Status', 'Qty', 'Name_Or_Description', 'Row_JSON'];
  const lines = [header.join(',')];

  Object.entries(tables).forEach(([section, rows]) => {
    rows.forEach((row, idx) => {
      const recordKey =
        row.id ||
        row.serial_number ||
        row.part_number ||
        row.code ||
        row.email ||
        row.field ||
        row.key ||
        `${section}-${idx + 1}`;
      const partNumber = row.part_number || '';
      const serialOrTag = row.serial_number || row.asset_tag || row.ownership_tag || row.invoice_ref || row.po_number || '';
      const siteCode = row.site_code || row.siteCode || row.destination_site_code || row.code || '';
      const status = row.status || (row.is_active === false ? 'inactive' : '');
      const qty = row.qty_on_hand ?? row.qty ?? row.items_count ?? '';
      const nameOrDesc = row.description || row.name || row.fullName || row.record_name || row.value || '';

      lines.push(
        [
          section,
          recordKey,
          partNumber,
          serialOrTag,
          siteCode,
          status,
          qty,
          nameOrDesc,
          safeJsonStr(row)
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    });
  });

  const text = '\uFEFF' + lines.join('\r\n');
  const bytes = new TextEncoder().encode(text);
  const tag = buildTimestampTag(new Date());
  const safeLabel = options.label
    ? `_${String(options.label).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 28)}`
    : '';
  const filename = `MDC_SYSTEM_BACKUP_${tag}${safeLabel}.csv`;

  return {
    format: 'CSV',
    filename,
    mimeType: CSV_MIME_TYPE,
    text,
    bytes,
    sizeBytes: bytes.byteLength,
    stats: {
      ...pkg.stats,
      dcStockCount,
      branchStockCount
    },
    checksum: pkg.integrity?.checksum || null,
    sheetSummary,
    package: pkg
  };
}

/**
 * Triggers a browser download for a generated XLSX or CSV backup artifact.
 */
export function triggerBackupBytesDownload(bytes, filename, mimeType) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Reconstructs a normalized backup package from parsed sheet tables (used by both XLSX and CSV parsers).
 */
function reconstructBackupPackageFromTables(tables = {}, format = 'XLSX') {
  const filterNonEmpty = (arr) =>
    (Array.isArray(arr) ? arr : []).filter((r) => r && typeof r === 'object' && !r._empty);

  const manifestMap = {};
  filterNonEmpty(tables.Manifest).forEach((m) => {
    if (m.field) manifestMap[String(m.field).trim()] = m.value ?? '';
  });

  const parts = filterNonEmpty(tables.Parts_Catalog)
    .map((p) => {
      const pn = String(p.part_number || '').trim();
      if (!pn) return null;
      return {
        id: p.id ? String(p.id).trim() : `part-${pn}`,
        part_number: pn,
        description: p.description || '',
        iphone_model: p.iphone_model || '',
        category_code: p.category_code || '',
        category_id: p.category_id || '',
        ...(p.catalog_type ? { catalog_type: p.catalog_type } : {}),
        stocking_price: toNum(p.stocking_price, 0),
        safety_stock_pct: toNum(p.safety_stock_pct, 0.05),
        is_active: toBool(p.is_active, true)
      };
    })
    .filter(Boolean);

  const dcUnits = filterNonEmpty(tables.DC_Stock)
    .map((r) => parseUnitRow(r, true))
    .filter(Boolean);

  const branchUnits = filterNonEmpty(tables.Branch_Stock)
    .map((r) => parseUnitRow(r, false))
    .filter(Boolean);

  // Deduplicate inventory units by serial_number (DC_Stock takes precedence if duplicated)
  const invMap = new Map();
  [...branchUnits, ...dcUnits].forEach((u) => {
    const key = String(u.serial_number || u.id || '').trim().toUpperCase();
    if (key) invMap.set(key, u);
  });
  const inventoryUnits = Array.from(invMap.values());

  const sites = filterNonEmpty(tables.Sites)
    .map((s) => {
      const code = String(s.code || '').trim();
      if (!code && !s.name) return null;
      return {
        id: s.id ? String(s.id).trim() : `site-${code.toLowerCase().replace(/\s+/g, '-')}`,
        code,
        name: s.name || code,
        region: s.region || '',
        address: s.address || '',
        full_address: s.full_address || s.address || '',
        contact_person: s.contact_person || '',
        contact_phone: s.contact_phone || '',
        contact_email: s.contact_email || '',
        invoice_prefix: s.invoice_prefix || '',
        is_dc: toBool(s.is_dc, code.toUpperCase() === 'DC-MDC'),
        is_active: toBool(s.is_active, true),
        ship_to: safeParseJson(s.ship_to_json, null),
        sold_to: safeParseJson(s.sold_to_json, null)
      };
    })
    .filter(Boolean);

  const categories = filterNonEmpty(tables.Categories)
    .map((c, idx) => {
      const code = String(c.code || '').trim();
      if (!code) return null;
      return {
        id: c.id ? String(c.id).trim() : `cat-${code.toLowerCase()}`,
        code,
        name: c.name || code,
        has_imei: toBool(c.has_imei, false),
        is_serialized: toBool(c.is_serialized, true),
        sort_order: toNum(c.sort_order, idx + 1)
      };
    })
    .filter(Boolean);

  const usersList = filterNonEmpty(tables.Users)
    .map((u) => {
      const extra = safeParseJson(u.extra_json, null);
      if (extra && typeof extra === 'object') {
        return {
          ...extra,
          email: u.email || extra.email || '',
          fullName: u.fullName || extra.fullName || '',
          role: u.role || extra.role || 'pmg',
          isActive: toBool(u.isActive, extra.isActive !== false)
        };
      }
      if (!u.email) return null;
      return {
        id: u.id || `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        email: String(u.email).trim(),
        fullName: u.fullName || '',
        role: u.role || 'pmg',
        siteId: u.siteId || '',
        siteCode: u.siteCode || '',
        siteName: u.siteName || '',
        isActive: toBool(u.isActive, true)
      };
    })
    .filter(Boolean);

  const ctToolAssets = filterNonEmpty(tables.Tools_Inventory)
    .map((t) => {
      const extra = safeParseJson(t.extra_json, null);
      if (extra && typeof extra === 'object') {
        return {
          ...extra,
          asset_tag: t.asset_tag || extra.asset_tag,
          ownership_tag: t.ownership_tag || extra.ownership_tag,
          part_number: t.part_number || extra.part_number,
          site_code: t.site_code || extra.site_code,
          status: t.status || extra.status || 'available'
        };
      }
      if (!t.part_number && !t.asset_tag) return null;
      return {
        id: t.id || `tool-${t.asset_tag || Date.now()}`,
        asset_tag: t.asset_tag || '',
        ownership_tag: t.ownership_tag || '',
        ownership_type: t.ownership_type || 'APPLE_OWNED',
        part_number: t.part_number || '',
        description: t.description || '',
        serial_number: t.serial_number || '',
        site_code: t.site_code || '',
        site_id: t.site_id || '',
        status: t.status || 'available',
        assigned_to: t.assigned_to || '',
        source_ref: t.source_ref || '',
        notes: t.notes || '',
        created_at: t.created_at || new Date().toISOString()
      };
    })
    .filter(Boolean);

  const ctStock = filterNonEmpty(tables.Consumables_Stock)
    .map((c) => {
      const extra = safeParseJson(c.extra_json, null);
      if (extra && typeof extra === 'object') {
        return {
          ...extra,
          part_number: c.part_number || extra.part_number,
          site_code: c.site_code || extra.site_code,
          qty_on_hand: toNum(c.qty_on_hand, extra.qty_on_hand ?? 0),
          pack_size: toNum(c.pack_size, extra.pack_size ?? 1),
          min_threshold: toNum(c.min_threshold, extra.min_threshold ?? 2)
        };
      }
      if (!c.part_number) return null;
      return {
        id: c.id || `cts-${c.part_number}-${c.site_code || 'DC'}`,
        part_number: c.part_number || '',
        description: c.description || '',
        ownership_tag: c.ownership_tag || '',
        ownership_type: c.ownership_type || 'APPLE_OWNED',
        site_code: c.site_code || '',
        site_id: c.site_id || '',
        qty_on_hand: toNum(c.qty_on_hand, 0),
        pack_size: toNum(c.pack_size, 1),
        min_threshold: toNum(c.min_threshold, 2),
        unit_type: c.unit_type || 'pcs',
        source_ref: c.source_ref || '',
        updated_at: c.updated_at || new Date().toISOString()
      };
    })
    .filter(Boolean);

  const ctCatalog = filterNonEmpty(tables.CT_Catalog)
    .map((c) => safeParseJson(c.extra_json, null) || (c.part_number ? {
      id: c.id || `ctcat-${c.part_number}`,
      part_number: c.part_number,
      description: c.description || '',
      item_type: c.item_type || 'consumable',
      ownership_type: c.ownership_type || 'APPLE_OWNED',
      pack_size: toNum(c.pack_size, 1),
      default_min_threshold: toNum(c.default_min_threshold, 2),
      unit_type: c.unit_type || 'pcs',
      is_active: toBool(c.is_active, true)
    } : null))
    .filter(Boolean);

  const ctMovements = filterNonEmpty(tables.CT_Movements)
    .map((m) => safeParseJson(m.extra_json, null) || (m.part_number ? {
      id: m.id || `ctm-${Date.now()}`,
      movement_type: m.movement_type || '',
      item_type: m.item_type || '',
      part_number: m.part_number || '',
      description: m.description || '',
      site_code: m.site_code || '',
      qty_delta: toNum(m.qty_delta, 0),
      actor_name: m.actor_name || '',
      reason: m.reason || '',
      created_at: m.created_at || new Date().toISOString()
    } : null))
    .filter(Boolean);

  const ctOrders = [];
  const ctShipments = [];
  filterNonEmpty(tables.CT_Orders_Shipments).forEach((row) => {
    const payload = safeParseJson(row.payload_json, null);
    if (!payload) return;
    if (String(row.record_kind || '').toLowerCase() === 'order') {
      ctOrders.push(payload);
    } else {
      ctShipments.push(payload);
    }
  });

  const shipments = filterNonEmpty(tables.Shipments)
    .map((s) => {
      const parsed = safeParseJson(s.payload_json, null);
      if (parsed && typeof parsed === 'object') return parsed;
      if (!s.id && !s.shipment_number && !s.invoice_ref) return null;
      return {
        id: String(s.id || s.invoice_ref || s.shipment_number || `ship-${Date.now()}`).trim(),
        shipment_number: s.shipment_number || s.invoice_ref || '',
        invoice_ref: s.invoice_ref || s.shipment_number || '',
        destination_site_id: s.destination_site_id || '',
        destination_site_code: s.destination_site_code || '',
        destination_site_name: s.destination_site_name || '',
        status: s.status || 'received_confirmed',
        courier: s.courier || '',
        tracking_number: s.tracking_number || '',
        prepared_by_name: s.prepared_by_name || '',
        created_at: s.created_at || new Date().toISOString(),
        items: []
      };
    })
    .filter(Boolean);

  const purchaseOrders = filterNonEmpty(tables.Purchase_Orders)
    .map((p) => safeParseJson(p.payload_json, null))
    .filter(Boolean);

  const dcIntakeRecords = filterNonEmpty(tables.DC_Intake_Batches)
    .map((r) => safeParseJson(r.payload_json, null))
    .filter(Boolean);

  const partsRequests = filterNonEmpty(tables.Parts_Requests)
    .map((r) => safeParseJson(r.payload_json, null))
    .filter(Boolean);

  const forecastItems = [];
  const allocations = [];
  filterNonEmpty(tables.Forecasts_Allocations).forEach((row) => {
    const payload = safeParseJson(row.payload_json, null);
    if (!payload) return;
    if (String(row.record_kind || '').toLowerCase() === 'forecast') {
      forecastItems.push(payload);
    } else {
      allocations.push(payload);
    }
  });

  const partTransferHistory = filterNonEmpty(tables.Transfer_History)
    .map((tr) => safeParseJson(tr.payload_json, null))
    .filter(Boolean);

  const settingsMap = {};
  filterNonEmpty(tables.System_Settings).forEach((s) => {
    if (s.key) settingsMap[String(s.key).trim()] = safeParseJson(s.value_json, null);
  });

  const data = {
    parts,
    sites,
    categories,
    inventoryUnits,
    shipments,
    purchaseOrders,
    dcIntakeRecords,
    partsRequests,
    forecastItems,
    allocations,
    ctCatalog,
    ctOrders,
    ctStock,
    ctToolAssets,
    ctMovements,
    ctShipments,
    partTransferHistory,
    usersList,
    activePeriod: settingsMap.activePeriod || null,
    forecastingModel: settingsMap.forecastingModel || 'linear',
    supervisorSettings: settingsMap.supervisorSettings || {},
    autoLogoutConfig: settingsMap.autoLogoutConfig || {},
    registries: {
      deletedUnitSerials: [],
      deletedShipmentIds: [],
      deletedIntakeIds: [],
      deletedUserIds: [],
      clearedSiteTimestamps: {},
      isCleared: false
    }
  };

  const stats = {
    ...computeBackupStats(data),
    dcStockCount: dcUnits.length,
    branchStockCount: branchUnits.length
  };

  return {
    schemaVersion: manifestMap.schema_version || `${format}-1.0`,
    backupFormat: format,
    createdAt: manifestMap.created_at || new Date().toISOString(),
    createdBy: {
      fullName: manifestMap.created_by_name || 'Superadmin',
      email: manifestMap.created_by_email || '',
      role: 'superadmin'
    },
    label: manifestMap.label || '',
    notes: manifestMap.notes || '',
    trigger: `${format}_BACKUP`,
    stats,
    data
  };
}

/**
 * Parses an XLSX workbook buffer/Uint8Array into a validated backup package.
 */
export function parseXlsxBackupBuffer(bufferOrBytes) {
  const wb = XLSX.read(bufferOrBytes, { type: 'array' });
  const tables = {};
  (wb.SheetNames || []).forEach((name) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    tables[name] = reassembleChunkedExcelCells(XLSX.utils.sheet_to_json(ws, { defval: '' }));
  });
  return reconstructBackupPackageFromTables(tables, 'XLSX');
}

/**
 * Parses a unified CSV backup string/buffer into a validated backup package.
 */
export function parseCsvBackupText(csvText) {
  const cleanText = String(csvText || '').replace(/^\uFEFF/, '');
  const wb = XLSX.read(cleanText, { type: 'string' });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  if (!firstSheet) {
    throw new Error('CSV backup file is empty or unreadable.');
  }
  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
  const tables = {};

  rows.forEach((row) => {
    const section = String(row.Section || row.section || '').trim();
    if (!section) return;
    if (!tables[section]) tables[section] = [];
    const parsedRow = safeParseJson(row.Row_JSON || row.row_json, null);
    if (parsedRow && typeof parsedRow === 'object') {
      tables[section].push(parsedRow);
    } else {
      tables[section].push(row);
    }
  });

  return reconstructBackupPackageFromTables(tables, 'CSV');
}

/**
 * Universal pre-flight parser & validator for uploaded or Drive-downloaded backup files.
 * Supports .xlsx, .xls, .csv, and legacy .json backup files.
 */
export async function parseAndValidateBackupFile(fileOrInput, explicitFileName = '') {
  const fileName = explicitFileName || fileOrInput?.name || 'backup';
  const lowerName = fileName.toLowerCase();

  let detectedFormat = 'XLSX';
  if (lowerName.endsWith('.json')) detectedFormat = 'JSON';
  else if (lowerName.endsWith('.csv')) detectedFormat = 'CSV';
  else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) detectedFormat = 'XLSX';

  try {
    let pkg = null;

    if (detectedFormat === 'JSON') {
      const text =
        typeof fileOrInput === 'string'
          ? fileOrInput
          : fileOrInput instanceof Uint8Array
            ? new TextDecoder().decode(fileOrInput)
            : fileOrInput instanceof ArrayBuffer
              ? new TextDecoder().decode(new Uint8Array(fileOrInput))
              : await fileOrInput.text();
      pkg = JSON.parse(text);
    } else if (detectedFormat === 'CSV') {
      const text =
        typeof fileOrInput === 'string'
          ? fileOrInput
          : fileOrInput instanceof Uint8Array
            ? new TextDecoder().decode(fileOrInput)
            : fileOrInput instanceof ArrayBuffer
              ? new TextDecoder().decode(new Uint8Array(fileOrInput))
              : await fileOrInput.text();
      pkg = parseCsvBackupText(text);
    } else {
      const buf =
        fileOrInput instanceof Uint8Array
          ? fileOrInput
          : fileOrInput instanceof ArrayBuffer
            ? new Uint8Array(fileOrInput)
            : new Uint8Array(await fileOrInput.arrayBuffer());
      pkg = parseXlsxBackupBuffer(buf);
    }

    const validation = validateBackupPackage(pkg);
    if (!validation.isValid) {
      return {
        isValid: false,
        format: detectedFormat,
        error: validation.error || 'Backup file failed validation.',
        warnings: validation.warnings || []
      };
    }

    const dcStockCount = (pkg.data?.inventoryUnits || []).filter(isDcUnit).length;
    const branchStockCount = (pkg.data?.inventoryUnits || []).filter((u) => !isDcUnit(u)).length;

    return {
      isValid: true,
      format: detectedFormat,
      package: pkg,
      validation: {
        ...validation,
        format: detectedFormat,
        dcStockCount,
        branchStockCount
      },
      warnings: validation.warnings || []
    };
  } catch (err) {
    return {
      isValid: false,
      format: detectedFormat,
      error: `Failed to parse ${detectedFormat} backup file: ${err.message}`,
      warnings: []
    };
  }
}
