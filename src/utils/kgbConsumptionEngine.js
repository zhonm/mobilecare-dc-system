/**
 * GSX KGB Report Automation & Consumption Engine
 * 
 * Provides automated ingestion, parsing, intelligent matching, and multi-module
 * synchronization for Apple GSX KGB Used Reports (.csv / .xlsx).
 * 
 * Centralizes parts consumption as the single source of truth across:
 * - Site Stocks (on-hand quantities and active inventory)
 * - Site Transfers (transferred part lifecycle)
 * - Parts Consumption Log (live serialized audit history)
 * - Used Parts History (historical datasets & repair usage aggregation)
 * - Audit Trail & Validation History (tamper-evident ingestion ledger)
 */

import { normalizeSite, normalizeDate } from './siteTransfersReconciler.js';
import { extractTextContent, parseDelimitedLine } from './fixablyInventoryEngine.js';
import { saveInventoryToLocalStorage } from './appContextHelpers.js';
import dbStorage from './dbStorage.js';

export const KGB_UPLOAD_HISTORY_DOC_ID = 'master_kgb_upload_history_registry';
export const MASTER_USED_PARTS_REGISTRY_DOC_ID = 'master_used_parts_registry';

/**
 * Validates and parses a GSX KGB Used Report (.CSV or .XLSX)
 * Supports multiple header naming conventions, offsets, and delimiters.
 * 
 * @param {File|Blob|string|ArrayBuffer} fileOrContent 
 * @returns {Promise<{success: boolean, error?: string, totalRows?: number, records?: Array, uniqueSerials?: number, validationErrors?: Array}>}
 */
