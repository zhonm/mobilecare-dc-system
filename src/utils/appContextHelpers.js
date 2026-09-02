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
  if (!Array.isArray(units) || units.length === 0) return [];

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
        const isShipped = sh.status === 'shipped' || sh.status === 'delivered';
        const targetStatus = isShipped ? 'shipped' : 'packed';
        const shipDateStr = sh.shipment_date || sh.created_at || new Date().toISOString();
        sh.items.forEach(it => {
          const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
          if (s && !packedSerialsMap.has(s)) {
            packedSerialsMap.set(s, {
              status: targetStatus,
              box_number: it.box_number || 1,
              current_site_id: sh.site_id || 'site-dc',
              shipped_at: shipDateStr,
              isDraft: false
            });
          }
        });
      }
    });
  }

  return units.map(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    const packInfo = packedSerialsMap.get(s);
    if (packInfo) {
      return {
        ...u,
        status: packInfo.status,
        box_number: packInfo.box_number || u.box_number || 1,
        current_site_id: packInfo.current_site_id || u.current_site_id,
        shipped_at: packInfo.shipped_at || u.shipped_at
      };
    }
    // Preserve existing unit state (if unit is already packed or shipped in database, preserve it)
    return u;
  });
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

// Format intake record to match Supabase dc_intake_records table schema perfectly
export function formatDcIntakeRecordForDb(rec, currentUser = null) {
  if (!rec) return null;
  return {
    id: String(rec.id),
    record_name: String(rec.record_name || rec.id),
    intake_date: rec.intake_date || new Date().toISOString().split('T')[0],
    po_id: safeUUID(rec.po_id),
    po_number: rec.po_number || null,
    supplier: rec.supplier || rec.supplier_name || 'Direct Barcode Intake',
    total_units: parseInt(rec.total_units || (rec.items ? rec.items.length : 0), 10) || 0,
    saved_by_name: rec.saved_by_name || currentUser?.fullName || 'Warehouse Staff',
    saved_by_user_id: safeUUID(rec.saved_by_user_id || rec.saved_by_id || currentUser?.id),
    notes: rec.notes || null,
    category_breakdown: rec.category_breakdown || {},
    items: Array.isArray(rec.items) ? rec.items : [],
    created_at: rec.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
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

// Generate auto-sequenced Invoice Reference: DCOWNED# + MMDDYY + Letter (e.g. DCOWNED#082726A, DCOWNED#082726B)
export function generateNextInvoiceRef(shipmentsList = [], date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const dateCode = `${mm}${dd}${yy}`; // e.g. "082726"

  const usedLetters = new Set();
  const list = Array.isArray(shipmentsList) ? shipmentsList : [];

  list.forEach(s => {
    const ref = String(s.invoice_ref || s.invoiceRef || s.id || '').toUpperCase();
    const regex = new RegExp(`(?:DCOWNED[#\\-_]?)?${dateCode}([A-Z]+)`);
    const match = ref.match(regex);
    if (match && match[1]) {
      usedLetters.add(match[1]);
    }
  });

  if (typeof window !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('mdc_pack_draft_') || key === 'mdc_active_pack_draft')) {
          const d = JSON.parse(localStorage.getItem(key) || '{}');
          const ref = String(d.invoice_ref || '').toUpperCase();
          const regex = new RegExp(`(?:DCOWNED[#\\-_]?)?${dateCode}([A-Z]+)`);
          const match = ref.match(regex);
          if (match && match[1]) {
            usedLetters.add(match[1]);
          }
        }
      }
    } catch (e) {}
  }

  // Assign next sequential letter (A, B, C, ... Z)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < alphabet.length; i++) {
    const letter = alphabet[i];
    if (!usedLetters.has(letter)) {
      return `DCOWNED#${dateCode}${letter}`;
    }
  }

  // Fallback for > 26 shipments on the same date (AA, AB, etc.)
  for (let i = 0; i < alphabet.length; i++) {
    for (let j = 0; j < alphabet.length; j++) {
      const combo = `${alphabet[i]}${alphabet[j]}`;
      if (!usedLetters.has(combo)) {
        return `DCOWNED#${dateCode}${combo}`;
      }
    }
  }

  return `DCOWNED#${dateCode}${Date.now().toString().slice(-2)}`;
}
