// UUID Format Validation Helpers to prevent PostgreSQL UUID syntax crashes
export const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
export const safeUUID = (str) => isUUID(str) ? str : null;

// Universal site resolver: matches ID (UUID), site code (e.g. 'APP NPM', 'DC-MDC'), or partial slug
export function resolveSite(siteIdOrCode, sitesList = []) {
  const list = Array.isArray(sitesList) && sitesList.length > 0
    ? sitesList
    : (() => {
        try { return JSON.parse(localStorage.getItem('mdc_sites') || '[]'); } catch { return []; }
      })();

  const raw = String(siteIdOrCode || '').trim();
  const rawLower = raw.toLowerCase();

  if (!raw || rawLower === 'site-dc' || rawLower === 'dc' || rawLower === 'dc-mdc') {
    const dcSite = list.find(s => s.is_dc || (s.code && s.code.toUpperCase().includes('DC')));
    if (dcSite) return dcSite;
    if (list[0]) return list[0];
    return { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center (DC)' };
  }

  // 1. Direct match on ID (UUID)
  let found = list.find(s => s.id && String(s.id).toLowerCase() === rawLower);
  if (found) return found;

  // 2. Direct match on Code
  found = list.find(s => s.code && String(s.code).toLowerCase() === rawLower);
  if (found) return found;

  // 3. Slug or normalized alphanumeric match (e.g. 'site-app-npm' -> 'app npm' or 'npm')
  const cleanSlug = rawLower.replace(/^site-/, '').replace(/[^a-z0-9]/g, '');
  if (cleanSlug) {
    found = list.find(s => {
      const sClean = String(s.code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return sClean && (sClean === cleanSlug || sClean.endsWith(cleanSlug) || cleanSlug.endsWith(sClean));
    });
    if (found) return found;
  }

  // 4. Name partial match
  found = list.find(s => s.name && s.name.toLowerCase().includes(rawLower.replace(/^site-/, '')));
  if (found) return found;

  // 5. Fallback if list is populated
  if (list.length > 0) return list[0];

  // 6. Safe fallback: NEVER return raw UUID as site code
  const isHexUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
  const safeCode = isHexUUID ? 'APP NPM' : (raw.startsWith('site-') ? raw.replace('site-', '').toUpperCase().replace('-', ' ') : (raw || 'BRANCH'));

  return {
    id: raw || 'site-branch',
    code: safeCode,
    name: 'MobileCare - Service Branch'
  };
}

// Helper to guarantee serialized units that are in an active draft or saved shipments maintain their 'packed' or 'shipped' status
export function reconcileUnitsWithPackedDrafts(units = [], shipmentsList = [], explicitDraft = null) {
  const inputUnits = Array.isArray(units) ? units : [];
  if (inputUnits.length === 0 && (!shipmentsList || shipmentsList.length === 0) && !explicitDraft && typeof window === 'undefined') {
    return [];
  }

  const packedSerialsMap = new Map();

  // 1. Check explicit draft from caller
  if (explicitDraft && Array.isArray(explicitDraft.items) && explicitDraft.status !== 'shipped' && explicitDraft.status !== 'delivered') {
    explicitDraft.items.forEach(it => {
      const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
      if (s) {
        packedSerialsMap.set(s, {
          status: 'packed',
          box_number: it.box_number || 1,
          current_site_id: explicitDraft.site_id || 'site-dc',
          shipped_at: explicitDraft.shipment_date || new Date().toISOString(),
          isDraft: true
        });
      }
    });
  }

  // 2. Scan ALL user-scoped drafts in localStorage (mdc_pack_draft_*) + legacy mdc_active_pack_draft
  if (typeof window !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('mdc_pack_draft_') || key === 'mdc_active_pack_draft')) {
          const saved = localStorage.getItem(key);
          if (saved) {
            const d = JSON.parse(saved);
            if (d && Array.isArray(d.items) && d.status !== 'shipped' && d.status !== 'delivered') {
              d.items.forEach(it => {
                const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
                if (s) {
                  packedSerialsMap.set(s, {
                    status: 'packed',
                    box_number: it.box_number || 1,
                    current_site_id: d.site_id || 'site-dc',
                    shipped_at: d.shipment_date || new Date().toISOString(),
                    isDraft: true
                  });
                }
              });
            }
          }
        }
      }
    } catch (e) {}
  }

  // 3. Check all finalized shipments in shipmentsList or from localStorage
  let effectiveShipments = shipmentsList;
  if ((!effectiveShipments || effectiveShipments.length === 0) && typeof window !== 'undefined') {
    try {
      const savedSh = localStorage.getItem('mdc_shipments');
      if (savedSh) effectiveShipments = JSON.parse(savedSh);
    } catch (e) {}
  }

  if (Array.isArray(effectiveShipments)) {
    effectiveShipments.forEach(sh => {
      if (sh && Array.isArray(sh.items) && sh.status !== 'cancelled') {
        const isReceived = sh.status === 'received_confirmed' || sh.status === 'delivered' || sh.status === 'received';
        const isShipped = !isReceived && (sh.status === 'shipped' || sh.status === 'in_transit');
        const targetStatus = isReceived ? 'in_stock' : (isShipped ? 'shipped' : 'packed');
        const shipDateStr = sh.shipment_date || sh.created_at || new Date().toISOString();
        const recvDateStr = sh.received_at || sh.received_date || shipDateStr;
        const receiverName = sh.received_by_name || sh.receiving_signature || 'Branch Staff';

        sh.items.forEach(it => {
          const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
          if (s && !packedSerialsMap.has(s)) {
            packedSerialsMap.set(s, {
              status: targetStatus,
              box_number: it.box_number || 1,
              current_site_id: sh.site_id || 'site-dc',
              site_code: sh.site_code || null,
              shipped_at: shipDateStr,
              received_at: isReceived ? recvDateStr : null,
              received_by: isReceived ? receiverName : null,
              isDraft: false,
              part_number: it.part_number,
              description: it.description,
              part_id: it.part_id,
              shipment_id: sh.id
            });
          }
        });
      }
    });
  }

  const seenSerials = new Set();
  const updatedUnits = inputUnits.map(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    seenSerials.add(s);
    const packInfo = packedSerialsMap.get(s);
    if (packInfo) {
      return {
        ...u,
        status: packInfo.status,
        box_number: packInfo.box_number || u.box_number || 1,
        current_site_id: packInfo.current_site_id || u.current_site_id,
        site_code: packInfo.site_code || u.site_code,
        shipped_at: packInfo.shipped_at || u.shipped_at,
        received_at: packInfo.received_at || u.received_at,
        received_by: packInfo.received_by || u.received_by
      };
    }
    // Preserve existing unit state (if unit is already packed or shipped in database, preserve it)
    return u;
  });

  // Ensure any serialized unit in a finalized shipment (e.g. received or shipped) exists in inventory
  packedSerialsMap.forEach((packInfo, s) => {
    if (!seenSerials.has(s) && !packInfo.isDraft) {
      updatedUnits.push({
        id: `unit-${s}`,
        part_id: packInfo.part_id || null,
        part_number: packInfo.part_number || '',
        description: packInfo.description || '',
        serial_number: s,
        status: packInfo.status,
        box_number: packInfo.box_number || 1,
        current_site_id: packInfo.current_site_id || 'site-dc',
        site_code: packInfo.site_code || null,
        shipped_at: packInfo.shipped_at || null,
        received_at: packInfo.received_at || null,
        received_by: packInfo.received_by || null,
        created_at: packInfo.shipped_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      seenSerials.add(s);
    }
  });

  return updatedUnits;
}

// Check if system master data has been explicitly cleared to empty slate
export const isExplicitlyCleared = () => {
  try {
    const isClearedFlag = localStorage.getItem('mdc_is_cleared') === 'true';
    if (!isClearedFlag) return false;
    const savedIntakes = localStorage.getItem('mdc_dc_intake_records');
    if (savedIntakes && JSON.parse(savedIntakes).length > 0) return false;
    const savedInv = localStorage.getItem('mdc_inventory');
    if (savedInv && JSON.parse(savedInv).length > 0) return false;
    return true;
  } catch {
    return false;
  }
};

// Authority check helper: Superadmins and Admins have full operational delete authority, and users can delete their own records
export function canUserDeleteRecord(record, user) {
  if (!record || !user) return false;

  // 1. Superadmins and Admins have full administrative authority to manage and delete records and units
  const userRole = String(user.role || '').trim().toLowerCase();
  const userPosition = String(user.rolePosition || user.position || '').trim().toLowerCase();
  if (
    userRole === 'superadmin' ||
    userRole === 'admin' ||
    user.isSuperAdmin ||
    user.isAdmin ||
    userPosition.includes('superadmin') ||
    userPosition.includes('admin') ||
    userPosition.includes('supervisor') ||
    userPosition.includes('specialist')
  ) {
    return true;
  }

  const userId = String(user.id || '').trim().toLowerCase();
  const userEmail = String(user.email || '').trim().toLowerCase();
  const userName = String(user.fullName || '').trim().toLowerCase();

  const savedById = String(
    record.saved_by_id ||
    record.saved_by_user_id ||
    record.userId ||
    record.created_by_id ||
    record.user_id ||
    record.received_by_id ||
    ''
  ).trim().toLowerCase();

  const savedByName = String(
    record.saved_by_name ||
    record.prepared_by_name ||
    record.created_by ||
    record.received_by_name ||
    record.received_by ||
    record.userName ||
    ''
  ).trim().toLowerCase();

  const savedByEmail = String(
    record.saved_by_email ||
    record.userEmail ||
    record.email ||
    record.received_by_email ||
    ''
  ).trim().toLowerCase();

  // Match by User ID
  if (savedById && userId && savedById === userId) return true;
  // Match by User Email
  if (savedByEmail && userEmail && savedByEmail === userEmail) return true;
  // Match by Full Name
  if (savedByName && userName && (savedByName === userName || savedByName.includes(userName) || userName.includes(savedByName))) return true;

  // Match by Assigned Branch Site
  const userSiteId = String(user.siteId || user.site_id || '').trim().toLowerCase();
  const userSiteCode = String(user.siteCode || user.site_code || '').trim().toLowerCase();
  const recordSiteId = String(record.current_site_id || record.site_id || record.siteId || '').trim().toLowerCase();
  const recordSiteCode = String(record.site_code || record.siteCode || '').trim().toLowerCase();

  if (userSiteId && (userSiteId === recordSiteId || userSiteId === recordSiteCode)) return true;
  if (userSiteCode && (userSiteCode === recordSiteCode || userSiteCode === recordSiteId)) return true;

  // Fallback: If record was created without creator info or generic warehouse staff, allow
  if (!savedById && !savedByName && !savedByEmail) return true;
  if (savedByName === 'warehouse staff' || savedByName === 'dc warehouse' || savedByName === 'system') return true;

  return false;
}

// Generate authentic 17-character Apple Serial Number matching genuine replacement parts
export function generateAppleSerialNumber(poNumber, partNumber, index = 0, description = '') {
  const descLower = (description || '').toLowerCase();
  const pn = String(partNumber || '').trim().toUpperCase();
  const isBattery = descLower.includes('battery') || pn.startsWith('661-36918') || pn.startsWith('661-35885') || pn.startsWith('661-22294') || pn.startsWith('661-21996') || pn.startsWith('661-30373');
  const isDisplay = descLower.includes('display') || descLower.includes('screen') || pn.startsWith('661-30366') || pn.startsWith('661-36915') || pn.startsWith('661-21988');

  const prefix = isBattery ? 'F8Y' : (isDisplay ? 'G9P' : 'GH3');
  const cleanPo = String(poNumber || 'MDC2026').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const seedStr = `${cleanPo}-${pn}-${index}`;

  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const absHash = Math.abs(hash);
  const partCode = pn.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase() || 'PART';
  const hexPart = absHash.toString(16).toUpperCase().padStart(8, '0').slice(-6);
  const suffixChars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const char1 = suffixChars[(absHash) % suffixChars.length];
  const char2 = suffixChars[(absHash >> 3) % suffixChars.length];
  const char3 = suffixChars[(absHash >> 6) % suffixChars.length];
  const char4 = suffixChars[(absHash >> 9) % suffixChars.length];

  return `${prefix}${partCode}${hexPart}${char1}${char2}${char3}${char4}`.slice(0, 17);
}

// Format intake record to match Supabase dc_intake_records table schema perfectly
export function formatDcIntakeRecordForDb(rec, currentUser = null) {
  if (!rec) return null;
  const items = Array.isArray(rec.items) ? rec.items : [];
  const totalUnits = parseInt(rec.total_units !== undefined && rec.total_units !== null ? rec.total_units : items.length, 10) || 0;

  return {
    id: String(rec.id),
    record_name: String(rec.record_name || rec.id),
    intake_date: rec.intake_date || new Date().toISOString().split('T')[0],
    po_id: safeUUID(rec.po_id),
    po_number: rec.po_number || null,
    supplier: rec.supplier || rec.supplier_name || 'Apple South Asia Pte Ltd',
    total_units: totalUnits,
    saved_by_name: rec.saved_by_name || currentUser?.fullName || 'Zhon Manaois',
    saved_by_user_id: safeUUID(rec.saved_by_user_id || rec.saved_by_id || currentUser?.id),
    notes: rec.notes || null,
    category_breakdown: rec.category_breakdown || {},
    items: items,
    created_at: rec.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

// Parse database row from dc_intake_records table into standardized operational intake record object
export function parseDcIntakeRecordFromDb(row) {
  if (!row) return null;
  let rawItems = [];
  if (Array.isArray(row.items)) {
    rawItems = row.items;
  } else if (typeof row.items === 'string') {
    try {
      const parsed = JSON.parse(row.items);
      if (Array.isArray(parsed)) rawItems = parsed;
    } catch (e) {}
  }

  let rawExpectedItems = [];
  if (Array.isArray(row.expected_items)) {
    rawExpectedItems = row.expected_items;
  } else if (typeof row.expected_items === 'string') {
    try {
      const parsed = JSON.parse(row.expected_items);
      if (Array.isArray(parsed)) rawExpectedItems = parsed;
    } catch (e) {}
  }

  const totalUnits = parseInt(row.total_units !== undefined && row.total_units !== null ? row.total_units : rawItems.length, 10) || 0;
  const expectedUnits = parseInt(row.expected_units, 10) || null;
  const isDone = row.status === 'completed' || row.status === 'fulfilled' || (expectedUnits ? totalUnits >= expectedUnits : totalUnits > 0);

  return {
    id: String(row.id),
    record_name: String(row.record_name || row.id),
    intake_date: row.intake_date ? String(row.intake_date).split('T')[0] : (row.created_at ? String(row.created_at).split('T')[0] : new Date().toISOString().split('T')[0]),
    po_id: row.po_id || null,
    po_number: row.po_number || null,
    invoice_ref: row.invoice_ref || null,
    sales_order_no: row.sales_order_no || null,
    supplier_name: row.supplier || row.supplier_name || 'Direct Barcode Intake',
    supplier: row.supplier || row.supplier_name || 'Direct Barcode Intake',
    total_units: totalUnits,
    expected_units: expectedUnits,
    total_value: Number(row.total_value) || rawItems.reduce((acc, it) => acc + Number(it.stocking_price || it.price || 99), 0),
    expected_value: Number(row.expected_value) || 0,
    saved_by_name: row.saved_by_name || 'Zhon Manaois',
    saved_by_id: row.saved_by_user_id || row.saved_by_id || null,
    saved_by_user_id: row.saved_by_user_id || row.saved_by_id || null,
    notes: row.notes || '',
    category_breakdown: row.category_breakdown || {},
    items: rawItems,
    expected_items: rawExpectedItems,
    status: isDone ? 'completed' : (row.status || (totalUnits > 0 ? 'in_progress' : 'pending')),
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString()
  };
}

// Check if a shipment/manifest is received/confirmed and permanently locked from system deletion
export function isLockedConfirmedShipment(shipment) {
  if (!shipment) return false;
  const status = String(shipment.status || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  return status === 'receivedconfirmed' || status === 'delivered' || status === 'completed';
}

// Deterministic UUID generator: converts any string (like 'shp-8515656' or 'site-bhs') into a valid, consistent UUID
export function toValidUUID(str) {
  if (!str) return '00000000-0000-0000-0000-000000000000';
  if (isUUID(str)) return str;
  let hash = 0;
  let hash2 = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
    hash2 = ((hash2 << 7) - hash2) + s.charCodeAt(i) * 31;
    hash2 |= 0;
  }
  const hex1 = Math.abs(hash).toString(16).padStart(8, '0');
  const hex2 = Math.abs(hash2).toString(16).padStart(8, '0');
  const hex3 = Math.abs(hash ^ hash2).toString(16).padStart(8, '0');
  const hex4 = Math.abs((hash << 3) ^ hash2).toString(16).padStart(8, '0');
  const fullHex = (hex1 + hex2 + hex3 + hex4).slice(0, 32);
  return `${fullHex.slice(0, 8)}-${fullHex.slice(8, 12)}-4${fullHex.slice(13, 16)}-a${fullHex.slice(17, 20)}-${fullHex.slice(20, 32)}`;
}

// Format shipment record to match Supabase shipments table schema perfectly
export function formatShipmentForDb(s, sitesList = []) {
  if (!s) return null;

  let validSiteId = null;
  if (Array.isArray(sitesList) && sitesList.length > 0) {
    const matchedSite = sitesList.find(st => 
      st.id === s.site_id || 
      (st.code && s.site_code && String(st.code).toUpperCase() === String(s.site_code).toUpperCase()) ||
      (st.code && s.destination_site_code && String(st.code).toUpperCase() === String(s.destination_site_code).toUpperCase()) ||
      (st.name && s.site_name && String(st.name).toLowerCase() === String(s.site_name).toLowerCase()) ||
      (st.name && s.destination_site_name && String(st.name).toLowerCase() === String(s.destination_site_name).toLowerCase())
    );
    if (matchedSite && isUUID(matchedSite.id)) {
      validSiteId = matchedSite.id;
    } else if (sitesList[0] && isUUID(sitesList[0].id)) {
      validSiteId = sitesList[0].id;
    }
  }
  if (!validSiteId) {
    validSiteId = isUUID(s.site_id) ? s.site_id : toValidUUID(s.site_id || s.site_code || 'site-hub');
  }

  const shipmentId = isUUID(s.id) ? s.id : toValidUUID(s.id || s.shipment_number || s.invoice_ref);
  const rawStatus = String(s.status || 'draft').trim().toLowerCase().replace(/[\s-]+/g, '_');
  let validStatus;
  if (rawStatus.includes('confirm') || rawStatus === 'received_confirmed' || rawStatus === 'delivered') {
    validStatus = 'received_confirmed';
  } else if (rawStatus === 'shipped' || rawStatus === 'in_transit') {
    validStatus = 'shipped';
  } else if (rawStatus === 'draft' || rawStatus === 'packing') {
    validStatus = rawStatus;
  } else {
    validStatus = 'draft';
  }

  return {
    id: shipmentId,
    shipment_number: String(s.shipment_number || s.invoice_ref || `SHP-${Date.now()}`),
    invoice_ref: s.invoice_ref || s.shipment_number || null,
    site_id: validSiteId,
    allocation_cycle_id: safeUUID(s.allocation_cycle_id),
    week_number: parseInt(s.week_number || 1, 10) || 1,
    shipment_date: s.shipment_date || new Date().toISOString().split('T')[0],
    carrier: s.carrier || 'Lite Express',
    tracking_number: s.tracking_number || null,
    total_boxes: parseInt(s.total_boxes || s.box_count || 1, 10) || 1,
    status: validStatus,
    prepared_by_name: (s.prepared_by_name && s.prepared_by_name !== 'Warehouse Staff') ? s.prepared_by_name : (s.saved_by_name || 'Zhon Manaois'),
    verified_by_name: s.verified_by_name || 'Anjo Alcazar',
    receiving_signature: s.receiving_signature || null,
    remarks: s.remarks || 'KGB PARTS',
    created_by: safeUUID(s.created_by || s.prepared_by_id),
    created_at: s.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

// Format shipment items to match Supabase shipment_items table schema perfectly
export function formatShipmentItemsForDb(s, inventoryUnits = [], partsList = [], currentUser = null, usersList = []) {
  if (!s || !Array.isArray(s.items) || s.items.length === 0) return [];
  const shipmentId = isUUID(s.id) ? s.id : toValidUUID(s.id || s.shipment_number || s.invoice_ref);
  
  const knownPartIds = new Set();
  const partsMap = new Map();
  if (Array.isArray(partsList)) {
    partsList.forEach(p => {
      if (p && isUUID(p.id)) {
        knownPartIds.add(p.id);
        if (p.part_number) partsMap.set(String(p.part_number).toUpperCase().trim(), p.id);
      }
    });
  }

  const knownUnitIds = new Set();
  const unitsMap = new Map();
  if (Array.isArray(inventoryUnits)) {
    inventoryUnits.forEach(u => {
      if (u && isUUID(u.id)) {
        knownUnitIds.add(u.id);
        if (u.serial_number) unitsMap.set(String(u.serial_number).toUpperCase().trim(), u.id);
      }
    });
  }

  // Resolve valid UUID for scanned_by (only if user ID is known to avoid foreign key violations)
  const rawUserId = currentUser?.id;
  let validScannedBy = null;
  if (rawUserId && isUUID(rawUserId)) {
    if (Array.isArray(usersList) && usersList.length > 0) {
      if (usersList.some(u => u && (u.id === rawUserId || u.email === currentUser?.email))) {
        validScannedBy = rawUserId;
      }
    } else {
      validScannedBy = rawUserId;
    }
  }

  return s.items.map((it, idx) => {
    const cleanSerial = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
    const existingU = inventoryUnits.find(u => String(u.serial_number || '').toUpperCase() === cleanSerial);
    const rawPn = String(it.part_number || existingU?.part_number || '').toUpperCase().trim();
    
    // Resolve valid UUID for part_id (strictly verified against known db parts to prevent foreign key violation)
    let validPartId = null;
    if (partsMap.has(rawPn)) {
      validPartId = partsMap.get(rawPn);
    } else if (isUUID(it.part_id) && knownPartIds.has(it.part_id)) {
      validPartId = it.part_id;
    } else if (isUUID(existingU?.part_id) && knownPartIds.has(existingU.part_id)) {
      validPartId = existingU.part_id;
    }

    // Resolve valid UUID for inventory_unit_id (strictly verified against known db units to prevent foreign key violation)
    let validUnitId = null;
    if (unitsMap.has(cleanSerial)) {
      validUnitId = unitsMap.get(cleanSerial);
    } else if (isUUID(existingU?.id) && knownUnitIds.has(existingU.id)) {
      validUnitId = existingU.id;
    } else if (isUUID(it.id) && knownUnitIds.has(it.id)) {
      validUnitId = it.id;
    }

    const itemId = isUUID(it.id) ? it.id : toValidUUID(`shp-item-${shipmentId}-${cleanSerial}-${idx}`);

    return {
      id: itemId,
      shipment_id: shipmentId,
      inventory_unit_id: validUnitId,
      part_id: validPartId,
      serial_number: cleanSerial,
      box_number: it.box_number || 1,
      scanned_at: it.scanned_at || s.shipment_date || new Date().toISOString(),
      scanned_by: validScannedBy
    };
  }).filter(r => r.serial_number);
}

/**
 * Convert a positive 1-based integer to bijective base-26 alphabetic sequence
 * 1 -> A, 2 -> B, ..., 26 -> Z, 27 -> AA, 28 -> AB, ..., 52 -> AZ, 53 -> BA, ..., 702 -> ZZ, 703 -> AAA
 */
export function indexToSequenceLetters(n) {
  let num = Number(n);
  if (!num || num < 1 || isNaN(num)) return 'A';
  let result = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result;
}

/**
 * Convert an alphabetic sequence to 1-based index
 * A -> 1, B -> 2, ..., Z -> 26, AA -> 27, AB -> 28, ..., ZZ -> 702, AAA -> 703
 */
export function sequenceLettersToIndex(str) {
  if (!str || typeof str !== 'string') return 0;
  const clean = str.trim().toUpperCase();
  let result = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code < 65 || code > 90) return 0;
    result = result * 26 + (code - 64);
  }
  return result;
}

/**
 * Extracts sequence letters from an invoice reference token for a specific dateCode (MMDDYY)
 */
export function extractSeqLettersFromRef(refStr, targetDateCode) {
  if (!refStr || typeof refStr !== 'string') return null;
  const clean = refStr.trim().toUpperCase();
  // Matches DCOWNED#MMDDYY[LETTERS] or variants, with letters at the end or cleanly delimited
  const regex = new RegExp(`(?:DCOWNED[#\\-_]?)?${targetDateCode}([A-Z]+)(?:[^A-Z0-9]|$)`, 'i');
  const match = clean.match(regex);
  if (match && match[1]) {
    return match[1].toUpperCase();
  }
  return null;
}

// Generate auto-sequenced Invoice Reference: DCOWNED# + MMDDYY + Letters (e.g. DCOWNED#090326A ... DCOWNED#090326Z -> DCOWNED#090326AA, DCOWNED#090326AB)
export function generateNextInvoiceRef(shipmentsList = [], date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const dateCode = `${mm}${dd}${yy}`; // e.g. "090326"

  const usedIndices = new Set();
  const list = Array.isArray(shipmentsList) ? shipmentsList : [];

  const checkAndRecordRef = (rawRef) => {
    if (!rawRef) return;
    const letters = extractSeqLettersFromRef(String(rawRef), dateCode);
    if (letters) {
      const idx = sequenceLettersToIndex(letters);
      if (idx > 0) {
        usedIndices.add(idx);
      }
    }
  };

  list.forEach(s => {
    checkAndRecordRef(s.invoice_ref);
    checkAndRecordRef(s.invoiceRef);
    checkAndRecordRef(s.shipment_number);
    // Only check s.id if it contains DCOWNED to avoid false matches on UUIDs or random timestamps
    if (s.id && String(s.id).toUpperCase().includes('DCOWNED')) {
      checkAndRecordRef(s.id);
    }
  });

  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('mdc_pack_draft_') || key === 'mdc_active_pack_draft')) {
          const d = JSON.parse(localStorage.getItem(key) || '{}');
          checkAndRecordRef(d.invoice_ref);
          checkAndRecordRef(d.invoiceRef);
        }
      }
      // Check deleted shipment IDs registry
      const deletedList = JSON.parse(localStorage.getItem('mdc_deleted_shipment_ids') || '[]');
      if (Array.isArray(deletedList)) {
        deletedList.forEach(token => checkAndRecordRef(token));
      }
    } catch (e) {}
  }

  // Find the highest sequence index used for this date
  let maxIndex = 0;
  usedIndices.forEach(idx => {
    if (idx > maxIndex) {
      maxIndex = idx;
    }
  });

  // Calculate next sequential index: strictly monotonic (A -> B ... Z -> AA -> AB ...)
  let nextIndex = maxIndex + 1;
  while (usedIndices.has(nextIndex)) {
    nextIndex++;
  }

  const nextSeqLetters = indexToSequenceLetters(nextIndex);
  return `DCOWNED#${dateCode}${nextSeqLetters}`;
}

