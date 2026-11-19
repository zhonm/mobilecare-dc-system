import ExcelJS from 'exceljs';
import { supabase } from '../supabase/client.js';
import dbStorage from '../utils/dbStorage.js';
import { queuedSavedRecordsUpsert } from '../utils/savedRecordsQueue.js';
import { formatTo12HourTime } from '../utils/dateUtils.js';

export const SCAN_IN_AUDIT_IDB_KEY = 'mdc_scan_in_audit_ledger_v1';
export const SCAN_IN_AUDIT_CLOUD_DOC_ID = 'rec-scan_in_audit_ledger_v1';
export const SCAN_IN_AUDIT_CHANNEL = 'mdc_scan_in_audit_sync';

export function isDcAuditSite(siteCode, siteId = '') {
  const code = String(siteCode || '').trim().toUpperCase();
  const id = String(siteId || '').trim().toLowerCase();
  if (id === 'site-dc') return true;
  if (code === 'DC-MDC' || code === 'DC' || code === 'MDC' || code === 'DC STOCK' || code === 'SITE-DC') return true;
  if (!code && !id) return true;
  return false;
}

export function isDcAuditRecord(rec) {
  if (!rec) return false;
  return isDcAuditSite(rec.receiving_site_code || rec.site_code, rec.current_site_id);
}

/**
 * Keeps all genuine Receive Scan-In records from ANY site & ANY transaction type,
 * while excluding legacy non-DC Fixably branch backfill noise.
 */
export function isValidAuditRecord(rec) {
  if (!rec || !rec.part_number) return false;
  if (rec.intake_method === 'Historical Backfill' && !isDcAuditRecord(rec)) {
    return false;
  }
  return true;
}

function normalizeClassification(raw) {
  const s = String(raw || '').trim();
  const u = s.toUpperCase();
  if (u.includes('TRANSFER PARTS') || u === 'TRANSFER') return 'Transfer Parts';
  if (u.includes('SVNR') || u.includes('NON-REPAIR') || u.includes('NON REPAIR')) return 'SVNR - Service Non-Repair';
  if (u.includes('CRBR')) return 'DC - CRBR';
  if (u.includes('FORECAST')) return 'MDC - Forecasting';
  return s || 'MDC - Forecasting';
}

/**
 * Computes a deterministic tamper-evident FNV-1a integrity fingerprint over the immutable audit fields.
 */
export function computeAuditIntegrityHash(rec = {}) {
  const payload = [
    String(rec.part_number || '').trim().toUpperCase(),
    String(rec.serial_number || '').trim().toUpperCase(),
    String(rec.classification || '').trim(),
    String(rec.scanned_at || '').trim(),
    String(rec.scanned_by || '').trim(),
    String(rec.receiving_site_code || '').trim().toUpperCase(),
    String(rec.reference_number || '').trim().toUpperCase()
  ].join('|');

  let h1 = 2166136261;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 16777619);
    h2 ^= ch + ((h2 << 6) + (h2 >> 2));
    h2 = Math.imul(h2, 2246822519);
  }
  return `V1-${(h1 >>> 0).toString(16).padStart(8, '0').toUpperCase()}${(h2 >>> 0).toString(16).padStart(4, '0').slice(0, 4).toUpperCase()}`;
}

/**
 * Builds a single immutable Scan-In Audit Trail record from a received unit.
 * Captures all compliance fields required for permanent receipt traceability.
 */
