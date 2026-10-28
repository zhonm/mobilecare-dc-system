/**
 * Serial Number Intelligence & Custody Tracker Utility
 * Resolves complete lifecycle, current location, arrival dates, and repair consumption records.
 */
import { defaultPartsCatalog } from '../data/defaultCatalog.js';
import { isShipmentActive, isShipmentReceived } from './shipmentHelpers.js';
import {
  resolvePartOwnershipDetails,
  loadLocalTransferHistory,
  normalizeSiteCode,
  formatSiteOwner
} from '../services/transferHistoryService.js';

/**
 * Resolves effective Fixably items and stock transfer records, falling back to
 * persisted snapshot / transfer history when a caller omits them.
 */
function resolveEffectiveFixablySources(fixablyItems = [], fixablyTransfers = []) {
  let effectiveFixablyItems = Array.isArray(fixablyItems) ? fixablyItems : [];
  let effectiveFixablyTransfers = Array.isArray(fixablyTransfers) ? fixablyTransfers : [];

  if (
    (effectiveFixablyItems.length === 0 || effectiveFixablyTransfers.length === 0) &&
    typeof localStorage !== 'undefined'
  ) {
    try {
      const rawSnap = localStorage.getItem('mdc_fixably_snapshot');
      if (rawSnap) {
        const parsedSnap = JSON.parse(rawSnap);
        if (effectiveFixablyItems.length === 0 && Array.isArray(parsedSnap?.items)) {
          effectiveFixablyItems = parsedSnap.items;
        }
        if (effectiveFixablyTransfers.length === 0 && Array.isArray(parsedSnap?.transfers)) {
          effectiveFixablyTransfers = parsedSnap.transfers;
        }
      }
    } catch {
      // Ignore storage parse warnings
    }
  }

  const localHistory = loadLocalTransferHistory();
  return {
    effectiveFixablyItems,
    effectiveFixablyTransfers,
    localHistory: Array.isArray(localHistory) ? localHistory : []
  };
}

/**
 * Normalizes and cleans raw barcode / serial input
 * Strips standard GS1 barcode prefixes (e.g. S, 1S) and Datamatrix control characters
 */
export function cleanSerialNumberInput(rawInput) {
  if (!rawInput) return '';
  let str = String(rawInput).trim();

  // Strip standard barcode GS1 prefixes 'S' or '1S' if length >= 11
  if (/^1?S[A-Za-z0-9]{10,24}$/i.test(str) && str.length >= 11) {
    str = str.replace(/^1?S/i, '');
  }

  // Strip GS1 control characters
  // eslint-disable-next-line no-control-regex
  str = str.replace(/[\u001d\u001e\u0006\r\n]/g, '').trim();

  return str.toUpperCase();
}

/**
 * Helper to parse combined 2D / GS1 DataMatrix / Tab / Slash / Space delimited barcode formats
 * Returns { pn, sn } or { sn } or null
 */