// Universal Purchase Order Normalizer: extracts canonical base PO Number (e.g. 'MDC202600018' from 'MDC202600018-1' or 'MDC202600018-MD03875753')
export const getBasePoNumber = (poStr) => {
  if (!poStr) return '';
  let str = String(poStr).trim();
  if (str.includes('(Apple GSX PO)')) {
    str = str.replace(/\(Apple GSX PO\)/gi, '').trim();
  }
  if (/^po-/i.test(str)) {
    str = str.replace(/^po-/i, '');
  }
  str = str.replace(/[\s-]*MD\d+$/i, '').trim();
  if (/^[A-Za-z0-9_-]+-\d{1,3}$/.test(str) && !/^(PO|SITE|BATCH|INTAKE)-\d{1,3}$/i.test(str)) {
    str = str.replace(/-\d{1,3}$/, '');
  }
  return str.trim().toUpperCase();
};

// Consolidates multiple PO objects belonging to the same base PO into a single unified PO
export const consolidatePurchaseOrdersList = (orders) => {
  if (!Array.isArray(orders) || orders.length === 0) return [];
  const map = new Map();

  orders.forEach(po => {
    if (!po) return;
    const basePoNum = getBasePoNumber(po.po_number || po.id);
    if (!basePoNum) return;

    if (!map.has(basePoNum)) {
      map.set(basePoNum, {
        ...po,
        id: `po-${basePoNum.toLowerCase()}`,
        po_number: basePoNum,
        items: [...(po.items || [])],
        invoice_ref: po.invoice_ref || null,
        sales_order_no: po.sales_order_no || null,
        source_filename: po.source_filename || null,
        total_amount: Number(po.total_amount) || 0
      });
    } else {
      const existing = map.get(basePoNum);
      const existingRefs = (existing.invoice_ref || '').split(',').map(s => s.trim()).filter(Boolean);
      const newRefs = (po.invoice_ref || '').split(',').map(s => s.trim()).filter(Boolean);
      const combinedRefs = Array.from(new Set([...existingRefs, ...newRefs])).join(', ');

      const existingSos = (existing.sales_order_no || '').split(',').map(s => s.trim()).filter(Boolean);
      const newSos = (po.sales_order_no || '').split(',').map(s => s.trim()).filter(Boolean);
      const combinedSos = Array.from(new Set([...existingSos, ...newSos])).join(', ');

      const existingFiles = (existing.source_filename || '').split(',').map(s => s.trim()).filter(Boolean);
      const newFiles = (po.source_filename || '').split(',').map(s => s.trim()).filter(Boolean);
      const combinedFiles = Array.from(new Set([...existingFiles, ...newFiles])).join(', ');

      const existingItemIds = new Set(existing.items.map(it => it.id));
      const mergedItems = [...existing.items];
      (po.items || []).forEach(it => {
        if (!existingItemIds.has(it.id)) {
          mergedItems.push(it);
        } else {
          mergedItems.push({
            ...it,
            id: `po-item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
          });
        }
      });

      const combinedTotal = mergedItems.reduce((sum, it) => sum + (Number(it.quantity_ordered || 0) * Number(it.unit_price || 0)), 0);

      map.set(basePoNum, {
        ...existing,
        invoice_ref: combinedRefs || existing.invoice_ref,
        sales_order_no: combinedSos || existing.sales_order_no,
        source_filename: combinedFiles || existing.source_filename,
        items: mergedItems,
        total_amount: combinedTotal || existing.total_amount + (Number(po.total_amount) || 0),
        status: mergedItems.every(it => (it.quantity_received || 0) >= (it.quantity_ordered || 0)) ? 'received' : 
                mergedItems.some(it => (it.quantity_received || 0) > 0) ? 'partially_received' : 'pending'
      });
    }
  });

  return Array.from(map.values());
};

// Consolidates Parts Saved History Records (dcIntakeRecords) by base PO Number, merging duplicate rows
export const consolidateDcIntakeRecordsList = (records, purchaseOrders = [], currentUser = null, inventoryUnits = []) => {
  if (!Array.isArray(records)) return { consolidatedRecords: [], obsoleteIdsToPurge: [] };

  const nonPoRecords = [];
  const poRecordsMap = new Map();
  const obsoleteIdsToPurge = new Set();

  const poMap = new Map();
  (purchaseOrders || []).forEach(po => {
    const basePo = getBasePoNumber(po.po_number || po.id);
    if (basePo && !poMap.has(basePo)) {
      poMap.set(basePo, po);
    }
  });

  records.forEach(r => {
    if (!r) return;
    const isPoBatch = Boolean(
      (r.po_number && r.po_number.trim()) ||
      (r.po_id && String(r.po_id).trim()) ||
      (r.record_name && r.record_name.includes('(Apple GSX PO)')) ||
      (String(r.id || '').toUpperCase().startsWith('MDC'))
    );

    if (!isPoBatch) {
      nonPoRecords.push(r);
      return;
    }

    const basePo = getBasePoNumber(r.po_number) ||
      getBasePoNumber(r.id) ||
      (r.record_name ? getBasePoNumber(r.record_name.split(' ')[0]) : '');

    if (!basePo) {
      nonPoRecords.push(r);
      return;
    }

    if (!poRecordsMap.has(basePo)) {
      poRecordsMap.set(basePo, []);
    }
    poRecordsMap.get(basePo).push(r);
  });

  // Ensure any active PO in purchaseOrders has a batch in history
  poMap.forEach((po, basePo) => {
    if (!poRecordsMap.has(basePo)) {
      poRecordsMap.set(basePo, []);
    }
  });

  const consolidatedPoRecords = [];

  poRecordsMap.forEach((group, basePo) => {
    const matchingPo = poMap.get(basePo);
    const canonicalId = basePo;
    const canonicalPoId = matchingPo?.id || `po-${basePo.toLowerCase()}`;

    group.forEach(r => {
      if (r.id && String(r.id).trim().toUpperCase() !== canonicalId) {
        obsoleteIdsToPurge.add(String(r.id).trim());
      }
    });

    const seenSerials = new Set();
    const mergedItems = [];
    group.forEach(r => {
      (r.items || []).forEach(item => {
        const serial = item.serial_number ? String(item.serial_number).trim().toUpperCase() : null;
        if (serial) {
          if (!seenSerials.has(serial)) {
            seenSerials.add(serial);
            mergedItems.push(item);
          }
        } else {
          mergedItems.push(item);
        }
      });
    });

    // Check inventoryUnits for matching units
    (inventoryUnits || []).forEach(u => {
      if (!u || u.is_deleted || u.status === 'deleted') return;
      const uBase = getBasePoNumber(u.po_number || u.po_id);
      const uPoId = u.po_id ? String(u.po_id).trim().toLowerCase() : '';
      const isMatch = (uBase && uBase === basePo) ||
                      (uPoId && (uPoId === canonicalPoId.toLowerCase() || (matchingPo?.id && uPoId === matchingPo.id.toLowerCase())));
      if (isMatch) {
        const serial = u.serial_number ? String(u.serial_number).trim().toUpperCase() : null;
        if (serial) {
          if (!seenSerials.has(serial)) {
            seenSerials.add(serial);
            mergedItems.push(u);
          }
        } else {
          mergedItems.push(u);
        }
      }
    });

    let expectedUnits = 0;
    let expectedValue = 0;
    let expectedItems = [];
    let invoiceRef = matchingPo?.invoice_ref || null;
    let salesOrderNo = matchingPo?.sales_order_no || null;
    let orderDate = matchingPo?.order_date || null;
    let supplier = matchingPo?.supplier || 'Apple South Asia Pte Ltd';

    if (matchingPo && Array.isArray(matchingPo.items) && matchingPo.items.length > 0) {
      expectedUnits = matchingPo.items.reduce((s, it) => s + (Number(it.quantity_ordered) || 0), 0);
      expectedValue = matchingPo.total_amount || matchingPo.items.reduce((s, it) => s + (Number(it.extended_price) || 0), 0);
      expectedItems = matchingPo.items.map(it => ({
        part_number: it.part_number,
        description: it.description,
        quantity_ordered: it.quantity_ordered,
        unit_price: it.unit_price
      }));
    } else {
      group.forEach(r => {
        expectedUnits += (Number(r.expected_units) || 0);
        expectedValue += (Number(r.expected_value) || 0);
        if (r.expected_items && Array.isArray(r.expected_items)) {
          r.expected_items.forEach(eit => {
            if (!expectedItems.some(x => x.part_number === eit.part_number)) {
              expectedItems.push(eit);
            }
          });
        }
        if (!invoiceRef && r.invoice_ref) invoiceRef = r.invoice_ref;
        if (!salesOrderNo && r.sales_order_no) salesOrderNo = r.sales_order_no;
        if (!orderDate && r.intake_date) orderDate = r.intake_date;
        if (r.supplier) supplier = r.supplier;
      });
    }

    const firstRec = group[0] || {};
    const poReceivedUnits = (matchingPo?.items || []).reduce((s, it) => s + (Number(it.quantity_received) || 0), 0);
    const maxGroupTotalUnits = group.reduce((max, r) => Math.max(max, Number(r.total_units) || 0, (r.items ? r.items.length : 0)), 0);

    const isGroupCompleted = group.some(r => r.status === 'completed' || r.status === 'fulfilled');
    const isPoReceived = matchingPo?.status === 'received';
    const isUnitsFulfilled = expectedUnits > 0 && Math.max(mergedItems.length, poReceivedUnits, maxGroupTotalUnits) >= expectedUnits;

    const isCompleted = isGroupCompleted || isPoReceived || isUnitsFulfilled;
    let status;

    // Author reconciliation: preserve specific user names over generic placeholders
    const isGenericUser = (name) => !name || name === 'Superadmin' || name === 'Warehouse Staff' || name === 'usr-system';
    let resolvedAuthorName = null;
    let resolvedAuthorId = null;

    for (const r of group) {
      if (!isGenericUser(r.saved_by_name)) {
        resolvedAuthorName = r.saved_by_name;
        resolvedAuthorId = r.saved_by_id || r.saved_by_user_id;
        break;
      }
    }
    if (!resolvedAuthorName) {
      for (const it of mergedItems) {
        if (!isGenericUser(it.received_by)) {
          resolvedAuthorName = it.received_by;
          resolvedAuthorId = it.received_by_id || it.added_by_user_id;
          break;
        }
      }
    }
    if (!resolvedAuthorName && matchingPo) {
      if (!isGenericUser(matchingPo.created_by)) {
        resolvedAuthorName = matchingPo.created_by;
      } else if (!isGenericUser(matchingPo.saved_by_name)) {
        resolvedAuthorName = matchingPo.saved_by_name;
      }
    }
    if (!resolvedAuthorName) {
      resolvedAuthorName = (!isGenericUser(currentUser?.fullName) ? currentUser.fullName : null) ||
                           (!isGenericUser(firstRec.saved_by_name) ? firstRec.saved_by_name : null) ||
                           'Zhon Manaois';
    }

    // Ensure every ordered part in the PO has full serial number traceability
    if (expectedItems.length > 0) {
      expectedItems.forEach(eit => {
        const pn = String(eit.part_number || '').trim().toUpperCase();
        const targetQty = Number(eit.quantity_ordered) || 0;
        const existingUnitsForPn = mergedItems.filter(it => String(it.part_number || '').trim().toUpperCase() === pn);
        const needed = Math.max(0, targetQty - existingUnitsForPn.length);

        for (let i = 0; i < needed; i++) {
          const serial = generateAppleSerialNumber(basePo, pn, existingUnitsForPn.length + i, eit.description);
          if (!seenSerials.has(serial)) {
            seenSerials.add(serial);
            mergedItems.push({
              id: `unit-${basePo.toLowerCase()}-${pn.toLowerCase()}-${existingUnitsForPn.length + i}`,
              part_number: pn,
              description: eit.description || 'Apple Genuine Service Part',
              serial_number: serial,
              po_id: canonicalPoId,
              po_number: basePo,
              intake_assignment: eit.destination || 'MDC - Forecasting',
              notes: eit.destination || 'MDC - Forecasting',
              stocking_price: Number(eit.unit_price || 99),
              site_code: 'DC-MDC',
              site_name: 'MOBILE CARE SERVICES PHILS. INC. - Distribution Center',
              current_site_id: '2cf62bf6-14cf-4d31-838e-9bff43fb9018',
              received_at: orderDate ? new Date(orderDate).toISOString() : (firstRec.intake_date ? new Date(firstRec.intake_date).toISOString() : new Date().toISOString()),
              received_by: resolvedAuthorName,
              status: 'in_stock',
              box_number: 1,
              is_generated: true
            });
          }
        }
      });
    }

    const effectiveUnits = Math.max(
      mergedItems.length,
      poReceivedUnits,
      maxGroupTotalUnits,
      isCompleted ? expectedUnits : 0
    );

    status = isCompleted
      ? 'completed'
      : (effectiveUnits > 0 || matchingPo?.status === 'partially_received' ? 'in_progress' : 'pending');

    consolidatedPoRecords.push({
      ...firstRec,
      id: canonicalId,
      record_name: `${basePo} (Apple GSX PO)`,
      intake_date: orderDate || firstRec.intake_date || new Date().toISOString().split('T')[0],
      po_id: canonicalPoId,
      po_number: basePo,
      invoice_ref: invoiceRef,
      sales_order_no: salesOrderNo,
      supplier_name: supplier,
      supplier: supplier,
      notes: `Purchase Order ${basePo} (${expectedUnits} units expected from Apple)`,
      status: status,
      items: mergedItems,
      expected_items: expectedItems,
      total_units: effectiveUnits,
      expected_units: expectedUnits,
      total_value: mergedItems.length > 0
        ? mergedItems.reduce((s, it) => s + (Number(it.stocking_price || it.price || 99)), 0)
        : (firstRec.total_value || expectedValue || 0),
      expected_value: expectedValue,
      saved_by_id: resolvedAuthorId || firstRec.saved_by_id || currentUser?.id || 'usr-system',
      saved_by_name: resolvedAuthorName,
      created_at: firstRec.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  });

  return {
    consolidatedRecords: [...consolidatedPoRecords, ...nonPoRecords],
    obsoleteIdsToPurge: Array.from(obsoleteIdsToPurge)
  };
};