export function buildScanInAuditRecord(unit = {}, options = {}) {
  const scannedAt = options.scannedAt || unit.received_at || unit.created_at || new Date().toISOString();
  const dateCompact = String(scannedAt).slice(0, 10).replace(/-/g, '') || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const partNumber = String(unit.part_number || unit.partNumber || '').trim().toUpperCase();
  const partDescription = String(unit.description || unit.part_description || options.description || '').trim() || `Part ${partNumber}`;
  const serialNumber = String(unit.serial_number || unit.serialNumber || '').trim().toUpperCase() || 'N/A';
  const classification = normalizeClassification(
    options.classification || unit.intake_assignment || unit.part_assignment || unit.assignment || unit.notes
  );
  const scannedBy = String(options.scannedBy || unit.received_by || 'Warehouse Staff').trim();
  const scannedById = options.scannedById || unit.received_by_id || unit.added_by_user_id || null;
  const receivingSiteCode = String(
    options.receivingSiteCode || unit.site_code || (unit.current_site_id === 'site-dc' ? 'DC-MDC' : 'DC-MDC')
  ).trim().toUpperCase();
  const receivingSiteName = String(
    options.receivingSiteName || unit.site_name || (receivingSiteCode === 'DC-MDC' ? 'Distribution Center (DC-MDC)' : receivingSiteCode)
  ).trim();
  const originSite = String(
    options.originSite ||
    unit.previous_site_code ||
    (classification === 'Transfer Parts' ? 'Inter-Site Transfer' : 'Supplier / Inbound')
  ).trim();
  const referenceNumber = String(
    options.referenceNumber ||
    unit.po_number ||
    unit.previous_manifest_ref ||
    unit.batch_id ||
    unit.id ||
    'DIRECT-SCAN'
  ).trim();
  const intakeMethod = String(
    options.intakeMethod || (unit.is_returned_override ? 'Return Override' : 'Barcode Scan')
  ).trim();
  const recordSource = options.recordSource || (intakeMethod === 'Historical Backfill' ? 'historical_dc_backfill' : 'scan_in');
  const notes = String(options.notes || unit.override_reason || '').trim();

  const base = {
    part_number: partNumber,
    part_description: partDescription,
    serial_number: serialNumber,
    classification,
    scanned_at: scannedAt,
    scanned_by: scannedBy,
    scanned_by_id: scannedById,
    origin_site: originSite,
    receiving_site_code: receivingSiteCode,
    receiving_site_name: receivingSiteName,
    reference_number: referenceNumber,
    intake_method: intakeMethod,
    record_source: recordSource,
    notes,
    immutable: true
  };

  const integrityHash = computeAuditIntegrityHash(base);
  const shortSig = integrityHash.replace(/^V1-/, '').slice(0, 6);
  const auditId = options.auditId || `AUD-${dateCompact}-${shortSig}`;

  return Object.freeze({
    audit_id: auditId,
    ...base,
    integrity_hash: integrityHash
  });
}

function getAuditDedupKey(rec) {
  if (!rec) return '';
  if (rec.integrity_hash) return `H:${rec.integrity_hash}`;
  return [
    String(rec.part_number || '').trim().toUpperCase(),
    String(rec.serial_number || '').trim().toUpperCase(),
    String(rec.scanned_at || '').slice(0, 19),
    String(rec.receiving_site_code || '').trim().toUpperCase()
  ].join('::');
}

/**
 * Strictly append-only union merge for all scanned parts across all sites and transaction types.
 * Existing audit records are NEVER removed or mutated; only genuinely new records
 * are appended, sorted newest-first for display.
 */
export function mergeScanInAuditRecords(existing = [], incoming = []) {
  const byKey = new Map();
  const byAuditId = new Map();

  for (const rec of (existing || [])) {
    if (!isValidAuditRecord(rec)) continue;
    const key = getAuditDedupKey(rec);
    if (!byKey.has(key)) {
      byKey.set(key, rec);
      if (rec.audit_id) byAuditId.set(rec.audit_id, true);
    }
  }

  let addedCount = 0;
  for (const rec of (incoming || [])) {
    if (!isValidAuditRecord(rec)) continue;
    const key = getAuditDedupKey(rec);
    if (byKey.has(key)) continue;
    if (rec.audit_id && byAuditId.has(rec.audit_id)) continue;
    byKey.set(key, Object.freeze({ ...rec, immutable: true }));
    if (rec.audit_id) byAuditId.set(rec.audit_id, true);
    addedCount += 1;
  }

  const merged = Array.from(byKey.values()).sort((a, b) =>
    String(b.scanned_at || '').localeCompare(String(a.scanned_at || ''))
  );

  return { merged, addedCount };
}