export function parseBarcodeData(raw) {
  if (!raw) return null;
  let str = String(raw).trim();

  // 1. GS1 DataMatrix with Group Separators or control headers
  if (str.startsWith('[)>') || str.includes('06\x1d') || str.includes('\x1d') || str.includes('\x1e')) {
    const pMatch = str.match(/P([0-9]{3}-?[0-9]{4,6})/i);
    const sMatch = str.match(/S([A-Za-z0-9]{8,24})/i);
    if (pMatch && sMatch) {
      let pn = pMatch[1];
      if (/^[0-9]{7,9}$/.test(pn)) pn = `${pn.slice(0, 3)}-${pn.slice(3)}`;
      return { pn, sn: sMatch[1] };
    }
    if (sMatch) {
      return { pn: null, sn: sMatch[1] };
    }
  }

  // 2. Delimited formats: PN,SN or PN/SN or PN\tSN or PN|SN or PN#SN
  const match = str.match(/^([A-Za-z0-9-,s]+?)[,\t/|#;]([A-Za-z0-9-]+)$/);
  if (match) {
    let pn = match[1].trim();
    let sn = match[2].trim();
    if (/^1?P[0-9]{3}-?[0-9]{4,6}$/i.test(pn)) pn = pn.replace(/^1?P/i, '');
    if (/^1?S[A-Za-z0-9]{8,24}$/i.test(sn) && sn.length > 10) sn = sn.replace(/^1?S/i, '');
    if (pn.toUpperCase() === 'PART' || pn.toUpperCase() === 'PART-UNKNOWN') return null;
    return { pn, sn };
  }

  // 3. Space-separated: PN SN
  const spaceMatch = str.match(/^([0-9]{3}-?[0-9]{4,6}|[A-Za-z0-9-,s]+?)\s+([A-Za-z0-9]{8,24})$/);
  if (spaceMatch) {
    let pn = spaceMatch[1].trim();
    let sn = spaceMatch[2].trim();
    if (pn.toUpperCase() === 'PART' || pn.toUpperCase() === 'PART-UNKNOWN') return null;
    return { pn, sn };
  }

  return null;
}

/**
 * Robust serial number extractor that handles 2D barcodes, delimited strings,
 * GS1 prefixes (S/1S), control chars, and whitespace.
 */
export function extractSerialNumber(rawInput) {
  if (!rawInput) return '';
  const parsed = parseBarcodeData(rawInput);
  const target = parsed?.sn || rawInput;
  return cleanSerialNumberInput(target);
}

/**
 * Resolves complete intelligence for a specific serial number or list of serials
 *
 * @param {string} serialInput - The serial number or partial string to query
 * @param {Object} options
 * @param {Object} options
 * @param {Array} options.inventoryUnits - Current active inventory units
 * @param {Array} options.shipments - Outbound and confirmed shipment manifests
 * @param {Array} options.repairUsageRecords - Consumed repair records
 * @param {Array} options.sites - Master list of site objects
 * @param {Array} options.parts - Master parts catalog
 * @param {Array} options.fixablyItems - Active branch site stock snapshot items
 * @returns {Object|null} Comprehensive serial dossier object
 */
export function resolveSerialFullDetails(serialInput, {
  inventoryUnits = [],
  shipments = [],
  repairUsageRecords = [],
  sites = [],
  parts = [],
  fixablyItems = [],
  fixablyTransfers = []
} = {}) {
  const cleanSerial = cleanSerialNumberInput(serialInput);
  if (!cleanSerial) return null;

  const {
    effectiveFixablyItems,
    effectiveFixablyTransfers,
    localHistory
  } = resolveEffectiveFixablySources(fixablyItems, fixablyTransfers);

  // 1. Check Inventory Units
  const unit = (inventoryUnits || []).find(u =>
    cleanSerialNumberInput(u.serial_number) === cleanSerial
  );

  // 2. Check Shipments (Items inside any manifest)
  let linkedShipment = null;
  let shipmentItem = null;

  for (const s of (shipments || [])) {
    const foundItem = (s.items || []).find(it =>
      cleanSerialNumberInput(it.serial_number || it.serialNumber) === cleanSerial
    );
    if (foundItem) {
      linkedShipment = s;
      shipmentItem = foundItem;
      break;
    }
  }

  // 3. Check Repair Usage Records
  const usageRecord = (repairUsageRecords || []).find(r =>
    cleanSerialNumberInput(r.serial_number) === cleanSerial
  );

  // 4. Check Fixably Branch Inventory Items
  let fixablyUnit = null;
  if (Array.isArray(effectiveFixablyItems)) {
    fixablyUnit = effectiveFixablyItems.find(it =>
      cleanSerialNumberInput(it.serialNumber || it.serial_number) === cleanSerial
    );
  }

  // 5. Check Fixably Stock Transfers & Transfer History Ledger
  const matchedTransfers = [];
  const seenTransferKeys = new Set();

  const appendMatchedTransfer = (tr, idx) => {
    const sn = cleanSerialNumberInput(tr.serialNumber || tr.serial_number);
    if (sn !== cleanSerial) return;

    const pn = String(tr.productCode || tr.part_number || tr.partNumber || '').trim().toUpperCase();
    const fromCode = normalizeSiteCode(tr.fromSiteCode || tr.from_site_code || tr.fromStock || 'DC');
    const toCode = normalizeSiteCode(tr.toSiteCode || tr.to_site_code || tr.toStock || 'DC');
    const dateSlice = String(tr.receivedDate || tr.received_date || tr.transfer_date || '').slice(0, 10);
    const dedupeKey = `${sn}|${dateSlice}|${fromCode}|${toCode}|${pn}`;
    if (seenTransferKeys.has(dedupeKey)) return;
    seenTransferKeys.add(dedupeKey);

    let desc = tr.productName || tr.description || null;
    if (!desc && tr.notes && typeof tr.notes === 'string') {
      desc = tr.notes.replace(/\s*\(\$[\d.,]+\)\s*$/, '').trim();
    }

    const isReturnToDc = Boolean(tr.isReturnToDc || tr.transfer_type === 'Return' || (toCode === 'DC' && fromCode !== 'DC'));
    const isAdjustment = Boolean(tr.isAdjustment || tr.transfer_type === 'Adjustment' || fromCode === toCode);
    const isSiteToSite = Boolean(tr.isSiteToSite || tr.transfer_type === 'Site-to-Site Transfer' || (fromCode !== 'DC' && toCode !== 'DC' && fromCode !== toCode));

    matchedTransfers.push({
      id: tr.id || `xfer-${cleanSerial}-${idx}`,
      part_number: pn,
      description: desc,
      serial_number: cleanSerial,
      from_site_code: fromCode,
      from_site_name: tr.fromSiteName || tr.from_site_name || tr.fromStock || fromCode,
      to_site_code: toCode,
      to_site_name: tr.toSiteName || tr.to_site_name || tr.toStock || toCode,
      from_owner: tr.from_owner || formatSiteOwner(fromCode),
      to_owner: tr.currentOwner || tr.to_owner || formatSiteOwner(toCode),
      transfer_type: tr.transferType || tr.transfer_type || (isSiteToSite ? 'Site-to-Site Transfer' : isReturnToDc ? 'Return' : isAdjustment ? 'Adjustment' : 'Transfer'),
      transfer_date: tr.transfer_date || (dateSlice ? `${dateSlice}T08:00:00.000Z` : ''),
      receivedDate: dateSlice,
      transferValue: Number(tr.transferValue || tr.transfer_value || 0),
      isSiteToSite,
      isReturnToDc,
      isAdjustment,
      rowIndex: tr.rowIndex ?? idx
    });
  };

  effectiveFixablyTransfers.forEach((tr, idx) => appendMatchedTransfer(tr, idx));
  localHistory.forEach((tr, idx) => appendMatchedTransfer(tr, effectiveFixablyTransfers.length + idx));

  matchedTransfers.sort((a, b) => {
    const cmp = String(a.receivedDate || '').localeCompare(String(b.receivedDate || ''));
    if (cmp !== 0) return cmp;
    return (a.rowIndex || 0) - (b.rowIndex || 0);
  });

  const latestMatchedTransfer = matchedTransfers.length > 0
    ? matchedTransfers[matchedTransfers.length - 1]
    : null;

  // If serial is not found in any dataset (including stock transfer ledger), return null
  if (!unit && !linkedShipment && !usageRecord && !fixablyUnit && !latestMatchedTransfer) {
    return null;
  }

  // 6. Resolve Part Metadata
  const rawPn = unit?.part_number || shipmentItem?.part_number || shipmentItem?.partNumber || usageRecord?.part_number || fixablyUnit?.partNumber || fixablyUnit?.part_number || latestMatchedTransfer?.part_number || '';
  const cleanPn = String(rawPn).trim().toUpperCase();

  const fullCatalog = [...(parts || []), ...(defaultPartsCatalog || [])];
  const matchedPart = fullCatalog.find(p => p.part_number && p.part_number.toUpperCase() === cleanPn)
    || fullCatalog.find(p => p.id && (p.id === unit?.part_id || p.id === shipmentItem?.part_id))
    || null;

  const partNumber = matchedPart?.part_number || cleanPn || 'Apple Service Part';
  const partDescription = matchedPart?.description || fixablyUnit?.description || unit?.description || shipmentItem?.description || usageRecord?.description || latestMatchedTransfer?.description || 'Apple Genuine Component';
  let iphoneModel = matchedPart?.iphone_model || unit?.iphone_model || '';
  if (!iphoneModel && partDescription) {
    const modelMatch = partDescription.match(/iPhone\s+[0-9A-Za-z\s+ProMaxMiniPlusSEe]+/i);
    if (modelMatch) iphoneModel = modelMatch[0].trim();
  }
  if (!iphoneModel) iphoneModel = 'iPhone';
  const categoryId = matchedPart?.category_id || unit?.category_id || '';
  const stockingPrice = matchedPart?.stocking_price || unit?.stocking_price || fixablyUnit?.partValue || latestMatchedTransfer?.transferValue || 0;

  // 7. Resolve Stock Ownership & Transfer History first so latest transfers inform current site
  const unitRecDate = String(unit?.received_date || unit?.received_at || '').slice(0, 10);
  const fixablyRecDate = String(fixablyUnit?.lastReceivedDate || fixablyUnit?.dateReceived || '').slice(0, 10);
  const preferFixably = Boolean(
    fixablyUnit && (
      !unit ||
      fixablyUnit.wasRelocatedByTransfer ||
      fixablyUnit.wasSynthesizedFromTransfer ||
      (fixablyRecDate && (!unitRecDate || fixablyRecDate >= unitRecDate))
    )
  );

  const primaryUnitRef = preferFixably
    ? {
        ...unit,
        ...fixablyUnit,
        serial_number: cleanSerial,
        part_number: partNumber,
        site_code: fixablyUnit.siteCode || fixablyUnit.site_code || unit?.site_code,
        current_site_id: fixablyUnit.siteId || fixablyUnit.current_site_id || unit?.current_site_id,
        current_owner: fixablyUnit.currentOwner || fixablyUnit.current_owner || unit?.current_owner,
        movement_history: fixablyUnit.movementHistory || fixablyUnit.movement_history || unit?.movement_history,
        transfer_count: fixablyUnit.transferCount ?? fixablyUnit.transfer_count ?? unit?.transfer_count
      }
    : (unit || {
        serial_number: cleanSerial,
        part_number: partNumber,
        site_code: fixablyUnit?.siteCode || linkedShipment?.site_code || latestMatchedTransfer?.to_site_code || 'DC',
        current_site_id: fixablyUnit?.siteId || linkedShipment?.site_id
      });

  const ownership = resolvePartOwnershipDetails(
    primaryUnitRef,
    matchedTransfers.length > 0 ? matchedTransfers : null
  );
  const latestRecordedTransfer = ownership.transfers?.length > 0
    ? ownership.transfers[ownership.transfers.length - 1]
    : (fixablyUnit?.latestTransfer || latestMatchedTransfer || null);
  const latestTransferDateSlice = String(
    latestRecordedTransfer?.receivedDate ||
    latestRecordedTransfer?.transfer_date ||
    latestMatchedTransfer?.receivedDate ||
    ''
  ).slice(0, 10);
  const latestTransferToCode =
    latestRecordedTransfer?.to_site_code ||
    latestRecordedTransfer?.toSiteCode ||
    latestMatchedTransfer?.to_site_code ||
    null;
  const hasNewerTransferOverride = Boolean(
    latestTransferToCode &&
    latestTransferDateSlice &&
    (!unitRecDate || latestTransferDateSlice >= unitRecDate) &&
    (!fixablyRecDate || latestTransferDateSlice >= fixablyRecDate)
  );

  // Determine Destination Site / Current Site
  const currentSiteId = preferFixably
    ? (fixablyUnit?.siteId || unit?.current_site_id || unit?.site_id || linkedShipment?.site_id)
    : (hasNewerTransferOverride ? null : (unit?.current_site_id || unit?.site_id || linkedShipment?.site_id || fixablyUnit?.siteId));
  const currentSiteCode = hasNewerTransferOverride
    ? latestTransferToCode
    : (preferFixably
        ? (fixablyUnit?.siteCode || unit?.site_code || linkedShipment?.site_code)
        : (unit?.site_code || linkedShipment?.site_code || fixablyUnit?.siteCode || latestMatchedTransfer?.to_site_code));

  let siteObj = (sites || []).find(s =>
    (currentSiteId && s.id === currentSiteId) ||
    (currentSiteCode && s.code?.toUpperCase().replace(/^(ASP|APP)\s+/, '') === String(currentSiteCode).toUpperCase().replace(/^(ASP|APP)\s+/, ''))
  );

  // If still not resolved, check usageRecord site
  if (!siteObj && usageRecord?.site_id) {
    siteObj = (sites || []).find(s => s.id === usageRecord.site_id || s.code === usageRecord.site_code);
  }

  const normSiteCodeUpper = String(siteObj?.code || currentSiteCode || '').toUpperCase().replace(/^(ASP|APP)\s+/, '').trim();
  const isDcSite = Boolean(
    (!fixablyUnit && !siteObj && (!normSiteCodeUpper || normSiteCodeUpper === 'DC' || normSiteCodeUpper === 'DC-MDC')) ||
    siteObj?.id === 'site-dc' ||
    siteObj?.code === 'DC-MDC' ||
    siteObj?.code === 'DC' ||
    siteObj?.is_dc === true ||
    normSiteCodeUpper === 'DC' ||
    normSiteCodeUpper === 'DC-MDC'
  );

  const siteName = (preferFixably && fixablyUnit?.siteName)
    ? fixablyUnit.siteName
    : (isDcSite ? 'DC Stocks' : (siteObj ? siteObj.name : (fixablyUnit?.siteName || (normSiteCodeUpper ? `MOBILECARE - ${normSiteCodeUpper}` : 'Branch Site'))));
  const siteCode = siteObj
    ? siteObj.code
    : (preferFixably && fixablyUnit?.siteCode ? fixablyUnit.siteCode : (isDcSite ? 'DC-MDC' : (currentSiteCode || 'BRANCH')));

  // 8. Determine Lifecycle Status
  // Priority order:
  // A. Used (in repair usage records or unit status is 'used')
  // B. In Transit (in an active shipment that is not received_confirmed)
  // C. Historical / Consumed Transfer (in Fixably Stock Transfer ledger but no longer in active on-hand snapshot)
  // D. In Stock at Branch (confirmed received at site or in Fixably site stock)
  // E. In Stock at DC (at central distribution center)
  const isHistoricalTransferOnly = Boolean(
    !unit &&
    !fixablyUnit &&
    !linkedShipment &&
    !usageRecord &&
    latestMatchedTransfer
  );

  const isUsed = Boolean(
    unit?.status === 'used' ||
    unit?.used_at ||
    usageRecord ||
    (isHistoricalTransferOnly && latestMatchedTransfer?.isAdjustment)
  );

  const isShippedInTransit = Boolean(
    !isUsed &&
    linkedShipment &&
    isShipmentActive(linkedShipment)
  );

  let statusKey;
  let statusBadgeLabel;
  let statusBadgeType;

  if (isUsed) {
    statusKey = 'used';
    statusBadgeLabel = `Used in Repair at ${siteName}`;
    statusBadgeType = 'used';
  } else if (isShippedInTransit) {
    statusKey = 'in_transit';
    statusBadgeLabel = `In Transit to ${siteName}`;
    statusBadgeType = 'transit';
  } else if (isHistoricalTransferOnly) {
    if (latestMatchedTransfer?.isReturnToDc || isDcSite) {
      statusKey = 'returned_dc';
      statusBadgeLabel = 'Returned to DC Stocks (Historical Transfer)';
      statusBadgeType = 'dc';
    } else {
      statusKey = 'transferred_historical';
      statusBadgeLabel = `${latestMatchedTransfer?.isSiteToSite ? 'Site-to-Site Transfer' : 'Transferred'} to ${siteName} (Historical / Consumed)`;
      statusBadgeType = 'site';
    }
  } else if (!isDcSite) {
    statusKey = 'in_stock_site';
    statusBadgeLabel = `In Stock at ${siteName}`;
    statusBadgeType = 'site';
  } else {
    statusKey = 'in_stock_dc';
    statusBadgeLabel = 'In Stock at DC Stocks';
    statusBadgeType = 'dc';
  }

  // 9. Recorded Site Arrival Date
  let siteArrivalDate = null;
  let siteArrivalFormatted = null;

  if (hasNewerTransferOverride && latestTransferDateSlice) {
    siteArrivalDate = latestTransferDateSlice;
  } else if (preferFixably && (fixablyUnit?.lastReceivedDate || fixablyUnit?.dateReceived)) {
    siteArrivalDate = fixablyUnit.lastReceivedDate || fixablyUnit.dateReceived;
  } else if (linkedShipment && isShipmentReceived(linkedShipment)) {
    siteArrivalDate = linkedShipment.received_date || linkedShipment.received_at;
  } else if (!isDcSite && (unit?.received_at || unit?.received_date)) {
    siteArrivalDate = unit.received_date || unit.received_at;
  } else if (fixablyUnit?.lastReceivedDate || fixablyUnit?.dateReceived) {
    siteArrivalDate = fixablyUnit.lastReceivedDate || fixablyUnit.dateReceived;
  } else if (latestMatchedTransfer?.receivedDate) {
    siteArrivalDate = latestMatchedTransfer.receivedDate;
  }

  if (siteArrivalDate) {
    try {
      const datePart = String(siteArrivalDate).includes('T')
        ? String(siteArrivalDate).split('T')[0]
        : String(siteArrivalDate).slice(0, 10);
      siteArrivalFormatted = datePart;
    } catch {
      siteArrivalFormatted = String(siteArrivalDate);
    }
  }

  // 10. Recorded Date Used
  let dateUsed = null;
  let dateUsedFormatted = null;
  let usedByName = null;
  let workOrderNumber = null;
  let usageNotes = null;

  if (isUsed) {
    dateUsed = usageRecord?.used_at || unit?.used_at || (isHistoricalTransferOnly ? latestTransferDateSlice : null);
    if (dateUsed) {
      try {
        const d = new Date(dateUsed);
        dateUsedFormatted = !isNaN(d.getTime())
          ? (String(dateUsed).length <= 10 ? String(dateUsed) : d.toISOString().replace('T', ' ').slice(0, 16))
          : String(dateUsed);
      } catch {
        dateUsedFormatted = String(dateUsed);
      }
    }
    usedByName = usageRecord?.used_by || usageRecord?.used_by_name || unit?.used_by_name || 'Branch Specialist';
    workOrderNumber = usageRecord?.work_order_number || unit?.work_order_number || (isHistoricalTransferOnly ? 'Repair / Stock Adjustment' : 'Internal Repair');
    usageNotes = usageRecord?.usage_notes || unit?.usage_notes || unit?.notes || '';
  }

  // 11. DC Scan-In / Intake Date
  const dcScanInDate = unit?.created_at || unit?.received_at || fixablyUnit?.previousReceivedDate || fixablyUnit?.lastReceivedDate || matchedTransfers[0]?.receivedDate || null;
  let dcScanInFormatted = null;
  if (dcScanInDate) {
    try {
      const d = new Date(dcScanInDate);
      dcScanInFormatted = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : String(dcScanInDate).slice(0, 10);
    } catch {
      dcScanInFormatted = null;
    }
  }

  const resolvedMovementHistory =
    (ownership.movementHistory?.length > (fixablyUnit?.movementHistory?.length || 0) &&
     ownership.movementHistory?.length >= (unit?.movement_history?.length || 0))
      ? ownership.movementHistory
      : (fixablyUnit?.movementHistory?.length >= (unit?.movement_history?.length || 0)
          ? fixablyUnit.movementHistory
          : (unit?.movement_history || ownership.movementHistory));
  const resolvedMovementTrail = Array.isArray(resolvedMovementHistory) && resolvedMovementHistory.length > 0
    ? resolvedMovementHistory.join(' → ')
    : ownership.movementTrail;
  const resolvedCurrentOwner =
    (ownership.transferCount > 0 ? ownership.currentOwner : null) ||
    (preferFixably ? fixablyUnit?.currentOwner : null) ||
    unit?.current_owner ||
    fixablyUnit?.currentOwner ||
    ownership.currentOwner;
  const resolvedTransferCount = Math.max(
    ownership.transferCount || 0,
    fixablyUnit?.transferCount || 0,
    unit?.transfer_count || 0,
    matchedTransfers.length
  );

  return {
    found: true,
    serialNumber: cleanSerial,
    serial_number: cleanSerial,
    partNumber,
    part_number: partNumber,
    description: partDescription,
    iphoneModel,
    iphone_model: iphoneModel,
    categoryId,
    category_id: categoryId,
    stockingPrice,
    stocking_price: stockingPrice,
    // Stock Ownership & Movement History
    currentOwner: resolvedCurrentOwner,
    current_owner: resolvedCurrentOwner,
    movementHistory: resolvedMovementHistory,
    movement_history: resolvedMovementHistory,
    movementTrail: resolvedMovementTrail,
    movement_trail: resolvedMovementTrail,
    transferCount: resolvedTransferCount,
    transfer_count: resolvedTransferCount,
    latestTransferDate: ownership.latestTransferDate || fixablyUnit?.latestTransfer?.receivedDate || latestMatchedTransfer?.receivedDate || null,
    latest_transfer_date: ownership.latestTransferDate || fixablyUnit?.latestTransfer?.receivedDate || latestMatchedTransfer?.receivedDate || null,
    latestTransferFormatted: ownership.latestTransferFormatted !== 'No recorded transfers'
      ? ownership.latestTransferFormatted
      : (fixablyUnit?.latestTransfer
          ? `${fixablyUnit.latestTransfer.fromSiteCode} → ${fixablyUnit.latestTransfer.toSiteCode} (${fixablyUnit.latestTransfer.receivedDate})`
          : (latestMatchedTransfer
              ? `${latestMatchedTransfer.from_site_code} → ${latestMatchedTransfer.to_site_code} (${latestMatchedTransfer.receivedDate})`
              : ownership.latestTransferFormatted)),
    latestTransferType: latestMatchedTransfer?.transfer_type || fixablyUnit?.latestTransfer?.transferType || null,
    isHistoricalTransfer: isHistoricalTransferOnly,
    transfers: ownership.transfers?.length > 0 ? ownership.transfers : matchedTransfers,
    transfer_history: ownership.transfers?.length > 0 ? ownership.transfers : matchedTransfers,
    // Fixably specifics
    agingDays: fixablyUnit?.agingDays ?? null,
    agingBracket: fixablyUnit?.agingBracket ?? null,
    stockType: fixablyUnit?.stockType || unit?.stock_type || (isDcSite ? 'DC Stock' : 'MSPI-Owned'),
    isInvestigation: Boolean(fixablyUnit?.isInvestigation),
    // Location & Stock State
    status: unit?.status || (isUsed ? 'used' : isShippedInTransit ? 'shipped' : isHistoricalTransferOnly ? 'historical_transfer' : 'in_stock'),
    statusKey,
    statusBadgeLabel,
    statusBadgeType,
    isDcSite,
    siteId: siteObj?.id || currentSiteId,
    current_site_id: siteObj?.id || currentSiteId,
    siteCode,
    site_code: siteCode,
    siteName,
    site_name: siteName,
    siteRegion: fixablyUnit?.region || siteObj?.region || (siteObj?.province ? 'Provincial' : 'Metro Manila'),
    // Usage Details
    isUsed,
    is_used: isUsed,
    dateUsed,
    used_at: dateUsed,
    dateUsedFormatted,
    formatted_used_date: dateUsedFormatted,
    usedByName,
    technician_name: usedByName,
    workOrderNumber,
    work_order_number: workOrderNumber,
    usageNotes,
    // Site Arrival Details
    siteArrivalDate,
    site_arrival_date: siteArrivalDate,
    siteArrivalFormatted,
    formatted_arrival_date: siteArrivalFormatted,
    siteArrivalStatus: siteArrivalFormatted
      ? `Arrived on ${siteArrivalFormatted}`
      : isShippedInTransit
      ? `Pending Site Arrival (Dispatched: ${linkedShipment?.shipment_date || 'In Transit'})`
      : isDcSite
      ? `DC Stock (${dcScanInFormatted || 'Active'})`
      : 'Recorded at Site',
    // DC Inbound Intake Details
    dcScanInDate,
    received_at: unit?.received_at || dcScanInDate,
    received_by: unit?.received_by || 'Warehouse Staff',
    dcScanInFormatted,
    boxNumber: unit?.box_number || shipmentItem?.box_number || 1,
    box_number: unit?.box_number || shipmentItem?.box_number || 1,
    po_number: unit?.po_number || null,
    allocated_at: unit?.allocated_at || null,
    shipped_at: unit?.shipped_at || linkedShipment?.shipment_date || null,
    intakeAssignment: unit?.intake_assignment || (unit?.notes?.includes('SVNR') ? 'SVNR - Service Non-Repair' : 'MDC - Forecasting'),
    // Linked Outbound Shipment Manifest Details
    linkedShipment: linkedShipment ? {
      id: linkedShipment.id,
      shipmentNumber: linkedShipment.shipment_number,
      invoiceRef: linkedShipment.invoice_ref || linkedShipment.shipment_number,
      status: linkedShipment.status,
      shipmentDate: linkedShipment.shipment_date,
      receivedDate: linkedShipment.received_date,
      receivedAt: linkedShipment.received_at,
      receivedByName: linkedShipment.received_by_name,
      courierName: linkedShipment.courier_name,
      trackingNumber: linkedShipment.tracking_number,
      riderName: linkedShipment.rider_name
    } : null,
    // Raw source reference
    rawUnit: unit || fixablyUnit || latestMatchedTransfer || null
  };
}

/**
 * Searches across all inventory units, shipments, usage records, branch site stock,
 * and stock transfer records for serials matching a query.
 *
 * @param {string} query
 * @param {Object} datasets
 * @param {number} maxResults
 * @returns {Array<Object>} List of resolved serial dossier records
 */
export function searchSerialsWithFullDetails(query, {
  inventoryUnits = [],
  shipments = [],
  repairUsageRecords = [],
  sites = [],
  parts = [],
  fixablyItems = [],
  fixablyTransfers = []
} = {}, maxResults = 5) {
  if (!query || !query.trim()) return [];

  const cleanQuery = cleanSerialNumberInput(query);
  if (!cleanQuery || cleanQuery.length < 3) return [];

  const {
    effectiveFixablyItems,
    effectiveFixablyTransfers,
    localHistory
  } = resolveEffectiveFixablySources(fixablyItems, fixablyTransfers);

  const matchedSerialsSet = new Set();

  // 1. Match from inventoryUnits
  (inventoryUnits || []).forEach(u => {
    const s = cleanSerialNumberInput(u.serial_number);
    if (s && s.includes(cleanQuery)) {
      matchedSerialsSet.add(s);
    }
  });

  // 2. Match from shipments
  (shipments || []).forEach(sh => {
    (sh.items || []).forEach(it => {
      const s = cleanSerialNumberInput(it.serial_number || it.serialNumber);
      if (s && s.includes(cleanQuery)) {
        matchedSerialsSet.add(s);
      }
    });
  });

  // 3. Match from repairUsageRecords
  (repairUsageRecords || []).forEach(r => {
    const s = cleanSerialNumberInput(r.serial_number);
    if (s && s.includes(cleanQuery)) {
      matchedSerialsSet.add(s);
    }
  });

  // 4. Match from fixablyItems (Branch stock snapshot)
  (effectiveFixablyItems || []).forEach(f => {
    const s = cleanSerialNumberInput(f.serialNumber || f.serial_number);
    if (s && s.includes(cleanQuery)) {
      matchedSerialsSet.add(s);
    }
  });

  // 5. Match from fixablyTransfers (Stock Transfer CSV/XLSX ledger)
  (effectiveFixablyTransfers || []).forEach(tr => {
    const s = cleanSerialNumberInput(tr.serialNumber || tr.serial_number);
    if (s && s.includes(cleanQuery)) {
      matchedSerialsSet.add(s);
    }
  });

  // 6. Match from localTransferHistory (Part Transfer History Registry)
  (localHistory || []).forEach(h => {
    const s = cleanSerialNumberInput(h.serial_number || h.serialNumber);
    if (s && s.includes(cleanQuery)) {
      matchedSerialsSet.add(s);
    }
  });

  const serialsList = Array.from(matchedSerialsSet);

  // Sort exact matches first, then prefix matches, then substring matches
  serialsList.sort((a, b) => {
    if (a === cleanQuery) return -1;
    if (b === cleanQuery) return 1;
    if (a.startsWith(cleanQuery) && !b.startsWith(cleanQuery)) return -1;
    if (!a.startsWith(cleanQuery) && b.startsWith(cleanQuery)) return 1;
    return a.localeCompare(b);
  });

  return serialsList.slice(0, maxResults).map(s =>
    resolveSerialFullDetails(s, {
      inventoryUnits,
      shipments,
      repairUsageRecords,
      sites,
      parts,
      fixablyItems: effectiveFixablyItems,
      fixablyTransfers: effectiveFixablyTransfers
    })
  ).filter(Boolean);
}
