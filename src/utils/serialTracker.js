/**
 * Serial Number Intelligence & Custody Tracker Utility
 * Resolves complete lifecycle, current location, arrival dates, and repair consumption records.
 */
import { defaultPartsCatalog } from '../data/defaultCatalog.js';

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
 * Resolves complete intelligence for a specific serial number or list of serials
 *
 * @param {string} serialInput - The serial number or partial string to query
 * @param {Object} options
 * @param {Array} options.inventoryUnits - Current active inventory units
 * @param {Array} options.shipments - Outbound and confirmed shipment manifests
 * @param {Array} options.repairUsageRecords - Consumed repair records
 * @param {Array} options.sites - Master list of site objects
 * @param {Array} options.parts - Master parts catalog
 * @returns {Object|null} Comprehensive serial dossier object
 */
export function resolveSerialFullDetails(serialInput, {
  inventoryUnits = [],
  shipments = [],
  repairUsageRecords = [],
  sites = [],
  parts = []
} = {}) {
  const cleanSerial = cleanSerialNumberInput(serialInput);
  if (!cleanSerial) return null;

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

  // If serial is not found in any dataset, return null
  if (!unit && !linkedShipment && !usageRecord) {
    return null;
  }

  // 4. Resolve Part Metadata
  const rawPn = unit?.part_number || shipmentItem?.part_number || shipmentItem?.partNumber || usageRecord?.part_number || '';
  const cleanPn = String(rawPn).trim().toUpperCase();

  const fullCatalog = [...(parts || []), ...(defaultPartsCatalog || [])];
  const matchedPart = fullCatalog.find(p => p.part_number && p.part_number.toUpperCase() === cleanPn)
    || fullCatalog.find(p => p.id && (p.id === unit?.part_id || p.id === shipmentItem?.part_id))
    || null;

  const partNumber = matchedPart?.part_number || cleanPn || 'Apple Service Part';
  const partDescription = matchedPart?.description || unit?.description || shipmentItem?.description || usageRecord?.description || 'Apple Genuine Component';
  const iphoneModel = matchedPart?.iphone_model || unit?.iphone_model || 'iPhone';
  const categoryId = matchedPart?.category_id || unit?.category_id || '';
  const stockingPrice = matchedPart?.stocking_price || unit?.stocking_price || 0;

  // 5. Determine Destination Site / Current Site
  const currentSiteId = unit?.current_site_id || unit?.site_id || linkedShipment?.site_id;
  const currentSiteCode = unit?.site_code || linkedShipment?.site_code;

  let siteObj = (sites || []).find(s =>
    (currentSiteId && s.id === currentSiteId) ||
    (currentSiteCode && s.code?.toUpperCase() === currentSiteCode.toUpperCase())
  );

  // If still not resolved, check usageRecord site
  if (!siteObj && usageRecord?.site_id) {
    siteObj = (sites || []).find(s => s.id === usageRecord.site_id || s.code === usageRecord.site_code);
  }

  const isDcSite = (
    !siteObj ||
    siteObj.id === 'site-dc' ||
    siteObj.code === 'DC-MDC' ||
    siteObj.code === 'DC' ||
    siteObj.is_dc === true
  );

  const siteName = siteObj ? siteObj.name : (isDcSite ? 'Central DC Warehouse' : 'Branch Site');
  const siteCode = siteObj ? siteObj.code : (isDcSite ? 'DC-MDC' : 'BRANCH');

  // 6. Determine Lifecycle Status
  // Priority order:
  // A. Used (in repair usage records or unit status is 'used')
  // B. In Transit (in an active shipment that is not received_confirmed)
  // C. In Stock at Branch (confirmed received at site)
  // D. In Stock at DC (at central distribution center)
  const isUsed = Boolean(
    unit?.status === 'used' ||
    unit?.used_at ||
    usageRecord
  );

  const isShippedInTransit = Boolean(
    !isUsed &&
    linkedShipment &&
    (linkedShipment.status === 'shipped' || linkedShipment.status === 'pending_pickup') &&
    linkedShipment.status !== 'received_confirmed'
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
  } else if (!isDcSite) {
    statusKey = 'in_stock_site';
    statusBadgeLabel = `In Stock at ${siteName}`;
    statusBadgeType = 'site';
  } else {
    statusKey = 'in_stock_dc';
    statusBadgeLabel = 'In Stock at Central DC Warehouse';
    statusBadgeType = 'dc';
  }

  // 7. Recorded Site Arrival Date
  // Resolved from confirmed shipment received date or unit received timestamp at the site
  let siteArrivalDate = null;
  let siteArrivalFormatted = null;

  if (linkedShipment && linkedShipment.status === 'received_confirmed') {
    siteArrivalDate = linkedShipment.received_date || linkedShipment.received_at;
  } else if (!isDcSite && (unit?.received_at || unit?.received_date)) {
    siteArrivalDate = unit.received_date || unit.received_at;
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

  // 8. Recorded Date Used
  let dateUsed = null;
  let dateUsedFormatted = null;
  let usedByName = null;
  let workOrderNumber = null;
  let usageNotes = null;

  if (isUsed) {
    dateUsed = usageRecord?.used_at || unit?.used_at || null;
    if (dateUsed) {
      try {
        const d = new Date(dateUsed);
        dateUsedFormatted = !isNaN(d.getTime())
          ? d.toISOString().replace('T', ' ').slice(0, 16)
          : String(dateUsed);
      } catch {
        dateUsedFormatted = String(dateUsed);
      }
    }
    usedByName = usageRecord?.used_by || usageRecord?.used_by_name || unit?.used_by_name || 'Branch Specialist';
    workOrderNumber = usageRecord?.work_order_number || unit?.work_order_number || 'Internal Repair';
    usageNotes = usageRecord?.usage_notes || unit?.usage_notes || unit?.notes || '';
  }

  // 9. DC Scan-In / Intake Date
  const dcScanInDate = unit?.created_at || unit?.received_at || null;
  let dcScanInFormatted = null;
  if (dcScanInDate) {
    try {
      const d = new Date(dcScanInDate);
      dcScanInFormatted = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : String(dcScanInDate).slice(0, 10);
    } catch {
      dcScanInFormatted = null;
    }
  }

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
    // Location & Stock State
    status: unit?.status || (isUsed ? 'used' : isShippedInTransit ? 'shipped' : 'in_stock'),
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
    siteRegion: siteObj?.region || (siteObj?.province ? 'Provincial' : 'Metro Manila'),
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
    rawUnit: unit || null
  };
}

/**
 * Searches across all inventory units, shipments, and usage records for serials matching a query
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
  parts = []
} = {}, maxResults = 5) {
  if (!query || !query.trim()) return [];

  const cleanQuery = cleanSerialNumberInput(query);
  if (!cleanQuery || cleanQuery.length < 3) return [];

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
      parts
    })
  ).filter(Boolean);
}