export function broadcastScanInAuditUpdate(detail = {}) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(SCAN_IN_AUDIT_CHANNEL);
      ch.postMessage({ type: 'SCAN_IN_AUDIT_APPENDED', detail, ts: Date.now() });
      ch.close();
    }
  } catch {
    // Ignore unsupported BroadcastChannel environments
  }
}

export function subscribeScanInAuditSync(handler) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  try {
    const ch = new BroadcastChannel(SCAN_IN_AUDIT_CHANNEL);
    ch.onmessage = (ev) => {
      if (ev?.data && typeof handler === 'function') handler(ev.data);
    };
    return () => {
      try { ch.close(); } catch {}
    };
  } catch {
    return () => {};
  }
}

export async function loadScanInAuditLedger() {
  try {
    const stored = await dbStorage.getItem(SCAN_IN_AUDIT_IDB_KEY);
    const raw = Array.isArray(stored) ? stored : (stored && Array.isArray(stored.records) ? stored.records : []);
    const validRecords = raw.filter(isValidAuditRecord);
    if (raw.length > validRecords.length) {
      await persistAuditLedgerLocal(validRecords).catch(() => {});
    }
    return validRecords;
  } catch (e) {
    console.warn('[ScanInAudit] IDB load notice:', e);
  }
  return [];
}

async function isCloudSessionReady() {
  if (!supabase) return false;
  if (!supabase.auth?.getSession) return true;
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data?.session?.user);
  } catch {
    return false;
  }
}

async function persistAuditLedgerLocal(records) {
  const nowIso = new Date().toISOString();
  await dbStorage.setItem(
    SCAN_IN_AUDIT_IDB_KEY,
    { version: 1, updatedAt: nowIso, count: records.length, records },
    { skipLocalStorage: true }
  );
  return nowIso;
}

/**
 * Append-only persistence to IndexedDB + Supabase Cloud (merging with any remote records first
 * so concurrent users can never overwrite or drop each other's audit records).
 */
export async function appendScanInAuditRecords(newRecords = [], options = {}) {
  const { skipCloud = false, userName = 'System' } = options || {};
  const validIncoming = (newRecords || []).filter(r => r && r.part_number);
  if (validIncoming.length === 0) {
    const current = await loadScanInAuditLedger();
    return { records: current, addedCount: 0, cloudSynced: false };
  }

  const existingLocal = await loadScanInAuditLedger();
  const { merged: localMerged, addedCount } = mergeScanInAuditRecords(existingLocal, validIncoming);

  if (addedCount === 0) {
    return { records: localMerged, addedCount: 0, cloudSynced: false };
  }

  const nowIso = await persistAuditLedgerLocal(localMerged);
  broadcastScanInAuditUpdate({ count: localMerged.length, addedCount, updatedAt: nowIso });

  if (skipCloud || !(await isCloudSessionReady())) {
    return { records: localMerged, addedCount, cloudSynced: false };
  }

  try {
    // Always fetch remote first and perform append-only union before upsert
    const { data: remoteRow } = await supabase
      .from('saved_records')
      .select('snapshot_data')
      .eq('id', SCAN_IN_AUDIT_CLOUD_DOC_ID)
      .maybeSingle();

    const remoteRecords = Array.isArray(remoteRow?.snapshot_data?.records)
      ? remoteRow.snapshot_data.records
      : [];
    const { merged: finalUnion } = mergeScanInAuditRecords(remoteRecords, localMerged);

    if (finalUnion.length > localMerged.length) {
      await persistAuditLedgerLocal(finalUnion);
    }

    const d = new Date(nowIso);
    const { error } = await queuedSavedRecordsUpsert({
      id: SCAN_IN_AUDIT_CLOUD_DOC_ID,
      record_type: 'scan_in_audit_ledger',
      period_label: 'Permanent Scan-In Audit Trail',
      period_year: d.getFullYear(),
      period_month: d.getMonth() + 1,
      notes: `Immutable append-only Scan-In Audit Trail (${finalUnion.length} permanent records)`,
      snapshot_data: {
        version: 1,
        immutable: true,
        updatedAt: nowIso,
        count: finalUnion.length,
        records: finalUnion
      },
      saved_by_name: userName,
      updated_at: nowIso
    }, { immediate: true });

    if (error) throw error;
    return { records: finalUnion, addedCount, cloudSynced: true };
  } catch (err) {
    console.warn('[ScanInAudit] Cloud sync notice:', err?.message || err);
    return { records: localMerged, addedCount, cloudSynced: false };
  }
}

