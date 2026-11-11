import { supabase } from '../supabase/client.js';
import dbStorage from '../utils/dbStorage.js';
import { DEFAULT_DC_SHIPPING_COSTS, ingestDcMonitoringFile } from '../utils/dcStockMonitoringEngine.js';
import { queuedSavedRecordsUpsert } from '../utils/savedRecordsQueue.js';

const IDB_DATASETS_KEY = 'mdc_dc_monitoring_datasets_v1';
const IDB_LEDGER_KEY = 'mdc_dc_monitoring_ledger_v1';
const LS_META_KEY = 'mdc_dc_monitoring_meta_v1';
const SYNC_CHANNEL_NAME = 'mdc_dc_monitoring_sync';

export const DC_MONITORING_CLOUD_META_DOC_ID = 'rec-dc_mon_meta_v1';
export const DC_MONITORING_CLOUD_LEDGER_DOC_ID = 'rec-dc_mon_ledger_v1';
const LEGACY_CLOUD_LEDGER_DOC_ID = 'master_dc_monitoring_ledger_registry';
export const DC_MONITORING_SLOT_CHUNK_PREFIX = 'rec-dc_mon_slot_';

export const DC_MONITORING_ALL_SLOT_IDS = [
  'site_stock',
  'kgb_used',
  'stock_transfer',
  'dc_masterlists',
  'sdr_current',
  'sdr_baseline'
];

// Target ~1.15 MB max serialized JSON per saved_records chunk row
const MAX_CHUNK_JSON_BYTES = 1150000;

export const DC_SLOT_CLOUD_COLUMNS = {
  site_stock: [
    'stockName', 'stockType', 'partNumber', 'partDescription',
    'partSerial', 'partImei', 'lastReceivedDate', 'quantity',
    'partValue', 'totalValue', 'rowIndex'
  ],
  kgb_used: [
    'orderId', 'locationName', 'gsxRepairNumber', 'gsxRepairStrategy',
    'currentGsxStatus', 'repairClosedDate', 'productCode', 'productDescription',
    'productKgb', 'productKbb', 'rowIndex'
  ],
  stock_transfer: [
    'transferReceivedDate', 'month', 'fromStock', 'toStock',
    'productCode', 'productName', 'transferQuantity', 'serialNumber',
    'imeiNumber', 'transferValue', 'rowIndex', 'seqIndex'
  ],
  dc_masterlists: [
    'orderId', 'closedDate', 'locationName', 'lineProductCode',
    'lineProductName', 'lineKgb', 'lineKbb', 'deviceWarrantyName',
    'status', 'lineIsDispatched', 'lineStatusName', 'lineIsDoa',
    'linePriceTotal', 'rowIndex'
  ],
  sdr_current: [
    'orderId', 'receivedDate', 'closedDate', 'locationName',
    'status', 'deviceDescription', 'deviceWarrantyName', 'commentNote', 'rowIndex'
  ],
  sdr_baseline: [
    'orderId', 'receivedDate', 'closedDate', 'locationName',
    'status', 'deviceDescription', 'deviceWarrantyName', 'commentNote', 'rowIndex'
  ]
};

function parseTimestampMs(iso) {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function buildSavedRecordMetaFields(nowIso) {
  const d = nowIso ? new Date(nowIso) : new Date();
  const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;
  return {
    period_year: safeDate.getFullYear(),
    period_month: safeDate.getMonth() + 1,
    updated_at: safeDate.toISOString()
  };
}

async function isCloudSessionReady() {
  if (!supabase) return false;
  if (!supabase.auth?.getSession) return true;
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data?.session?.user);
  } catch (e) {
    return false;
  }
}

export function getSlotChunkDocId(slotId, chunkIndex) {
  return `${DC_MONITORING_SLOT_CHUNK_PREFIX}${slotId}_c${chunkIndex}`;
}

/**
 * Computes a deterministic content fingerprint across all serialized fields of a slot's rows
 * so identical re-uploads (e.g., unchanged historical sheets) skip redundant cloud egress.
 */