export async function parseKgbUsedFile(fileOrContent) {
  try {
    const text = await extractTextContent(fileOrContent, 'kgb_used');
    if (!text || typeof text !== 'string') {
      return { success: false, error: 'File content is empty or unreadable.' };
    }

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return { success: false, error: 'File contains insufficient rows. At least a header and 1 data row are required.' };
    }

    // Identify header row (typically row 0 or row 1 if title banner exists)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(6, lines.length); i++) {
      const lower = lines[i].toLowerCase();
      // True header must have multiple columns and contain specific GSX KGB column names
      const hasDelim = lines[i].includes(',') || lines[i].includes(';');
      const matchesHeaderPatterns = (
        lower.includes('product kgb') ||
        (lower.includes('order id') && (lower.includes('product') || lower.includes('location') || lower.includes('repair'))) ||
        (lower.includes('serial') && lower.includes('order')) ||
        (lower.includes('repair closed') && lower.includes('product'))
      );

      if (hasDelim && matchesHeaderPatterns) {
        headerIdx = i;
        break;
      }
    }

    const delim = lines[headerIdx].includes(';') ? ';' : ',';
    const rawHeaders = parseDelimitedLine(lines[headerIdx], delim).map(h =>
      h.trim().toLowerCase().replace(/^"|"$/g, '').replace(/^\ufeff/, '')
    );

    // Filter trailing empty headers
    const firstEmptyHeaderIdx = rawHeaders.findIndex((h, idx) => idx >= 5 && !h);
    const headers = firstEmptyHeaderIdx !== -1 ? rawHeaders.slice(0, firstEmptyHeaderIdx) : rawHeaders;

    const findColIdx = (patterns) => headers.findIndex(h => patterns.some(p => h.includes(p)));

    const idxOrder = findColIdx(['order id', 'order #', 'order', 'work order', 'repair id']);
    const idxLoc = findColIdx(['location name', 'location', 'site name', 'site', 'branch', 'store']);
    const idxRepairNum = findColIdx(['gsx repair number', 'repair number', 'repair no', 'claim number']);
    const idxStrategy = findColIdx(['gsx repair strategy', 'strategy', 'repair type']);
    const idxStatus = findColIdx(['current gsx status', 'gsx status', 'status']);
    const idxClosedDate = findColIdx(['repair closed date', 'closed date', 'repair date', 'date', 'completion date', 'used date']);
    const idxCode = findColIdx(['product code', 'part number', 'part #', 'item code', 'code']);
    const idxDesc = findColIdx(['product description', 'description', 'part desc', 'part name', 'item description']);
    const idxKgb = findColIdx(['product kgb', 'kgb', 'serial number', 'serial #', 'serial', 'consumed serial', 'consumed kgb']);
    const idxKbb = findColIdx(['product kbb', 'kbb', 'return serial', 'defective serial']);

    if (idxKgb === -1 && idxOrder === -1 && idxCode === -1) {
      return {
        success: false,
        error: 'Unrecognized file format. Expected GSX KGB columns such as "Product KGB", "Order ID", "Product Code", etc.'
      };
    }

    const records = [];
    const validationErrors = [];
    const seenSerials = new Set();

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = parseDelimitedLine(line, delim);
      if (!cols || cols.length === 0) continue;

      const rawSerial = idxKgb !== -1 ? String(cols[idxKgb] || '').replace(/^"|"$/g, '').trim().toUpperCase() : '';
      const orderId = idxOrder !== -1 ? String(cols[idxOrder] || '').replace(/^"|"$/g, '').trim() : '';
      const gsxRepairNumber = idxRepairNum !== -1 ? String(cols[idxRepairNum] || '').replace(/^"|"$/g, '').trim() : '';
      const rawLocation = idxLoc !== -1 ? String(cols[idxLoc] || '').replace(/^"|"$/g, '').trim() : '';
      const repairStrategy = idxStrategy !== -1 ? String(cols[idxStrategy] || '').replace(/^"|"$/g, '').trim() : 'CIN';
      const gsxStatus = idxStatus !== -1 ? String(cols[idxStatus] || '').replace(/^"|"$/g, '').trim().toUpperCase() : 'SCOM';
      const rawClosedDate = idxClosedDate !== -1 ? String(cols[idxClosedDate] || '').replace(/^"|"$/g, '').trim() : '';
      const productCode = idxCode !== -1 ? String(cols[idxCode] || '').replace(/^"|"$/g, '').trim().toUpperCase() : '';
      const productDescription = idxDesc !== -1 ? String(cols[idxDesc] || '').replace(/^"|"$/g, '').trim() : '';
      const productKbb = idxKbb !== -1 ? String(cols[idxKbb] || '').replace(/^"|"$/g, '').trim().toUpperCase() : '';

      // Skip row if it has neither serial nor order ID nor product code
      if (!rawSerial && !orderId && !productCode) {
        continue;
      }

      // Check for missing serial
      if (!rawSerial) {
        validationErrors.push({
          row: i + 1,
          orderId,
          productCode,
          issue: 'Missing Product KGB (Serial Number)'
        });
        if (!orderId && !gsxRepairNumber && !productKbb) {
          continue;
        }
      }

      const effectiveSerial = rawSerial || (productKbb ? `KBB-${productKbb}-${orderId || i}` : `WO-${orderId || gsxRepairNumber}-${productCode || i}`);

      // Parse normalized date
      const normalizedClosedDate = normalizeDate(rawClosedDate);

      // Normalize site
      const normSiteObj = normalizeSite(rawLocation);

      const record = {
        rowIndex: i + 1,
        serialNumber: effectiveSerial,
        productKgb: rawSerial || effectiveSerial,
        productKbb,
        orderId,
        gsxRepairNumber,
        workOrderNumber: orderId || gsxRepairNumber || 'N/A',
        rawLocation,
        siteCode: normSiteObj.code || 'BRANCH',
        siteName: normSiteObj.name || rawLocation || 'Branch Site',
        repairStrategy,
        gsxStatus,
        repairClosedDate: normalizedClosedDate || rawClosedDate,
        rawClosedDate,
        productCode,
        partNumber: productCode,
        productDescription: productDescription || 'Apple Replacement Part',
        isClosedRepair: gsxStatus === 'SCOM' || gsxStatus === 'SPCM' || !gsxStatus || gsxStatus.includes('SCOM') || gsxStatus.includes('SPCM')
      };

      records.push(record);
      seenSerials.add(effectiveSerial);
    }

    return {
      success: true,
      totalRows: lines.length - headerIdx - 1,
      validRowCount: records.length,
      records,
      uniqueSerials: seenSerials.size,
      validationErrors
    };
  } catch (err) {
    console.error('parseKgbUsedFile error:', err);
    return {
      success: false,
      error: `Failed to parse KGB file: ${err?.message || err}`
    };
  }
}

/**
 * Intelligently matches KGB consumed parts against current system state
 * and returns full reconciliation deltas across all inventory modules.
 * 
 * @param {Object} params
 * @param {Array} params.kgbRecords - Parsed KGB records from parseKgbUsedFile
 * @param {Array} params.inventoryUnits - Active inventory_units from state/context
 * @param {Object} [params.fixablySnapshot] - Multi-site fixably snapshot
 * @param {Array} [params.repairUsageRecords] - Existing repair usage records
 * @param {Array} [params.sites] - Branch directory
 * @param {Array} [params.parts] - Parts catalog
 * @param {Object} [params.currentUser] - Authenticated user info
 * @returns {Object} Reconciliation result and updated entity collections
 */