/**
 * Bidirectional append-only cloud sync: pulls any remote audit records and pushes any local-only
 * audit records without ever deleting or modifying existing entries.
 */
export async function syncScanInAuditFromCloud({ userName = 'System' } = {}) {
  const localRecords = await loadScanInAuditLedger();
  if (!(await isCloudSessionReady())) {
    return { records: localRecords, cloudStatus: 'offline', pulledCount: 0, pushedCount: 0 };
  }

  try {
    const { data: remoteRow, error } = await supabase
      .from('saved_records')
      .select('snapshot_data, updated_at')
      .eq('id', SCAN_IN_AUDIT_CLOUD_DOC_ID)
      .maybeSingle();

    if (error) throw error;

    const remoteRecords = Array.isArray(remoteRow?.snapshot_data?.records)
      ? remoteRow.snapshot_data.records
      : [];

    const { merged, addedCount: pulledFromRemote } = mergeScanInAuditRecords(localRecords, remoteRecords);
    const { addedCount: missingInRemote } = mergeScanInAuditRecords(remoteRecords, localRecords);

    const remoteHadInvalid = remoteRecords.some(r => !isValidAuditRecord(r));

    if (pulledFromRemote > 0) {
      await persistAuditLedgerLocal(merged);
    }

    if ((missingInRemote > 0 || remoteHadInvalid) && merged.length > 0) {
      const nowIso = new Date().toISOString();
      const d = new Date(nowIso);
      await queuedSavedRecordsUpsert({
        id: SCAN_IN_AUDIT_CLOUD_DOC_ID,
        record_type: 'scan_in_audit_ledger',
        period_label: 'Permanent Scan-In Audit Trail',
        period_year: d.getFullYear(),
        period_month: d.getMonth() + 1,
        notes: `Immutable append-only Scan-In Audit Trail (${merged.length} permanent records)`,
        snapshot_data: {
          version: 1,
          immutable: true,
          updatedAt: nowIso,
          count: merged.length,
          records: merged
        },
        saved_by_name: userName,
        updated_at: nowIso
      }, { immediate: true });
    }

    return {
      records: merged,
      cloudStatus: 'synced',
      pulledCount: pulledFromRemote,
      pushedCount: missingInRemote
    };
  } catch (err) {
    console.warn('[ScanInAudit] Cloud fetch notice:', err?.message || err);
    return { records: localRecords, cloudStatus: 'offline', pulledCount: 0, pushedCount: 0 };
  }
}

/**
 * Non-destructively backfills existing received DC/Branch units & historical intake batches
 * into the permanent Scan-In Audit Trail so historical proof is immediately available.
 */