export function computeSlotContentHash(slotId, records = []) {
  if (!Array.isArray(records) || records.length === 0) return '';
  const cols = DC_SLOT_CLOUD_COLUMNS[slotId] || Object.keys(records[0] || {});
  let hash = 2166136261;

  const mixString = (val) => {
    const str = String(val ?? '');
    for (let j = 0; j < str.length; j++) {
      hash ^= str.charCodeAt(j);
      hash = Math.imul(hash, 16777619);
    }
  };

  mixString(`${slotId}:${records.length}:`);
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    for (let c = 0; c < cols.length; c++) {
      mixString(rec?.[cols[c]]);
      hash ^= 124;
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${records.length}-${(hash >>> 0).toString(36)}`;
}

/**
 * Compacts normalized slot records into bounded columnar chunks for safe Supabase JSONB persistence.
 * Zero fields are lost relative to parseSlotMatrix outputs.
 */
export function buildSlotChunksForCloud(slotId, records = [], updatedAt = new Date().toISOString()) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const cols = DC_SLOT_CLOUD_COLUMNS[slotId] || Object.keys(records[0] || {});
  const tupleRows = records.map(rec => cols.map(c => (rec && rec[c] !== undefined ? rec[c] : '')));

  const rawChunks = [];
  let currentBatch = [];
  let currentBytes = 256;

  for (let i = 0; i < tupleRows.length; i++) {
    const serializedRow = JSON.stringify(tupleRows[i]);
    const nextBytes = serializedRow.length + 2;
    if (currentBatch.length > 0 && currentBytes + nextBytes > MAX_CHUNK_JSON_BYTES) {
      rawChunks.push(currentBatch);
      currentBatch = [];
      currentBytes = 256;
    }
    currentBatch.push(tupleRows[i]);
    currentBytes += nextBytes;
  }
  if (currentBatch.length > 0) {
    rawChunks.push(currentBatch);
  }

  const chunkCount = rawChunks.length;
  return rawChunks.map((rows, chunkIndex) => ({
    id: getSlotChunkDocId(slotId, chunkIndex),
    slotId,
    chunkIndex,
    chunkCount,
    updatedAt,
    cols,
    rows
  }));
}

/**
 * Rehydrates ordered columnar cloud chunks back into normalized engine row objects.
 * Returns null if chunk set is incomplete or timestamps are inconsistent across chunks.
 */
export function hydrateSlotChunksFromCloud(slotId, chunks = [], expectedUpdatedAt = null, expectedChunkCount = null) {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;

  const normalized = chunks
    .map(c => (c?.snapshot_data ? c.snapshot_data : c))
    .filter(c => c && Array.isArray(c.rows) && Number.isInteger(c.chunkIndex));

  const targetCount = expectedChunkCount || normalized[0]?.chunkCount || normalized.length;
  const filtered = expectedUpdatedAt
    ? normalized.filter(c => !c.updatedAt || c.updatedAt === expectedUpdatedAt)
    : normalized;

  if (filtered.length !== targetCount) return null;

  const sorted = [...filtered].sort((a, b) => a.chunkIndex - b.chunkIndex);
  for (let i = 0; i < targetCount; i++) {
    if (sorted[i]?.chunkIndex !== i) return null;
  }

  const defaultCols = DC_SLOT_CLOUD_COLUMNS[slotId] || [];
  const records = [];
  for (const chunk of sorted) {
    const cols = Array.isArray(chunk.cols) && chunk.cols.length > 0 ? chunk.cols : defaultCols;
    for (const tuple of chunk.rows) {
      if (!Array.isArray(tuple)) continue;
      const obj = {};
      for (let cIdx = 0; cIdx < cols.length; cIdx++) {
        obj[cols[cIdx]] = tuple[cIdx];
      }
      records.push(obj);
    }
  }
  return records;
}

function synthesizeSlotMeta(datasets = {}, validationLogs = {}, storedMeta = {}) {
  const existingSlotMeta = storedMeta?.slotMeta && typeof storedMeta.slotMeta === 'object'
    ? storedMeta.slotMeta
    : {};
  const fallbackUpdatedAt = storedMeta?.updatedAt || new Date().toISOString();
  const next = {};

  for (const slotId of DC_MONITORING_ALL_SLOT_IDS) {
    const rows = Array.isArray(datasets?.[slotId]) ? datasets[slotId] : [];
    const cur = existingSlotMeta[slotId];
    if (rows.length > 0) {
      next[slotId] = {
        updatedAt: cur?.updatedAt || validationLogs?.[slotId]?.timestamp || fallbackUpdatedAt,
        updatedBy: cur?.updatedBy || 'Local Workspace',
        parsedCount: rows.length,
        fileName: cur?.fileName || validationLogs?.[slotId]?.fileName || '',
        cleared: false
      };
    } else if (cur?.cleared) {
      next[slotId] = {
        updatedAt: cur.updatedAt || fallbackUpdatedAt,
        updatedBy: cur.updatedBy || 'Local Workspace',
        parsedCount: 0,
        fileName: '',
        cleared: true
      };
    }
  }
  return next;
}

function writeLocalMeta(metaPayload) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_META_KEY, JSON.stringify(metaPayload));
    }
  } catch (e) {}
}

function readLocalMeta() {
  try {
    if (typeof localStorage !== 'undefined') {
      return JSON.parse(localStorage.getItem(LS_META_KEY) || '{}') || {};
    }
  } catch (e) {}
  return {};
}

export function broadcastDcMonitoringSync(type = 'DC_MONITORING_UPDATED', detail = {}) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
      ch.postMessage({ type, detail, ts: Date.now() });
      ch.close();
    }
  } catch (e) {}
}

export function subscribeDcMonitoringSync(handler) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  try {
    const ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
    ch.onmessage = (ev) => {
      if (ev?.data && typeof handler === 'function') handler(ev.data);
    };
    return () => {
      try { ch.close(); } catch (e) {}
    };
  } catch (e) {
    return () => {};
  }
}

export async function loadDcMonitoringState() {
  const storedMeta = readLocalMeta();
  let datasetBundle = null;
  let ledgerBundle = null;

  try {
    datasetBundle = await dbStorage.getItem(IDB_DATASETS_KEY);
  } catch (e) {
    console.warn('loadDcMonitoringState datasets error:', e);
  }

  try {
    ledgerBundle = await dbStorage.getItem(IDB_LEDGER_KEY);
  } catch (e) {
    console.warn('loadDcMonitoringState ledger error:', e);
  }

  const datasets = datasetBundle?.datasets || {};
  const validationLogs = datasetBundle?.validationLogs || storedMeta?.validationLogs || {};
  const slotMeta = datasetBundle?.slotMeta || synthesizeSlotMeta(datasets, validationLogs, storedMeta);

  return {
    datasets,
    validationLogs,
    slotMeta,
    clearedAt: datasetBundle?.clearedAt || storedMeta?.clearedAt || null,
    shippingCosts: Array.isArray(ledgerBundle?.shippingCosts) && ledgerBundle.shippingCosts.length > 0
      ? ledgerBundle.shippingCosts
      : DEFAULT_DC_SHIPPING_COSTS,
    remarksMap: ledgerBundle?.remarksMap && typeof ledgerBundle.remarksMap === 'object'
      ? ledgerBundle.remarksMap
      : {},
    updatedAt: datasetBundle?.updatedAt || ledgerBundle?.updatedAt || storedMeta?.updatedAt || null,
    syncedBy: datasetBundle?.syncedBy || storedMeta?.syncedBy || ledgerBundle?.updatedBy || null
  };
}

/**
 * Saves datasets and validation logs to local IndexedDB and pushes modified slots to Supabase
 * so all admins and report viewers stay synchronized in real time.
 */
export async function saveDcMonitoringDatasets(datasets = {}, validationLogs = {}, options = {}) {
  const {
    changedSlotIds = null,
    userName = 'System User',
    skipCloud = false,
    slotMetaOverride = null,
    clearedAt = null,
    broadcastCloudEvent = null,
    senderId = 'local'
  } = options;

  const nowIso = new Date().toISOString();
  const prevLocalMeta = readLocalMeta();
  const baseSlotMeta = slotMetaOverride
    ? { ...slotMetaOverride }
    : { ...(prevLocalMeta.slotMeta || synthesizeSlotMeta(datasets, validationLogs, prevLocalMeta)) };

  const slotsToPush = Array.isArray(changedSlotIds) && changedSlotIds.length > 0
    ? changedSlotIds.filter(id => DC_MONITORING_ALL_SLOT_IDS.includes(id))
    : DC_MONITORING_ALL_SLOT_IDS.filter(id => Array.isArray(datasets?.[id]) && datasets[id].length > 0);

  if (!slotMetaOverride) {
    for (const slotId of slotsToPush) {
      const rows = Array.isArray(datasets?.[slotId]) ? datasets[slotId] : [];
      if (rows.length > 0) {
        baseSlotMeta[slotId] = {
          updatedAt: nowIso,
          updatedBy: userName,
          parsedCount: rows.length,
          fileName: validationLogs?.[slotId]?.fileName || baseSlotMeta[slotId]?.fileName || '',
          cleared: false
        };
      }
    }
  }

  const metaSnapshot = {
    updatedAt: nowIso,
    syncedBy: userName,
    clearedAt: clearedAt || null,
    slotMeta: baseSlotMeta,
    validationLogs,
    counts: Object.fromEntries(Object.entries(datasets).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]))
  };

  try {
    await dbStorage.setItem(IDB_DATASETS_KEY, {
      datasets,
      validationLogs,
      slotMeta: baseSlotMeta,
      clearedAt: clearedAt || null,
      syncedBy: userName,
      updatedAt: nowIso
    });
  } catch (e) {
    console.warn('saveDcMonitoringDatasets IDB error:', e);
  }

  writeLocalMeta(metaSnapshot);
  broadcastDcMonitoringSync('DC_MONITORING_DATASETS_UPDATED', {
    updatedAt: nowIso,
    slotIds: slotsToPush,
    counts: metaSnapshot.counts
  });

  if (skipCloud || slotsToPush.length === 0) {
    return { updatedAt: nowIso, slotMeta: baseSlotMeta, cloudSynced: false };
  }

  const cloudResult = await pushDcMonitoringSlotsToCloud(slotsToPush, datasets, validationLogs, baseSlotMeta, {
    userName,
    nowIso,
    broadcastCloudEvent,
    senderId
  });

  return { updatedAt: nowIso, slotMeta: baseSlotMeta, ...cloudResult };
}

/**
 * Pushes selected DC Stock Monitoring slots and updates the lightweight master metadata registry row.
 */
export async function pushDcMonitoringSlotsToCloud(slotIds = [], datasets = {}, validationLogs = {}, slotMeta = {}, options = {}) {
  const {
    userName = 'System User',
    nowIso = new Date().toISOString(),
    broadcastCloudEvent = null,
    senderId = 'local'
  } = options;

  const targetSlots = (slotIds || []).filter(id => DC_MONITORING_ALL_SLOT_IDS.includes(id));
  if (targetSlots.length === 0) return { cloudSynced: false, pushedSlots: [] };
  if (!(await isCloudSessionReady())) {
    return { cloudSynced: false, pushedSlots: [], authRequired: true };
  }

  try {
    // 1. Fetch existing cloud meta first so incremental single-slot uploads preserve untouched slots
    const { data: existingMetaRow } = await supabase
      .from('saved_records')
      .select('snapshot_data, updated_at')
      .eq('id', DC_MONITORING_CLOUD_META_DOC_ID)
      .maybeSingle();

    const cloudMeta = existingMetaRow?.snapshot_data && typeof existingMetaRow.snapshot_data === 'object'
      ? { ...existingMetaRow.snapshot_data }
      : { version: 1, clearedAt: null, updatedAt: nowIso, updatedBy: userName, slots: {} };
    const mergedCloudSlots = { ...(cloudMeta.slots || {}) };

    const metaTimeFields = buildSavedRecordMetaFields(nowIso);
    const pushedSlots = [];

    for (const slotId of targetSlots) {
      const rows = Array.isArray(datasets?.[slotId]) ? datasets[slotId] : [];
      const slotUpdatedAt = slotMeta?.[slotId]?.updatedAt || nowIso;
      const slotTimeFields = buildSavedRecordMetaFields(slotUpdatedAt);
      const prevChunkCount = Number(mergedCloudSlots[slotId]?.chunkCount || 0);

      if (rows.length > 0) {
        const contentHash = computeSlotContentHash(slotId, rows);
        const existingCloudSlot = mergedCloudSlots[slotId];
        if (
          existingCloudSlot &&
          !existingCloudSlot.cleared &&
          existingCloudSlot.contentHash &&
          existingCloudSlot.contentHash === contentHash &&
          Number(existingCloudSlot.parsedCount || 0) === rows.length &&
          Number(existingCloudSlot.chunkCount || 0) > 0
        ) {
          continue;
        }

        const chunks = buildSlotChunksForCloud(slotId, rows, slotUpdatedAt);
        for (const chunk of chunks) {
          const { error } = await queuedSavedRecordsUpsert({
            id: chunk.id,
            record_type: 'dc_monitoring_slot',
            period_label: `DC Monitoring Slot: ${slotId}`,
            period_year: slotTimeFields.period_year,
            period_month: slotTimeFields.period_month,
            notes: `DC Monitoring [${slotId}] part ${chunk.chunkIndex + 1}/${chunk.chunkCount} (${rows.length} rows)`,
            snapshot_data: chunk,
            saved_by_name: userName,
            updated_at: slotUpdatedAt
          }, { immediate: true });
          if (error) throw error;
        }

        // Remove stale trailing chunks if the new upload uses fewer chunks than before
        if (prevChunkCount > chunks.length) {
          const obsoleteIds = [];
          for (let idx = chunks.length; idx < prevChunkCount; idx++) {
            obsoleteIds.push(getSlotChunkDocId(slotId, idx));
          }
          if (obsoleteIds.length > 0) {
            try { await supabase.from('saved_records').delete().in('id', obsoleteIds); } catch (e) {}
          }
        }

        mergedCloudSlots[slotId] = {
          updatedAt: slotUpdatedAt,
          updatedBy: userName,
          parsedCount: rows.length,
          contentHash,
          fileName: validationLogs?.[slotId]?.fileName || slotMeta?.[slotId]?.fileName || '',
          chunkCount: chunks.length,
          cleared: false,
          validationLog: validationLogs?.[slotId] || null
        };
        pushedSlots.push(slotId);
      }
    }

    if (pushedSlots.length === 0) {
      return {
        cloudSynced: true,
        pushedSlots: [],
        skippedUnchanged: true,
        updatedAt: cloudMeta.updatedAt || nowIso,
        meta: cloudMeta
      };
    }

    const totalParsedRows = DC_MONITORING_ALL_SLOT_IDS.reduce((sum, s) => {
      return sum + (mergedCloudSlots[s]?.cleared ? 0 : Number(mergedCloudSlots[s]?.parsedCount || 0));
    }, 0);

    const nextMetaSnapshot = {
      version: 1,
      clearedAt: null,
      updatedAt: nowIso,
      updatedBy: userName,
      totalParsedRows,
      slots: mergedCloudSlots
    };

    const { error: metaErr } = await queuedSavedRecordsUpsert({
      id: DC_MONITORING_CLOUD_META_DOC_ID,
      record_type: 'dc_monitoring_meta',
      period_label: 'DC Stock Monitoring Cloud Index',
      period_year: metaTimeFields.period_year,
      period_month: metaTimeFields.period_month,
      notes: `DC Stock Monitoring & SDR Cloud Registry (${totalParsedRows} rows across active datasets)`,
      snapshot_data: nextMetaSnapshot,
      saved_by_name: userName,
      updated_at: nowIso
    }, { immediate: true });

    if (metaErr) throw metaErr;

    if (typeof broadcastCloudEvent === 'function') {
      broadcastCloudEvent('DC_MONITORING_UPDATED', {
        slotIds: pushedSlots,
        updatedAt: nowIso,
        updatedBy: userName,
        senderId,
        count: totalParsedRows
      });
    }

    return { cloudSynced: true, pushedSlots, updatedAt: nowIso, meta: nextMetaSnapshot };
  } catch (e) {
    console.warn('pushDcMonitoringSlotsToCloud warning:', e?.message || e);
    return { cloudSynced: false, pushedSlots: [], error: e?.message || String(e) };
  }
}

/**
 * Bidirectional incremental cloud sync for DC Stock Monitoring datasets, metadata, and ledger.
 * Fetches only the lightweight index/ledger first and downloads only chunks newer than local state.
 */
export async function syncDcMonitoringFromCloud(options = {}) {
  const {
    localState = null,
    userName = 'System User',
    canPushToCloud = false,
    force = false,
    broadcastCloudEvent = null,
    senderId = 'local'
  } = options;

  const currentLocal = localState || (await loadDcMonitoringState());
  const localDatasets = { ...(currentLocal.datasets || {}) };
  const localLogs = { ...(currentLocal.validationLogs || {}) };
  const localSlotMeta = { ...(currentLocal.slotMeta || synthesizeSlotMeta(localDatasets, localLogs, currentLocal)) };

  if (!supabase) {
    return { changed: false, cloudStatus: 'offline', pulledSlots: [], pushedSlots: [], state: currentLocal };
  }

  try {
    const { data: headerRows, error: headerErr } = await supabase
      .from('saved_records')
      .select('id, snapshot_data, updated_at, saved_by_name')
      .in('id', [DC_MONITORING_CLOUD_META_DOC_ID, DC_MONITORING_CLOUD_LEDGER_DOC_ID, LEGACY_CLOUD_LEDGER_DOC_ID]);

    if (headerErr) throw headerErr;

    const metaRow = (headerRows || []).find(r => r.id === DC_MONITORING_CLOUD_META_DOC_ID);
    const primaryLedgerRow = (headerRows || []).find(r => r.id === DC_MONITORING_CLOUD_LEDGER_DOC_ID);
    const legacyLedgerRow = (headerRows || []).find(r => r.id === LEGACY_CLOUD_LEDGER_DOC_ID);

    // Choose newest ledger record across primary and legacy doc IDs
    const cloudLedgerRow = [primaryLedgerRow, legacyLedgerRow]
      .filter(Boolean)
      .sort((a, b) => parseTimestampMs(b.updated_at) - parseTimestampMs(a.updated_at))[0] || null;

    let nextShippingCosts = currentLocal.shippingCosts;
    let nextRemarksMap = currentLocal.remarksMap;
    let ledgerChanged = false;
    let syncedBy = currentLocal.syncedBy || null;
    let latestUpdatedAt = currentLocal.updatedAt || null;

    if (cloudLedgerRow?.snapshot_data) {
      const cloudLedgerTs = parseTimestampMs(cloudLedgerRow.updated_at);
      const localLedgerBundle = await dbStorage.getItem(IDB_LEDGER_KEY).catch(() => null);
      const localLedgerTs = parseTimestampMs(localLedgerBundle?.updatedAt);

      if (force || cloudLedgerTs > localLedgerTs) {
        const snap = cloudLedgerRow.snapshot_data;
        nextShippingCosts = Array.isArray(snap.shippingCosts) && snap.shippingCosts.length > 0
          ? snap.shippingCosts
          : DEFAULT_DC_SHIPPING_COSTS;
        nextRemarksMap = snap.remarksMap && typeof snap.remarksMap === 'object' ? snap.remarksMap : {};
        await dbStorage.setItem(IDB_LEDGER_KEY, {
          shippingCosts: nextShippingCosts,
          remarksMap: nextRemarksMap,
          updatedBy: cloudLedgerRow.saved_by_name || snap.updatedBy || 'Cloud Sync',
          updatedAt: cloudLedgerRow.updated_at
        });
        ledgerChanged = true;
        syncedBy = cloudLedgerRow.saved_by_name || snap.updatedBy || syncedBy;
        if (cloudLedgerTs > parseTimestampMs(latestUpdatedAt)) {
          latestUpdatedAt = cloudLedgerRow.updated_at;
        }
      }
    }

    const cloudMeta = metaRow?.snapshot_data && typeof metaRow.snapshot_data === 'object'
      ? metaRow.snapshot_data
      : null;

    const cloudClearedMs = parseTimestampMs(cloudMeta?.clearedAt);
    const localLatestUploadMs = Math.max(
      0,
      ...DC_MONITORING_ALL_SLOT_IDS.map(id => parseTimestampMs(localSlotMeta[id]?.updatedAt))
    );

    const isCloudGloballyClearedAndNewer = Boolean(
      cloudMeta?.clearedAt &&
      Object.values(cloudMeta.slots || {}).every(s => !s || s.cleared || !s.parsedCount) &&
      cloudClearedMs > Math.max(localLatestUploadMs, parseTimestampMs(currentLocal.clearedAt))
    );

    if (isCloudGloballyClearedAndNewer) {
      await clearAllDcMonitoringData({ skipCloud: true, clearedAt: cloudMeta.clearedAt });
      return {
        changed: true,
        clearedFromCloud: true,
        cloudStatus: 'synced',
        pulledSlots: [],
        pushedSlots: [],
        state: {
          datasets: {},
          validationLogs: {},
          slotMeta: {},
          clearedAt: cloudMeta.clearedAt,
          shippingCosts: nextShippingCosts,
          remarksMap: nextRemarksMap,
          updatedAt: cloudMeta.clearedAt,
          syncedBy: cloudMeta.updatedBy || syncedBy
        }
      };
    }

    const cloudSlots = cloudMeta?.slots || {};
    const slotsToPull = [];
    const slotsToAutoPush = [];
    let prunedStaleLocal = false;
    let alignedLocalMeta = false;

    for (const slotId of DC_MONITORING_ALL_SLOT_IDS) {
      const cSlot = cloudSlots[slotId];
      const lRows = Array.isArray(localDatasets[slotId]) ? localDatasets[slotId] : [];
      const lSlot = localSlotMeta[slotId];

      const cHasData = Boolean(cSlot && !cSlot.cleared && Number(cSlot.parsedCount || 0) > 0 && Number(cSlot.chunkCount || 0) > 0);
      const lHasData = lRows.length > 0;

      const cTs = parseTimestampMs(cSlot?.updatedAt);
      const lTs = parseTimestampMs(lSlot?.updatedAt);
      const effectiveCloudTs = Math.max(cTs, cloudClearedMs);
      const matchesCloudSnapshot = Boolean(
        lHasData &&
        cHasData &&
        lTs === cTs &&
        lRows.length === Number(cSlot?.parsedCount || 0)
      );

      if (cHasData && (!lHasData || cTs > lTs || (force && !matchesCloudSnapshot))) {
        slotsToPull.push(slotId);
      } else if (!cHasData && lHasData && effectiveCloudTs > lTs) {
        delete localDatasets[slotId];
        delete localLogs[slotId];
        delete localSlotMeta[slotId];
        prunedStaleLocal = true;
      } else if (canPushToCloud && lHasData && lTs > effectiveCloudTs) {
        if (cSlot?.contentHash && computeSlotContentHash(slotId, lRows) === cSlot.contentHash) {
          // Content matches cloud byte-for-byte; align local timestamp instead of re-uploading
          localSlotMeta[slotId] = {
            ...(localSlotMeta[slotId] || {}),
            updatedAt: cSlot.updatedAt,
            updatedBy: cSlot.updatedBy || localSlotMeta[slotId]?.updatedBy || userName,
            parsedCount: lRows.length,
            contentHash: cSlot.contentHash,
            cleared: false
          };
          alignedLocalMeta = true;
          continue;
        }
        slotsToAutoPush.push(slotId);
      }
    }

    const pulledSlots = [];
    if (slotsToPull.length > 0) {
      const chunkIdsNeeded = [];
      for (const slotId of slotsToPull) {
        const count = Number(cloudSlots[slotId]?.chunkCount || 0);
        for (let idx = 0; idx < count; idx++) {
          chunkIdsNeeded.push(getSlotChunkDocId(slotId, idx));
        }
      }

      const fetchedChunks = [];
      // Fetch in small batches to keep HTTP response payloads bounded and fast
      for (let i = 0; i < chunkIdsNeeded.length; i += 2) {
        const batchIds = chunkIdsNeeded.slice(i, i + 2);
        const { data: batchRows, error: batchErr } = await supabase
          .from('saved_records')
          .select('id, snapshot_data, updated_at')
          .in('id', batchIds);
        if (batchErr) throw batchErr;
        if (Array.isArray(batchRows)) fetchedChunks.push(...batchRows);
      }

      for (const slotId of slotsToPull) {
        const cSlot = cloudSlots[slotId];
        const prefix = `${DC_MONITORING_SLOT_CHUNK_PREFIX}${slotId}_c`;
        const slotChunks = fetchedChunks.filter(r => r.id?.startsWith(prefix));
        const hydrated = hydrateSlotChunksFromCloud(
          slotId,
          slotChunks,
          cSlot.updatedAt,
          Number(cSlot.chunkCount)
        );

        if (Array.isArray(hydrated) && hydrated.length > 0) {
          localDatasets[slotId] = hydrated;
          if (cSlot.validationLog) {
            localLogs[slotId] = cSlot.validationLog;
          } else {
            localLogs[slotId] = {
              slotId,
              fileName: cSlot.fileName || `${slotId} (Cloud Sync)`,
              status: 'valid',
              parsedCount: hydrated.length,
              skippedCount: 0,
              missingColumns: [],
              warnings: [],
              errors: [],
              timestamp: cSlot.updatedAt
            };
          }
          localSlotMeta[slotId] = {
            updatedAt: cSlot.updatedAt,
            updatedBy: cSlot.updatedBy || cloudMeta?.updatedBy || 'Cloud Sync',
            parsedCount: hydrated.length,
            contentHash: cSlot.contentHash || '',
            fileName: cSlot.fileName || localLogs[slotId]?.fileName || '',
            cleared: false
          };
          pulledSlots.push(slotId);
          syncedBy = cSlot.updatedBy || cloudMeta?.updatedBy || syncedBy;
          if (parseTimestampMs(cSlot.updatedAt) > parseTimestampMs(latestUpdatedAt)) {
            latestUpdatedAt = cSlot.updatedAt;
          }
        }
      }

      if (pulledSlots.length > 0 || prunedStaleLocal || alignedLocalMeta) {
        await saveDcMonitoringDatasets(localDatasets, localLogs, {
          skipCloud: true,
          slotMetaOverride: localSlotMeta,
          userName: syncedBy || userName
        });
      }
    } else if (prunedStaleLocal || alignedLocalMeta) {
      await saveDcMonitoringDatasets(localDatasets, localLogs, {
        skipCloud: true,
        slotMetaOverride: localSlotMeta,
        userName: syncedBy || userName
      });
    }

    let pushedSlots = [];
    if (slotsToAutoPush.length > 0) {
      const pushRes = await pushDcMonitoringSlotsToCloud(
        slotsToAutoPush,
        localDatasets,
        localLogs,
        localSlotMeta,
        {
          userName,
          broadcastCloudEvent,
          senderId
        }
      );
      pushedSlots = pushRes.pushedSlots || [];
    }

    if (cloudMeta?.updatedAt && parseTimestampMs(cloudMeta.updatedAt) > parseTimestampMs(latestUpdatedAt)) {
      latestUpdatedAt = cloudMeta.updatedAt;
      syncedBy = cloudMeta.updatedBy || syncedBy;
    }

    return {
      changed: pulledSlots.length > 0 || ledgerChanged || prunedStaleLocal,
      clearedFromCloud: false,
      cloudStatus: 'synced',
      pulledSlots,
      pushedSlots,
      state: {
        datasets: localDatasets,
        validationLogs: localLogs,
        slotMeta: localSlotMeta,
        clearedAt: null,
        shippingCosts: nextShippingCosts,
        remarksMap: nextRemarksMap,
        updatedAt: latestUpdatedAt || currentLocal.updatedAt,
        syncedBy
      }
    };
  } catch (e) {
    console.warn('syncDcMonitoringFromCloud warning:', e?.message || e);
    return {
      changed: false,
      cloudStatus: 'offline',
      pulledSlots: [],
      pushedSlots: [],
      error: e?.message || String(e),
      state: currentLocal
    };
  }
}

export async function saveDcMonitoringLedger({
  shippingCosts = [],
  remarksMap = {},
  userName = 'System User',
  broadcastCloudEvent = null,
  senderId = 'local'
}) {
  const nowIso = new Date().toISOString();
  const payload = {
    shippingCosts,
    remarksMap,
    updatedBy: userName,
    updatedAt: nowIso
  };

  try {
    await dbStorage.setItem(IDB_LEDGER_KEY, payload);
  } catch (e) {
    console.warn('saveDcMonitoringLedger IDB error:', e);
  }

  broadcastDcMonitoringSync('DC_MONITORING_LEDGER_UPDATED', { updatedAt: nowIso });

  if (await isCloudSessionReady()) {
    try {
      const timeFields = buildSavedRecordMetaFields(nowIso);
      const { error } = await queuedSavedRecordsUpsert({
        id: DC_MONITORING_CLOUD_LEDGER_DOC_ID,
        record_type: 'dc_monitoring_ledger',
        period_label: 'DC Monitoring Shipping & Remarks',
        period_year: timeFields.period_year,
        period_month: timeFields.period_month,
        notes: 'DC Stock Monitoring Shipping ROI & SDR Repeat Breakdown Remarks',
        snapshot_data: payload,
        saved_by_name: userName,
        updated_at: nowIso
      }, { immediate: true });
      if (error) throw error;

      if (typeof broadcastCloudEvent === 'function') {
        broadcastCloudEvent('DC_MONITORING_UPDATED', {
          slotIds: ['ledger'],
          updatedAt: nowIso,
          updatedBy: userName,
          senderId
        });
      }
    } catch (e) {
      console.warn('Cloud ledger sync queued/deferred:', e?.message || e);
    }
  }

  return payload;
}

export async function fetchCloudDcMonitoringLedger(localUpdatedAt = null) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('saved_records')
      .select('id, snapshot_data, updated_at, saved_by_name')
      .in('id', [DC_MONITORING_CLOUD_LEDGER_DOC_ID, LEGACY_CLOUD_LEDGER_DOC_ID]);
    if (error || !Array.isArray(data) || data.length === 0) return null;

    const newest = [...data].sort((a, b) => parseTimestampMs(b.updated_at) - parseTimestampMs(a.updated_at))[0];
    if (!newest?.snapshot_data) return null;

    const cloudTs = parseTimestampMs(newest.updated_at);
    const localTs = parseTimestampMs(localUpdatedAt);
    if (cloudTs && localTs && cloudTs <= localTs) return null;

    const payload = {
      shippingCosts: Array.isArray(newest.snapshot_data.shippingCosts) && newest.snapshot_data.shippingCosts.length > 0
        ? newest.snapshot_data.shippingCosts
        : DEFAULT_DC_SHIPPING_COSTS,
      remarksMap: newest.snapshot_data.remarksMap || {},
      updatedBy: newest.saved_by_name || newest.snapshot_data.updatedBy || 'Cloud Sync',
      updatedAt: newest.updated_at
    };
    await dbStorage.setItem(IDB_LEDGER_KEY, payload);
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Pulls overlapping cached Fixably datasets already stored in IndexedDB by All Stocks / FIFO Audit
 * so users do not need to upload Site Stock, KGB Used, or Stock Transfers twice.
 */
export async function pullAvailableFixablySlotsFromAllStocks() {
  const pulledDatasets = {};
  const pulledLogs = {};
  const pulledSlotIds = [];
  const mappings = [
    { key: 'mdc_uploaded_slot_site_stock', slotId: 'site_stock', fallbackName: 'AllStocks_Site_Stock.csv' },
    { key: 'mdc_uploaded_slot_kgb_used', slotId: 'kgb_used', fallbackName: 'AllStocks_KGB_Used.csv' },
    { key: 'mdc_uploaded_slot_stock_transfer', slotId: 'stock_transfer', fallbackName: 'AllStocks_Stock_Transfers.csv' }
  ];

  for (const m of mappings) {
    try {
      const cachedSlot = await dbStorage.getItem(m.key);
      if (!cachedSlot?.content) continue;
      const { records, validationLog } = await ingestDcMonitoringFile(m.slotId, {
        name: cachedSlot.name || m.fallbackName,
        content: cachedSlot.content
      });
      if (validationLog?.status !== 'error' && Array.isArray(records) && records.length > 0) {
        pulledDatasets[m.slotId] = records;
        pulledLogs[m.slotId] = validationLog;
        pulledSlotIds.push(m.slotId);
      }
    } catch (e) {
      console.warn(`Unable to pull cached Fixably slot (${m.key}):`, e);
    }
  }

  return {
    pulledDatasets,
    pulledLogs,
    pulledSlotIds,
    pulledCount: pulledSlotIds.length
  };
}

export async function clearAllDcMonitoringData(options = {}) {
  const {
    userName = 'System User',
    skipCloud = false,
    clearedAt = new Date().toISOString(),
    broadcastCloudEvent = null,
    senderId = 'local'
  } = options;

  try {
    await dbStorage.removeItem(IDB_DATASETS_KEY);
    await dbStorage.removeItem(IDB_LEDGER_KEY);
  } catch (e) {}

  writeLocalMeta({
    updatedAt: clearedAt,
    clearedAt,
    syncedBy: userName,
    slotMeta: {},
    validationLogs: {},
    counts: {}
  });
  broadcastDcMonitoringSync('DC_MONITORING_CLEARED', { clearedAt });

  if (!skipCloud && (await isCloudSessionReady())) {
    try {
      const timeFields = buildSavedRecordMetaFields(clearedAt);
      const clearedSlots = {};
      for (const slotId of DC_MONITORING_ALL_SLOT_IDS) {
        clearedSlots[slotId] = {
          updatedAt: clearedAt,
          updatedBy: userName,
          parsedCount: 0,
          chunkCount: 0,
          cleared: true
        };
      }

      await queuedSavedRecordsUpsert({
        id: DC_MONITORING_CLOUD_META_DOC_ID,
        record_type: 'dc_monitoring_meta',
        period_label: 'DC Stock Monitoring Cloud Index',
        period_year: timeFields.period_year,
        period_month: timeFields.period_month,
        notes: `Cleared by ${userName}`,
        snapshot_data: {
          version: 1,
          clearedAt,
          updatedAt: clearedAt,
          updatedBy: userName,
          totalParsedRows: 0,
          slots: clearedSlots
        },
        saved_by_name: userName,
        updated_at: clearedAt
      }, { immediate: true });

      if (typeof broadcastCloudEvent === 'function') {
        broadcastCloudEvent('DC_MONITORING_CLEARED', {
          updatedAt: clearedAt,
          updatedBy: userName,
          senderId
        });
      }
    } catch (e) {
      console.warn('clearAllDcMonitoringData cloud tombstone warning:', e?.message || e);
    }
  }
}