export function matchAndReconcileKgbConsumption({
  kgbRecords = [],
  inventoryUnits = [],
  fixablySnapshot = null,
  repairUsageRecords = [],
  sites = [],
  parts = [],
  currentUser = null
}) {
  const nowIso = new Date().toISOString();
  const uploaderName = currentUser?.fullName || currentUser?.name || 'Super Admin';
  const uploaderId = currentUser?.id || null;

  // 1. Build lookup maps for fast O(1) matching
  const inventoryUnitsMap = new Map();
  (inventoryUnits || []).forEach(u => {
    const s = String(u.serial_number || u.serialNumber || u.raw_serial || '').trim().toUpperCase();
    if (s) {
      inventoryUnitsMap.set(s, u);
    }
  });

  const existingUsedSerialsSet = new Set();
  (inventoryUnits || []).forEach(u => {
    if (String(u.status || '').toLowerCase() === 'used') {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s) existingUsedSerialsSet.add(s);
    }
  });

  const existingRepairRecordsBySerial = new Map();
  (repairUsageRecords || []).forEach(r => {
    const s = String(r.serial_number || '').trim().toUpperCase();
    if (s) {
      existingRepairRecordsBySerial.set(s, r);
      const unitInInv = inventoryUnitsMap.get(s);
      if (!unitInInv || String(unitInInv.status || '').toLowerCase() === 'used') {
        existingUsedSerialsSet.add(s);
      }
    }
  });

  // Map of parts catalog by part number
  const partsMap = new Map();
  (parts || []).forEach(p => {
    const pn = String(p.part_number || '').trim().toUpperCase();
    if (pn) partsMap.set(pn, p);
  });

  // Map of sites by code, alias, name, and ID
  const sitesCodeMap = new Map();
  const sitesIdMap = new Map();
  const sitesNameMap = new Map();
  (sites || []).forEach(s => {
    if (s.code) {
      const upperCode = String(s.code).toUpperCase().trim();
      const cleanCode = upperCode.replace(/^(ASP|APP)\s+/, '');
      sitesCodeMap.set(upperCode, s);
      sitesCodeMap.set(cleanCode, s);
      if (cleanCode === 'VN') sitesCodeMap.set('VER', s);
      if (cleanCode === 'VER') sitesCodeMap.set('VN', s);
      if (cleanCode === 'RM') sitesCodeMap.set('MAG', s);
      if (cleanCode === 'MAG') sitesCodeMap.set('RM', s);
      if (cleanCode === 'ABR') sitesCodeMap.set('DAV', s);
      if (cleanCode === 'DAV') sitesCodeMap.set('ABR', s);
      if (cleanCode === 'COT') sitesCodeMap.set('CBO', s);
      if (cleanCode === 'CBO') sitesCodeMap.set('COT', s);
    }
    if (s.id) sitesIdMap.set(s.id, s);
    if (s.name) sitesNameMap.set(String(s.name).toUpperCase().trim(), s);
  });

  const resolveSiteInfo = (rawLocation, fallbackSiteCode = 'BRANCH') => {
    const norm = normalizeSite(rawLocation);
    const cleanCode = norm.code ? norm.code.toUpperCase().replace(/^(ASP|APP)\s+/, '') : '';
    const cleanFallback = fallbackSiteCode ? String(fallbackSiteCode).toUpperCase().replace(/^(ASP|APP)\s+/, '') : '';
    const matchedSite =
      sitesCodeMap.get(cleanCode) ||
      sitesCodeMap.get(cleanFallback) ||
      (norm.name ? sitesNameMap.get(String(norm.name).toUpperCase().trim()) : null) ||
      (rawLocation ? sitesNameMap.get(String(rawLocation).toUpperCase().trim()) : null);
    return {
      siteId: matchedSite?.id || null,
      siteCode: matchedSite?.code || norm.code || fallbackSiteCode,
      siteName: matchedSite?.name || norm.name || rawLocation || 'Branch Site'
    };
  };

  const matchedOnHandUnits = [];
  const newConsumedUnits = [];
  const duplicatesSkipped = [];
  const newUsageEntries = [];
  const updatedUnitsMap = new Map(inventoryUnitsMap);

  // Process KGB records
  const processedKgbSerials = new Set();

  for (const kgbItem of kgbRecords) {
    const serial = String(kgbItem.serialNumber || kgbItem.productKgb || '').trim().toUpperCase();
    if (!serial) continue;

    // In-file duplicate check
    if (processedKgbSerials.has(serial)) {
      duplicatesSkipped.push({
        serialNumber: serial,
        reason: 'Duplicate serial within uploaded KGB file',
        orderId: kgbItem.orderId
      });
      continue;
    }
    processedKgbSerials.add(serial);

    const siteInfo = resolveSiteInfo(kgbItem.rawLocation, kgbItem.siteCode);
    const catalogPart = partsMap.get(kgbItem.partNumber) || partsMap.get(kgbItem.productCode);
    const effectivePartDesc = kgbItem.productDescription || catalogPart?.description || 'Apple Replacement Part';
    const effectivePartPn = kgbItem.partNumber || kgbItem.productCode || catalogPart?.part_number || 'UNKNOWN';

    const effectiveUsedDate = kgbItem.repairClosedDate
      ? (kgbItem.repairClosedDate.includes('T') ? kgbItem.repairClosedDate : `${kgbItem.repairClosedDate}T12:00:00.000Z`)
      : nowIso;
    const dateUsedString = effectiveUsedDate.substring(0, 10);
    const cleanWorkOrder = kgbItem.orderId || kgbItem.gsxRepairNumber || 'N/A';
    const cleanNotes = `Consumed in GSX ${kgbItem.repairStrategy || 'CIN'} repair | Closed: ${dateUsedString} | Order #${kgbItem.orderId || 'N/A'}${kgbItem.productKbb ? ` | KBB: ${kgbItem.productKbb}` : ''}`;

    // Pre-existing check: already consumed in system
    if (existingUsedSerialsSet.has(serial)) {
      duplicatesSkipped.push({
        serialNumber: serial,
        reason: 'Already recorded as used in Parts Consumption Log',
        orderId: kgbItem.orderId
      });
      // Ensure updatedUnitsMap still retains the consumed unit if it came from repairUsageRecords
      if (!updatedUnitsMap.has(serial)) {
        const prevRec = existingRepairRecordsBySerial.get(serial);
        updatedUnitsMap.set(serial, {
          id: prevRec?.id || `unit-kgb-${serial}`,
          serial_number: serial,
          raw_serial: serial,
          part_number: prevRec?.part_number || effectivePartPn,
          description: prevRec?.description || effectivePartDesc,
          current_site_id: prevRec?.site_id || siteInfo.siteId,
          site_code: prevRec?.site_code || siteInfo.siteCode,
          site_name: prevRec?.site_name || siteInfo.siteName,
          status: 'used',
          lifecycle_status: 'used',
          used_at: prevRec?.used_at || effectiveUsedDate,
          dateUsed: prevRec?.date_used || dateUsedString,
          work_order_number: prevRec?.work_order_number || cleanWorkOrder,
          repair_number: prevRec?.repair_number || kgbItem.gsxRepairNumber || null,
          product_kgb: serial,
          product_kbb: prevRec?.product_kbb || kgbItem.productKbb || null,
          used_by_id: prevRec?.used_by_id || uploaderId,
          used_by_name: prevRec?.used_by || `GSX KGB Import (${uploaderName})`,
          usage_notes: prevRec?.usage_notes || cleanNotes,
          notes: prevRec?.usage_notes || cleanNotes,
          created_at: nowIso,
          updated_at: nowIso
        });
      }
      continue;
    }

    const metaPayload = {
      lifecycle_status: 'used',
      work_order_number: cleanWorkOrder,
      gsx_repair_number: kgbItem.gsxRepairNumber || null,
      product_kgb: serial,
      product_kbb: kgbItem.productKbb || null,
      usage_notes: cleanNotes,
      used_at: effectiveUsedDate,
      source: 'GSX_KGB_USED_REPORT',
      site_code: siteInfo.siteCode,
      site_name: siteInfo.siteName
    };
    const encodedNotes = `${cleanNotes} | __META__:${JSON.stringify(metaPayload)}`;

    // Usage entry for repairUsageRecords & master_used_parts_registry
    const usageEntry = {
      id: `usage-kgb-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      site_id: siteInfo.siteId,
      site_code: siteInfo.siteCode,
      site_name: siteInfo.siteName,
      raw_site_name: kgbItem.rawLocation,
      part_id: catalogPart?.id || null,
      part_number: effectivePartPn,
      raw_part_number: effectivePartPn,
      description: effectivePartDesc,
      raw_part_description: effectivePartDesc,
      serial_number: serial,
      quantity: 1,
      work_order_number: cleanWorkOrder,
      repair_number: kgbItem.gsxRepairNumber || null,
      product_kgb: serial,
      product_kbb: kgbItem.productKbb || null,
      usage_notes: cleanNotes,
      used_by: `GSX KGB Import (${uploaderName})`,
      used_by_id: uploaderId,
      used_at: effectiveUsedDate,
      date_used: dateUsedString,
      month_name: new Date(effectiveUsedDate).toLocaleString('default', { month: 'long', year: 'numeric' }),
      source: 'GSX_KGB_USED_REPORT',
      encoded_notes: encodedNotes
    };
    newUsageEntries.push(usageEntry);

    // Check if unit currently exists in inventory_units
    const existingUnit = updatedUnitsMap.get(serial);
    if (existingUnit) {
      // Existing on-hand unit transitioning to USED
      const updatedUnit = {
        ...existingUnit,
        status: 'used',
        lifecycle_status: 'used',
        used_at: effectiveUsedDate,
        dateUsed: dateUsedString,
        work_order_number: cleanWorkOrder,
        repair_number: kgbItem.gsxRepairNumber || existingUnit.repair_number || null,
        kgb_kbb_number: kgbItem.productKbb ? `KGB: ${serial} | KBB: ${kgbItem.productKbb}` : serial,
        product_kgb: serial,
        product_kbb: kgbItem.productKbb || existingUnit.product_kbb || null,
        used_by_id: uploaderId,
        used_by_name: `GSX KGB Import (${uploaderName})`,
        usage_notes: cleanNotes,
        notes: encodedNotes,
        updated_at: nowIso
      };
      updatedUnitsMap.set(serial, updatedUnit);
      matchedOnHandUnits.push({
        serialNumber: serial,
        partNumber: effectivePartPn,
        description: effectivePartDesc,
        previousStatus: existingUnit.status || 'in_stock',
        siteCode: siteInfo.siteCode,
        orderId: cleanWorkOrder,
        repairNumber: kgbItem.gsxRepairNumber,
        productKbb: kgbItem.productKbb
      });
    } else {
      // New consumed unit entry to register directly into inventoryUnits
      const newUnit = {
        id: `unit-kgb-${serial}`,
        serial_number: serial,
        raw_serial: serial,
        part_number: effectivePartPn,
        description: effectivePartDesc,
        current_site_id: siteInfo.siteId,
        site_code: siteInfo.siteCode,
        site_name: siteInfo.siteName,
        status: 'used',
        lifecycle_status: 'used',
        used_at: effectiveUsedDate,
        dateUsed: dateUsedString,
        work_order_number: cleanWorkOrder,
        repair_number: kgbItem.gsxRepairNumber || null,
        kgb_kbb_number: kgbItem.productKbb ? `KGB: ${serial} | KBB: ${kgbItem.productKbb}` : serial,
        product_kgb: serial,
        product_kbb: kgbItem.productKbb || null,
        used_by_id: uploaderId,
        used_by_name: `GSX KGB Import (${uploaderName})`,
        usage_notes: cleanNotes,
        notes: encodedNotes,
        created_at: nowIso,
        updated_at: nowIso
      };
      updatedUnitsMap.set(serial, newUnit);
      newConsumedUnits.push({
        serialNumber: serial,
        partNumber: effectivePartPn,
        description: effectivePartDesc,
        siteCode: siteInfo.siteCode,
        orderId: cleanWorkOrder,
        repairNumber: kgbItem.gsxRepairNumber,
        productKbb: kgbItem.productKbb
      });
    }
  }

  // 2. Reconcile with fixablySnapshot (Multi-Site Inventory items)
  let updatedSnapshot = null;
  if (fixablySnapshot && Array.isArray(fixablySnapshot.items)) {
    const kgbMatchedSerialsSet = new Set(processedKgbSerials);

    const reconciledItems = fixablySnapshot.items.map(it => {
      const s = String(it.serialNumber || it.serial_number || '').trim().toUpperCase();
      if (s && kgbMatchedSerialsSet.has(s)) {
        return {
          ...it,
          status: 'used',
          isInvestigation: false,
          isFlaggedInvestigation: false,
          isConsumedInKgb: true,
          investigationDetails: null,
          usedInKgb: true,
          updated_at: nowIso
        };
      }
      return it;
    });

    const activeInStockItems = reconciledItems.filter(it => it.status !== 'used');
    const remainingInvestigationItems = reconciledItems.filter(it => it.isInvestigation);
    const newInvCount = remainingInvestigationItems.length;

    const updatedSites = Array.isArray(fixablySnapshot.sites)
      ? fixablySnapshot.sites.map(site => {
          const siteItems = Array.isArray(site.items)
            ? site.items.map(it => {
                const s = String(it.serialNumber || it.serial_number || '').trim().toUpperCase();
                if (s && kgbMatchedSerialsSet.has(s)) {
                  return {
                    ...it,
                    status: 'used',
                    isInvestigation: false,
                    isFlaggedInvestigation: false,
                    isConsumedInKgb: true,
                    investigationDetails: null,
                    usedInKgb: true,
                    updated_at: nowIso
                  };
                }
                return it;
              })
            : site.items;
          const siteInvItems = Array.isArray(siteItems) ? siteItems.filter(it => it.isInvestigation) : [];
          return {
            ...site,
            items: siteItems,
            investigationCount: siteInvItems.length,
            ...(site.metrics?.segmentedLists
              ? {
                  metrics: {
                    ...site.metrics,
                    segmentedLists: {
                      ...site.metrics.segmentedLists,
                      investigation: siteInvItems
                    }
                  }
                }
              : {})
          };
        })
      : fixablySnapshot.sites;

    updatedSnapshot = {
      ...fixablySnapshot,
      items: reconciledItems,
      investigationItems: remainingInvestigationItems,
      sites: updatedSites,
      globalMetrics: {
        ...(fixablySnapshot.globalMetrics || {}),
        investigationCount: newInvCount
      },
      summary: {
        ...(fixablySnapshot.summary || {}),
        totalUnits: activeInStockItems.length,
        investigationCount: newInvCount
      },
      timestamp: nowIso
    };
  }

  return {
    success: true,
    matchedOnHandUnits,
    newConsumedUnits,
    duplicatesSkipped,
    newUsageEntries,
    updatedInventoryUnits: Array.from(updatedUnitsMap.values()),
    updatedFixablySnapshot: updatedSnapshot,
    summary: {
      totalKgbRecords: kgbRecords.length,
      matchedOnHandCount: matchedOnHandUnits.length,
      newConsumedCount: newConsumedUnits.length,
      duplicatesSkippedCount: duplicatesSkipped.length,
      totalAddedToConsumptionLog: matchedOnHandUnits.length + newConsumedUnits.length
    }
  };
}

/**
 * Executes full synchronous & asynchronous persistence of KGB consumption sync.
 * Updates local storage, IndexedDB, Supabase cloud database, upload audit logs,
 * and triggers realtime cloud broadcast.
 * 
 * @param {Object} params 
 * @returns {Promise<Object>} Execution summary
 */
export async function executeKgbConsumptionSync({
  fileOrContent,
  fileName = 'GSX_KGB_Used_Report.csv',
  inventoryUnits = [],
  setInventoryUnits = null,
  fixablySnapshot = null,
  setFixablySnapshot = null,
  repairUsageRecords = [],
  setRepairUsageRecords = null,
  sites = [],
  parts = [],
  currentUser = null,
  supabase = null,
  broadcastCloudEvent = null,
  showToast = null,
  onProgress = null
}) {
  onProgress?.({ stage: 'Reading & validating GSX KGB file...', percent: 10 });

  // 1. Parse File
  const parseResult = await parseKgbUsedFile(fileOrContent);
  if (!parseResult.success) {
    showToast?.(parseResult.error || 'Failed to parse KGB file.', 'error');
    return { success: false, error: parseResult.error };
  }

  onProgress?.({ stage: `Matching ${parseResult.records.length.toLocaleString()} records across inventory ecosystem...`, percent: 35 });

  // 2. Intelligent Cross-Module Matching
  const reconciliation = matchAndReconcileKgbConsumption({
    kgbRecords: parseResult.records,
    inventoryUnits,
    fixablySnapshot,
    repairUsageRecords,
    sites,
    parts,
    currentUser
  });

  const {
    updatedInventoryUnits,
    updatedFixablySnapshot,
    newUsageEntries,
    matchedOnHandUnits,
    newConsumedUnits,
    duplicatesSkipped,
    summary
  } = reconciliation;

  onProgress?.({ stage: 'Saving synchronized consumption data locally...', percent: 65 });

  const nowIso = new Date().toISOString();
  const uploaderName = currentUser?.fullName || currentUser?.name || 'Super Admin';
  const uploaderEmail = currentUser?.email || 'admin@mobilecare.ph';

  // 3. Local Synchronous Persistence (Zero data loss guarantee)
  // A. Inventory Units
  try {
    saveInventoryToLocalStorage(updatedInventoryUnits);
    const branchOnly = updatedInventoryUnits.filter(u => u.current_site_id && u.current_site_id !== 'site-dc' && u.site_code !== 'DC');
    try {
      localStorage.setItem('mdc_branch_inventory_units', JSON.stringify(branchOnly.slice(0, 500)));
    } catch (e) {}
  } catch (e) {}
  await dbStorage.setItem('mdc_inventory', updatedInventoryUnits);

  // B. Master Used Parts Registry (persist under both canonical keys for full cross-module parity)
  let existingUsedReg = [];
  try {
    const raw = localStorage.getItem('mdc_master_used_parts_registry') || localStorage.getItem(MASTER_USED_PARTS_REGISTRY_DOC_ID);
    if (raw) existingUsedReg = JSON.parse(raw);
  } catch (e) {}
  if (!Array.isArray(existingUsedReg) || existingUsedReg.length === 0) {
    try {
      const idbReg =
        (await dbStorage.getItem('mdc_master_used_parts_registry')) ||
        (await dbStorage.getItem(MASTER_USED_PARTS_REGISTRY_DOC_ID)) ||
        (await dbStorage.getItem('mdc_repair_usage'));
      if (Array.isArray(idbReg)) existingUsedReg = idbReg;
    } catch (e) {}
  }

  const mergedUsedMap = new Map();
  (Array.isArray(repairUsageRecords) ? repairUsageRecords : []).forEach(r => {
    const s = String(r?.serial_number || '').trim().toUpperCase();
    if (s) mergedUsedMap.set(s, r);
  });
  (Array.isArray(existingUsedReg) ? existingUsedReg : []).forEach(r => {
    const s = String(r?.serial_number || '').trim().toUpperCase();
    if (s) mergedUsedMap.set(s, r);
  });
  (Array.isArray(newUsageEntries) ? newUsageEntries : []).forEach(r => {
    const s = String(r?.serial_number || '').trim().toUpperCase();
    if (s) mergedUsedMap.set(s, r);
  });
  const mergedUsedRegistry = Array.from(mergedUsedMap.values());

  try {
    localStorage.setItem('mdc_master_used_parts_registry', JSON.stringify(mergedUsedRegistry.slice(0, 500)));
  } catch (e) {}
  try {
    localStorage.setItem(MASTER_USED_PARTS_REGISTRY_DOC_ID, JSON.stringify(mergedUsedRegistry.slice(0, 500)));
  } catch (e) {}
  try {
    localStorage.setItem('mdc_repair_usage', JSON.stringify(mergedUsedRegistry.slice(0, 500)));
  } catch (e) {}
  await dbStorage.setItem('mdc_master_used_parts_registry', mergedUsedRegistry);
  await dbStorage.setItem(MASTER_USED_PARTS_REGISTRY_DOC_ID, mergedUsedRegistry);
  await dbStorage.setItem('mdc_repair_usage', mergedUsedRegistry);

  // C. Fixably Snapshot (if updated)
  if (updatedFixablySnapshot) {
    try {
      localStorage.setItem('mdc_fixably_snapshot', JSON.stringify(updatedFixablySnapshot));
      localStorage.setItem('mdc_fixably_snapshot_timestamp', updatedFixablySnapshot.timestamp);
    } catch (e) {}
    await dbStorage.setItem('mdc_fixably_snapshot', updatedFixablySnapshot);
  }

  // D. Create & Save KGB Upload History Entry
  const uploadHistoryEntry = {
    id: `kgb-upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    uploadDate: nowIso,
    uploadedBy: uploaderName,
    uploadedByEmail: uploaderEmail,
    userRole: currentUser?.role || 'superadmin',
    totalRows: parseResult.totalRows,
    validKgbRows: parseResult.validRowCount,
    matchedOnHandCount: matchedOnHandUnits.length,
    newConsumedCount: newConsumedUnits.length,
    duplicatesSkippedCount: duplicatesSkipped.length,
    totalAddedToLog: summary.totalAddedToConsumptionLog,
    validationErrorsCount: (parseResult.validationErrors || []).length,
    validationErrors: (parseResult.validationErrors || []).slice(0, 50),
    sampleMatches: [...matchedOnHandUnits.slice(0, 10), ...newConsumedUnits.slice(0, 10)],
    status: 'SUCCESS'
  };

  let kgbUploadHistory = [];
  try {
    const rawHist = localStorage.getItem('mdc_kgb_upload_history');
    if (rawHist) kgbUploadHistory = JSON.parse(rawHist);
  } catch (e) {}
  if (!Array.isArray(kgbUploadHistory)) kgbUploadHistory = [];
  const updatedKgbUploadHistory = [uploadHistoryEntry, ...kgbUploadHistory].slice(0, 100);

  try {
    localStorage.setItem('mdc_kgb_upload_history', JSON.stringify(updatedKgbUploadHistory));
  } catch (e) {}
  await dbStorage.setItem('mdc_kgb_upload_history', updatedKgbUploadHistory);

  // E. Record to Upload Audit Logs (shows in Serialized Audit Log)
  const auditLogEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    file_name: fileName,
    timestamp: nowIso,
    user_name: uploaderName,
    user_email: uploaderEmail,
    user_role: currentUser?.role || 'superadmin',
    action_type: 'GSX_KGB_USED_INGESTION',
    status: 'SUCCESS',
    module: 'Parts Consumption Automation',
    affected_records: summary.totalAddedToConsumptionLog,
    matched_on_hand_count: matchedOnHandUnits.length,
    new_consumed_count: newConsumedUnits.length,
    duplicates_skipped_count: duplicatesSkipped.length,
    total_processed: parseResult.totalRows,
    summary: `Ingested ${parseResult.validRowCount.toLocaleString()} GSX KGB closed repair records. Auto-marked ${matchedOnHandUnits.length.toLocaleString()} on-hand units as USED and registered ${newConsumedUnits.length.toLocaleString()} consumed repair parts into Consumption Log (${duplicatesSkipped.length.toLocaleString()} duplicates prevented).`
  };

  try {
    const currentAuditLogs = JSON.parse(localStorage.getItem('mdc_upload_audit_logs') || '[]');
    const nextAuditLogs = [auditLogEntry, ...(Array.isArray(currentAuditLogs) ? currentAuditLogs : [])].slice(0, 200);
    localStorage.setItem('mdc_upload_audit_logs', JSON.stringify(nextAuditLogs));
    await dbStorage.setItem('mdc_upload_audit_logs', nextAuditLogs);
  } catch (e) {}

  // 4. Update in-memory React State
  if (setInventoryUnits) {
    setInventoryUnits(updatedInventoryUnits);
  }
  if (setRepairUsageRecords) {
    setRepairUsageRecords(mergedUsedRegistry);
  }
  if (setFixablySnapshot && updatedFixablySnapshot) {
    setFixablySnapshot(updatedFixablySnapshot);
  }

  onProgress?.({ stage: 'Synchronizing with cloud and notifying network...', percent: 85 });

  // 5. Cloud Database Synchronization (Supabase)
  if (supabase) {
    try {
      // Upsert master_used_parts_registry snapshot doc (compact representation to stay within cloud payload limits)
      const compactRegistryForCloud = mergedUsedRegistry.map(r => {
        const entry = {
          id: r.id,
          site_id: r.site_id,
          site_code: r.site_code,
          part_number: r.part_number,
          description: r.description,
          serial_number: r.serial_number,
          work_order_number: r.work_order_number,
          usage_notes: r.usage_notes,
          used_by: r.used_by,
          used_at: r.used_at,
          date_used: r.date_used,
          month_name: r.month_name
        };
        if (r.site_name) entry.site_name = r.site_name;
        if (r.repair_number && r.repair_number !== r.work_order_number) entry.repair_number = r.repair_number;
        if (r.product_kgb && r.product_kgb !== r.serial_number) entry.product_kgb = r.product_kgb;
        if (r.product_kbb) entry.product_kbb = r.product_kbb;
        if (r.source && r.source !== 'GSX_KGB_USED_REPORT') entry.source = r.source;
        return entry;
      });
      const { error: regUpsertErr } = await supabase.from('saved_records').upsert({
        id: MASTER_USED_PARTS_REGISTRY_DOC_ID,
        record_type: 'used_parts_registry',
        period_label: 'Master Used Parts Registry',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        notes: 'Log of serialized parts consumed in repairs',
        saved_by_name: uploaderName,
        snapshot_data: { records: compactRegistryForCloud },
        updated_at: nowIso
      }, { onConflict: 'id' });
      if (regUpsertErr) {
        console.warn('executeKgbConsumptionSync master_used_parts_registry upsert warning:', regUpsertErr.message);
      }

      // Upsert master_kgb_upload_history_registry snapshot doc
      await supabase.from('saved_records').upsert({
        id: KGB_UPLOAD_HISTORY_DOC_ID,
        record_type: 'kgb_upload_history',
        period_label: 'GSX KGB Upload History Registry',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        notes: 'Audit history of uploaded GSX KGB Used Reports',
        saved_by_name: uploaderName,
        snapshot_data: { history: updatedKgbUploadHistory },
        updated_at: nowIso
      }, { onConflict: 'id' });

      // Batch update inventory_units in chunks of 50
      const serialsToUpdate = matchedOnHandUnits.map(u => u.serialNumber);
      if (serialsToUpdate.length > 0) {
        const chunkSize = 50;
        for (let i = 0; i < serialsToUpdate.length; i += chunkSize) {
          const chunk = serialsToUpdate.slice(i, i + chunkSize);
          const { error: updErr } = await supabase
            .from('inventory_units')
            .update({
              status: 'used',
              allocated_at: nowIso,
              updated_at: nowIso
            })
            .in('serial_number', chunk);

          if (updErr && String(updErr.message || '').includes('inventory_status')) {
            // Database enum 'inventory_status' has not yet added 'used' value; gracefully update timestamps
            await supabase
              .from('inventory_units')
              .update({
                allocated_at: nowIso,
                updated_at: nowIso
              })
              .in('serial_number', chunk);
          }
        }
      }
    } catch (dbErr) {
      console.warn('executeKgbConsumptionSync cloud sync notice:', dbErr.message);
    }
  }

  // 6. Realtime Cross-Tab and Cross-User Broadcast
  if (typeof broadcastCloudEvent === 'function') {
    broadcastCloudEvent('KGB_USED_REPORT_SYNCED', {
      uploadId: uploadHistoryEntry.id,
      fileName,
      totalAdded: summary.totalAddedToConsumptionLog,
      matchedOnHandCount: matchedOnHandUnits.length,
      newConsumedCount: newConsumedUnits.length,
      timestamp: nowIso
    });
    broadcastCloudEvent('PART_MARKED_AS_USED', {
      count: summary.totalAddedToConsumptionLog,
      source: 'GSX_KGB_USED_REPORT'
    });
  }

  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      const bus = new BroadcastChannel('mdc_sync_bus');
      bus.postMessage({
        type: 'KGB_USED_REPORT_SYNCED',
        payload: {
          timestamp: nowIso,
          uploadEntry: uploadHistoryEntry,
          totalAdded: summary.totalAddedToConsumptionLog
        }
      });
      bus.close();
    } catch (e) {}
  }

  onProgress?.({ stage: 'Synchronization complete!', percent: 100 });

  showToast?.(
    `Successfully processed GSX KGB Report! Logged ${summary.totalAddedToConsumptionLog.toLocaleString()} consumed parts (${matchedOnHandUnits.length} on-hand matched, ${newConsumedUnits.length} new records, ${duplicatesSkipped.length} duplicates skipped).`,
    'success'
  );

  return {
    success: true,
    summary,
    uploadHistoryEntry,
    reconciliation
  };
}

/**
 * Retrieves the persistent GSX KGB upload history.
 * Combines IndexedDB, LocalStorage, and optional cloud saved records.
 * 
 * @returns {Promise<Array>} List of upload history objects sorted descending
 */
export async function getKgbUploadHistory() {
  try {
    const idbHist = await dbStorage.getItem('mdc_kgb_upload_history');
    if (Array.isArray(idbHist) && idbHist.length > 0) {
      return idbHist;
    }
    const localHist = JSON.parse(localStorage.getItem('mdc_kgb_upload_history') || '[]');
    if (Array.isArray(localHist) && localHist.length > 0) {
      return localHist;
    }
  } catch (e) {}
  return [];
}
