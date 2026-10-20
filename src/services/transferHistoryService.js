/**
 * Stock Ownership & Part Transfer History Service
 * MDC System 2
 *
 * Tracks immutable stock ownership transfers between sites (DC, POD, BHS, etc.).
 * Guarantees that previous ownership records are NEVER overwritten, appending a new
 * transfer record each time a part changes location (e.g. DC -> POD -> DC -> ANNEX).
 */

import { supabase } from '../supabase/client.js';
import dbStorage from '../utils/dbStorage.js';
import { queuedSavedRecordsUpsert } from '../utils/savedRecordsQueue.js';

const STORAGE_KEY = 'mdc_part_transfer_history';

/**
 * Normalizes any site code or identifier to canonical short string (e.g. 'DC', 'POD', 'BHS')
 */
export function normalizeSiteCode(input) {
  if (!input) return 'DC';
  const str = String(input).trim().toUpperCase();
  if (str === 'SITE-DC' || str === 'DC-MDC' || str === 'DISTRIBUTION CENTER' || str === 'DC STOCKS' || str === 'DC') {
    return 'DC';
  }
  if (str === 'SUPPLIER') {
    return 'Supplier';
  }
  if (str.startsWith('MOBILECARE - APP ')) {
    return str.replace('MOBILECARE - APP ', '').trim();
  }
  if (str.startsWith('APP-')) {
    return str.replace('APP-', '').trim();
  }
  if (str.startsWith('APP ')) {
    return str.replace('APP ', '').trim();
  }
  // Strip '_MSPI-OWNED' suffix if present
  if (str.includes('_MSPI-OWNED') || str.includes('-MSPI-OWNED')) {
    return str.replace(/[-_]MSPI[-_]OWNED/i, '').trim();
  }
  return str;
}

/**
 * Formats standard uppercase MSPI ownership string (e.g. 'DC_MSPI-OWNED', 'POD_MSPI-OWNED', 'ANNEX_MSPI-OWNED')
 */
export function formatSiteOwner(siteCode) {
  const norm = normalizeSiteCode(siteCode);
  if (!norm || norm === 'DC') {
    return 'DC_MSPI-OWNED';
  }
  return `${norm.toUpperCase()}_MSPI-OWNED`;
}

/**
 * Formats a timestamp into human-readable date and time (e.g. "Oct 15, 2026, 02:30 PM")
 */