export async function backfillAuditFromExistingData({
  inventoryUnits = [],
  dcIntakeRecords = [],
  sites = [],
  userName = 'System'
} = {}) {
  const siteNameMap = new Map();
  (sites || []).forEach(s => {
    if (s.code) siteNameMap.set(String(s.code).toUpperCase(), s.name || s.code);
  });
  siteNameMap.set('DC-MDC', 'Distribution Center (DC-MDC)');

  const candidates = [];

  for (const u of (inventoryUnits || [])) {
    if (!u || !u.part_number || !u.serial_number) continue;
    // Strictly DC stocks only — exclude branch Fixably/site inventory units
    if (!isDcAuditSite(u.site_code, u.current_site_id)) continue;
    const sCode = 'DC-MDC';
    candidates.push(
      buildScanInAuditRecord(u, {
        receivingSiteCode: sCode,
        receivingSiteName: u.site_name || siteNameMap.get(sCode) || 'Distribution Center (DC-MDC)',
        intakeMethod: 'Historical Backfill',
        referenceNumber: u.po_number || u.previous_manifest_ref || u.id || 'HISTORICAL-STOCK'
      })
    );
  }

  for (const batch of (dcIntakeRecords || [])) {
    if (!isDcAuditSite(batch?.site_code || 'DC-MDC', batch?.site_id)) continue;
    const items = Array.isArray(batch?.items) ? batch.items : [];
    for (const it of items) {
      if (!it || !(it.part_number || it.partNumber)) continue;
      candidates.push(
        buildScanInAuditRecord(
          {
            part_number: it.part_number || it.partNumber,
            description: it.description || it.part_description || '',
            serial_number: it.serial_number || it.serialNumber || 'N/A',
            intake_assignment: it.intake_assignment || it.assignment || batch.intake_assignment || 'MDC - Forecasting',
            received_at: it.received_at || batch.intake_date || batch.created_at,
            received_by: it.received_by || batch.recorded_by || 'Warehouse Staff',
            site_code: 'DC-MDC',
            site_name: batch.site_name || 'Distribution Center (DC-MDC)'
          },
          {
            intakeMethod: 'Historical Backfill',
            referenceNumber: batch.po_number || batch.id || 'INTAKE-BATCH'
          }
        )
      );
    }
  }

  if (candidates.length === 0) {
    return loadScanInAuditLedger();
  }

  const res = await appendScanInAuditRecords(candidates, { userName });
  return res.records;
}

/**
 * Builds an ExcelJS compliance workbook buffer for the Permanent Scan-In Audit Trail.
 */