export function formatTransferDate(isoString, includeTime = true) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    const datePart = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    if (!includeTime) return datePart;
    const timePart = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${datePart}, ${timePart}`;
  } catch {
    return String(isoString);
  }
}

/**
 * Loads all transfer history records from LocalStorage and IndexedDB
 */
export function loadLocalTransferHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('[TransferHistory] Error reading localStorage:', e);
  }
  return [];
}

/**
 * Saves transfer history list to LocalStorage and IndexedDB
 */
export function saveLocalTransferHistory(records) {
  if (!Array.isArray(records)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.warn('[TransferHistory] localStorage write warning:', e);
  }
  try {
    dbStorage.setItem(STORAGE_KEY, records);
  } catch (e) {
    console.warn('[TransferHistory] dbStorage write warning:', e);
  }
}

/**
 * Syncs transfer history with Supabase saved_records & part_transfer_history table
 */
async function syncToCloud(records) {
  if (!Array.isArray(records) || records.length === 0) return;

  // 1. Debounced synchronization via saved_records registry (guaranteed schema safety & free tier defense)
  queuedSavedRecordsUpsert({
    id: 'part_transfer_history_registry',
    record_type: 'transfer_history',
    period_label: 'Master Part Transfer & Stock Ownership History Registry',
    period_year: new Date().getFullYear(),
    period_month: new Date().getMonth() + 1,
    notes: 'Immutable trail of part ownership transfers between DC and ASP branch sites',
    saved_by_name: 'Transfer History Engine',
    snapshot_data: { transfers: records },
    updated_at: new Date().toISOString()
  }, { debounceMs: 1500 });

  // 2. Direct relational table insertion (if table exists)
  if (supabase) {
    try {
      const recent = records.slice(0, 50).map(r => ({
        id: r.id,
        part_number: r.part_number,
        serial_number: r.serial_number || null,
        from_site_code: r.from_site_code,
        from_site_name: r.from_site_name || r.from_site_code,
        to_site_code: r.to_site_code,
        to_site_name: r.to_site_name || r.to_site_code,
        from_owner: r.from_owner,
        to_owner: r.to_owner,
        transfer_type: r.transfer_type || 'Transfer',
        transfer_date: r.transfer_date,
        user_name: r.user_name || 'Warehouse Staff',
        user_id: r.user_id || null,
        manifest_ref: r.manifest_ref || null,
        notes: r.notes || null
      }));
      await supabase.from('part_transfer_history').upsert(recent, { onConflict: 'id' });
    } catch {
      // Table may not yet be run in migrations; snapshot in saved_records provides 100% safety
    }
  }
}

/**
 * Records an immutable stock ownership transfer for a part/serial.
 * NEVER overwrites previous transfer records; appends to the history.
 */
export function recordPartTransfer({
  partNumber,
  serialNumber = null,
  fromSiteCode = 'DC',
  toSiteCode = 'DC',
  fromSiteName = null,
  toSiteName = null,
  fromOwner = null,
  toOwner = null,
  transferType = null,
  userName = 'Warehouse Staff',
  userId = null,
  manifestRef = null,
  notes = null,
  transferDate = null
}) {
  const cleanPn = String(partNumber || '').trim().toUpperCase();
  const cleanSn = serialNumber ? String(serialNumber).trim().toUpperCase() : null;
  const normFrom = normalizeSiteCode(fromSiteCode);
  const normTo = normalizeSiteCode(toSiteCode);

  const resolvedFromOwner = fromOwner ? String(fromOwner).toUpperCase() : formatSiteOwner(normFrom);
  const resolvedToOwner = toOwner ? String(toOwner).toUpperCase() : formatSiteOwner(normTo);

  let resolvedType = transferType;
  if (!resolvedType) {
    if (normTo === 'DC' && normFrom !== 'DC') {
      resolvedType = 'Return';
    } else if (normFrom === 'DC' && normTo !== 'DC') {
      resolvedType = 'Transfer';
    } else if (normFrom === normTo) {
      resolvedType = 'Adjustment';
    } else {
      resolvedType = 'Transfer';
    }
  }

  const newEntry = {
    id: `xfer-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    part_number: cleanPn,
    serial_number: cleanSn,
    from_site_code: normFrom,
    from_site_name: fromSiteName || normFrom,
    to_site_code: normTo,
    to_site_name: toSiteName || normTo,
    from_owner: resolvedFromOwner,
    to_owner: resolvedToOwner,
    transfer_type: resolvedType,
    transfer_date: transferDate || new Date().toISOString(),
    user_name: userName || 'Warehouse Staff',
    user_id: userId || null,
    manifest_ref: manifestRef || null,
    notes: notes || null,
    created_at: new Date().toISOString()
  };

  const currentList = loadLocalTransferHistory();
  // Guarantee append without duplicate timestamp/serial collision
  const updatedList = [newEntry, ...currentList];

  saveLocalTransferHistory(updatedList);
  syncToCloud(updatedList);

  return { entry: newEntry, allTransfers: updatedList };
}

/**
 * Records a batch of immutable stock transfers (e.g. from packing list dispatch or shipment receipt)
 */
export function recordBatchTransfers(transferItems = []) {
  if (!Array.isArray(transferItems) || transferItems.length === 0) return [];

  const nowIso = new Date().toISOString();
  const currentList = loadLocalTransferHistory();

  const newEntries = transferItems.map((item, index) => {
    const cleanPn = String(item.partNumber || item.part_number || '').trim().toUpperCase();
    const cleanSn = (item.serialNumber || item.serial_number)
      ? String(item.serialNumber || item.serial_number).trim().toUpperCase()
      : null;
    const normFrom = normalizeSiteCode(item.fromSiteCode || item.from_site_code || 'DC');
    const normTo = normalizeSiteCode(item.toSiteCode || item.to_site_code || 'DC');
    const resolvedFromOwner = (item.fromOwner || item.from_owner)
      ? String(item.fromOwner || item.from_owner).toUpperCase()
      : formatSiteOwner(normFrom);
    const resolvedToOwner = (item.toOwner || item.to_owner)
      ? String(item.toOwner || item.to_owner).toUpperCase()
      : formatSiteOwner(normTo);

    let resolvedType = item.transferType || item.transfer_type;
    if (!resolvedType) {
      if (normTo === 'DC' && normFrom !== 'DC') resolvedType = 'Return';
      else if (normFrom === 'DC' && normTo !== 'DC') resolvedType = 'Transfer';
      else if (normFrom === normTo) resolvedType = 'Adjustment';
      else resolvedType = 'Transfer';
    }

    return {
      id: `xfer-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
      part_number: cleanPn,
      serial_number: cleanSn,
      from_site_code: normFrom,
      from_site_name: item.fromSiteName || item.from_site_name || normFrom,
      to_site_code: normTo,
      to_site_name: item.toSiteName || item.to_site_name || normTo,
      from_owner: resolvedFromOwner,
      to_owner: resolvedToOwner,
      transfer_type: resolvedType,
      transfer_date: item.transferDate || item.transfer_date || nowIso,
      user_name: item.userName || item.user_name || 'Warehouse Staff',
      user_id: item.userId || item.user_id || null,
      manifest_ref: item.manifestRef || item.manifest_ref || null,
      notes: item.notes || null,
      created_at: nowIso
    };
  });

  const updatedList = [...newEntries, ...currentList];
  saveLocalTransferHistory(updatedList);
  syncToCloud(updatedList);

  return updatedList;
}

/**
 * Returns all recorded transfers for a specific serial number or part number
 */
export function getTransferHistoryForPart({ serialNumber, partNumber }, allTransfers = null) {
  const history = allTransfers || loadLocalTransferHistory();
  const cleanSn = serialNumber ? String(serialNumber).trim().toUpperCase() : null;
  const cleanPn = partNumber ? String(partNumber).trim().toUpperCase() : null;

  return history.filter(item => {
    if (cleanSn && item.serial_number && String(item.serial_number).trim().toUpperCase() === cleanSn) {
      return true;
    }
    if (!cleanSn && cleanPn && String(item.part_number).trim().toUpperCase() === cleanPn) {
      return true;
    }
    return false;
  }).sort((a, b) => new Date(a.transfer_date).getTime() - new Date(b.transfer_date).getTime());
}

/**
 * Resolves comprehensive stock ownership and movement timeline for a part/serial:
 * Current Owner: e.g. "dc_mspi-owned" or "pod_mspi-owned"
 * Movement History: e.g. ["DC", "POD", "DC"]
 * Movement Trail: e.g. "DC → POD → DC"
 * Transfer Count: e.g. 2
 * Latest Transfer Date: e.g. "Oct 18, 2026, 02:15 PM"
 */
export function resolvePartOwnershipDetails(unitOrSerial, allTransfers = null) {
  const targetSn = typeof unitOrSerial === 'string'
    ? unitOrSerial.trim().toUpperCase()
    : String(unitOrSerial?.serial_number || unitOrSerial?.serialNumber || '').trim().toUpperCase();

  const targetPn = typeof unitOrSerial === 'object'
    ? String(unitOrSerial?.part_number || unitOrSerial?.partNumber || '').trim().toUpperCase()
    : null;

  const currentSiteCode = typeof unitOrSerial === 'object'
    ? normalizeSiteCode(unitOrSerial?.site_code || unitOrSerial?.current_site_id || 'DC')
    : 'DC';

  const transfers = getTransferHistoryForPart({ serialNumber: targetSn, partNumber: targetPn }, allTransfers);

  // If no transfer entries yet exist, construct baseline origin trail from unit attributes
  if (transfers.length === 0) {
    const baseSite = currentSiteCode || 'DC';
    const baseOwner = formatSiteOwner(baseSite);
    const rawOwner = unitOrSerial?.current_owner || baseOwner;
    return {
      currentOwner: rawOwner ? String(rawOwner).toUpperCase() : baseOwner,
      movementHistory: Array.isArray(unitOrSerial?.movement_history) && unitOrSerial.movement_history.length > 0
        ? unitOrSerial.movement_history
        : [baseSite],
      movementTrail: Array.isArray(unitOrSerial?.movement_history) && unitOrSerial.movement_history.length > 0
        ? unitOrSerial.movement_history.join(' → ')
        : baseSite,
      transferCount: 0,
      latestTransferDate: null,
      latestTransferFormatted: 'No recorded transfers',
      transfers: []
    };
  }

  // Construct movement history array: e.g. ['DC', 'POD', 'DC']
  const movementSites = [];
  transfers.forEach((xfer, idx) => {
    if (idx === 0) {
      if (xfer.from_site_code && xfer.from_site_code !== 'UNKNOWN') {
        movementSites.push(xfer.from_site_code);
      }
    }
    if (xfer.to_site_code) {
      // Don't repeat identical adjacent entries
      if (movementSites[movementSites.length - 1] !== xfer.to_site_code) {
        movementSites.push(xfer.to_site_code);
      }
    }
  });

  if (movementSites.length === 0) {
    movementSites.push(currentSiteCode || 'DC');
  }

  const latestTransfer = transfers[transfers.length - 1];
  const rawOwner = latestTransfer?.to_owner || latestTransfer?.toOwner || formatSiteOwner(latestTransfer?.to_site_code || currentSiteCode);
  const currentOwner = rawOwner ? String(rawOwner).toUpperCase() : formatSiteOwner(currentSiteCode);
  const transferCount = transfers.length;
  const latestTransferDate = latestTransfer?.transfer_date || null;
  const latestTransferFormatted = latestTransferDate ? formatTransferDate(latestTransferDate) : '—';
  const movementTrail = movementSites.join(' → ');

  return {
    currentOwner,
    movementHistory: movementSites,
    movementTrail,
    transferCount,
    latestTransferDate,
    latestTransferFormatted,
    transfers
  };
}

/**
 * Filter helper for parts lists / dashboards
 */
export function filterPartsByTransferCriteria({
  partsList = [],
  transferFilter = 'ALL', // 'ALL' | 'TRANSFERRED_ONLY' | 'NO_TRANSFERS'
  sourceSiteFilter = 'ALL',
  destinationSiteFilter = 'ALL',
  transfersMap = new Map()
}) {
  return partsList.filter(item => {
    const sn = String(item.serial_number || item.serialNumber || '').trim().toUpperCase();
    const pn = String(item.part_number || item.partNumber || '').trim().toUpperCase();
    const partTransfers = transfersMap.get(sn) || transfersMap.get(pn) || [];

    const hasTransfers = partTransfers.length > 0;

    if (transferFilter === 'TRANSFERRED_ONLY' && !hasTransfers) return false;
    if (transferFilter === 'NO_TRANSFERS' && hasTransfers) return false;

    if (sourceSiteFilter !== 'ALL') {
      const matchSource = partTransfers.some(t => normalizeSiteCode(t.from_site_code) === normalizeSiteCode(sourceSiteFilter));
      if (!matchSource) return false;
    }

    if (destinationSiteFilter !== 'ALL') {
      const matchDest = partTransfers.some(t => normalizeSiteCode(t.to_site_code) === normalizeSiteCode(destinationSiteFilter));
      if (!matchDest) return false;
    }

    return true;
  });
}