export async function buildScanInAuditExcelBuffer({
  records = [],
  filters = {},
  generatedBy = 'Admin'
} = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = generatedBy;
  workbook.created = new Date();

  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5 };
  const ZEBRA_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  const THIN_BORDER = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
  };

  // Sheet 1: Audit Summary
  const sumWs = workbook.addWorksheet('Audit Summary');
  sumWs.columns = [
    { key: 'a', width: 28 },
    { key: 'b', width: 28 },
    { key: 'c', width: 24 },
    { key: 'd', width: 24 }
  ];
  const titleRow = sumWs.addRow(['DC Receive Scan-In — Permanent Immutable Audit Trail Report']);
  titleRow.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
  titleRow.height = 26;
  sumWs.mergeCells('A1:D1');

  sumWs.addRow(['Audit Policy', 'Append-Only / Immutable (No Delete or Edit)', 'Total Audited Records', records.length]);
  sumWs.addRow(['Classification Filter', filters.classification || 'All Tags', 'Site Filter', filters.site || 'All Sites']);
  sumWs.addRow(['User Filter', filters.user || 'All Users', 'Date Range', (filters.dateFrom || filters.dateTo) ? `${filters.dateFrom || 'Start'} → ${filters.dateTo || 'Present'}` : 'All Dates']);
  sumWs.addRow(['Generated By', generatedBy, 'Generated At', new Date().toLocaleString()]);
  sumWs.addRow([]);

  const clsHeader = sumWs.addRow(['Tagging / Classification', 'Scanned Parts Count', 'Unique Part Numbers', 'Share']);
  clsHeader.height = 24;
  clsHeader.eachCell(c => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
    c.border = THIN_BORDER;
  });

  const byClass = new Map();
  for (const r of records) {
    const k = r.classification || 'MDC - Forecasting';
    if (!byClass.has(k)) byClass.set(k, { count: 0, pns: new Set() });
    const entry = byClass.get(k);
    entry.count += 1;
    entry.pns.add(r.part_number);
  }
  const denom = Math.max(1, records.length);
  Array.from(byClass.entries()).forEach(([cls, stats], idx) => {
    const row = sumWs.addRow([cls, stats.count, stats.pns.size, `${((stats.count / denom) * 100).toFixed(1)}%`]);
    row.eachCell(c => {
      if (idx % 2 === 1) c.fill = ZEBRA_FILL;
      c.border = THIN_BORDER;
      c.font = { size: 10 };
    });
  });

  // Sheet 2: Permanent Scan-In Audit Log
  const logWs = workbook.addWorksheet('Scan-In Audit Log', { views: [{ state: 'frozen', ySplit: 1 }] });
  logWs.columns = [
    { header: 'Audit ID', key: 'audit_id', width: 22 },
    { header: 'Date Scanned', key: 'date', width: 14 },
    { header: 'Time Scanned', key: 'time', width: 14 },
    { header: 'Part Number', key: 'part_number', width: 16 },
    { header: 'Part Description', key: 'part_description', width: 40 },
    { header: 'Serial Number', key: 'serial_number', width: 22 },
    { header: 'Tagging / Classification', key: 'classification', width: 26 },
    { header: 'Scanned By (User)', key: 'scanned_by', width: 22 },
    { header: 'Origin / From', key: 'origin_site', width: 20 },
    { header: 'Receiving Site Code', key: 'site_code', width: 16 },
    { header: 'Receiving Site / Location', key: 'site_name', width: 28 },
    { header: 'Reference / Transaction #', key: 'reference_number', width: 24 },
    { header: 'Intake Method', key: 'intake_method', width: 18 },
    { header: 'Notes', key: 'notes', width: 28 },
    { header: 'Integrity Hash', key: 'integrity_hash', width: 20 }
  ];
  const logHeader = logWs.getRow(1);
  logHeader.height = 25;
  logHeader.eachCell(c => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    c.border = THIN_BORDER;
  });
  logWs.autoFilter = 'A1:O1';

  records.forEach((rec, idx) => {
    const iso = String(rec.scanned_at || '');
    const row = logWs.addRow({
      audit_id: rec.audit_id || '',
      date: iso ? iso.slice(0, 10) : '',
      time: iso ? (formatTo12HourTime ? formatTo12HourTime(iso) : iso.slice(11, 19)) : '',
      part_number: rec.part_number || '',
      part_description: rec.part_description || '',
      serial_number: rec.serial_number || 'N/A',
      classification: rec.classification || '',
      scanned_by: rec.scanned_by || '',
      origin_site: rec.origin_site || 'Supplier / Inbound',
      site_code: rec.receiving_site_code || '',
      site_name: rec.receiving_site_name || '',
      reference_number: rec.reference_number || '',
      intake_method: rec.intake_method || '',
      notes: rec.notes || '',
      integrity_hash: rec.integrity_hash || ''
    });
    row.eachCell(c => {
      if (idx % 2 === 1) c.fill = ZEBRA_FILL;
      c.border = THIN_BORDER;
      c.font = { size: 10, color: { argb: 'FF0F172A' } };
      c.alignment = { vertical: 'middle', wrapText: false };
    });
  });

  return workbook.xlsx.writeBuffer();
}

export async function exportScanInAuditToExcel(options = {}) {
  const buffer = await buildScanInAuditExcelBuffer(options);
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `MDC_Permanent_ScanIn_Audit_Trail_${dateStr}.xlsx`;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}
