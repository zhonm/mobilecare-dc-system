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
export function reconcileUnitsWithPackedDrafts(units = [], shipmentsList = [], explicitDraft = null, activeStations = null) {
  const inputUnits = Array.isArray(units) ? units : [];
  if (inputUnits.length === 0 && (!shipmentsList || shipmentsList.length === 0) && !explicitDraft && !activeStations && typeof window === 'undefined') {
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

  // 1.5 Check active remote packing stations across all concurrent users
  const stationsToScan = activeStations 
    ? (Array.isArray(activeStations) ? activeStations : Object.values(activeStations))
    : (typeof window !== 'undefined' && window.__mdc_active_packing_stations ? Object.values(window.__mdc_active_packing_stations) : []);

  if (Array.isArray(stationsToScan)) {
    stationsToScan.forEach(st => {
      if (st && st.isPacking !== false) {
        if (Array.isArray(st.items)) {
          st.items.forEach(it => {
            const s = String(it.serial_number || it.serialNumber || (typeof it === 'string' ? it : '')).trim().toUpperCase();
            if (s) {
              packedSerialsMap.set(s, {
                status: 'packed',
                box_number: it.box_number || 1,
                current_site_id: st.siteId || 'site-dc',
                site_code: st.siteCode || null,
                shipped_at: new Date().toISOString(),
                isDraft: true,
                reservedBy: st.userName || 'Peer Station'
              });
            }
          });
        }
        if (Array.isArray(st.serials)) {
          st.serials.forEach(sn => {
            const s = String(sn || '').trim().toUpperCase();
            if (s && !packedSerialsMap.has(s)) {
              packedSerialsMap.set(s, {
                status: 'packed',
                box_number: 1,
                current_site_id: st.siteId || 'site-dc',
                site_code: st.siteCode || null,
                shipped_at: new Date().toISOString(),
                isDraft: true,
                reservedBy: st.userName || 'Peer Station'
              });
            }
          });
        }
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
    return localStorage.getItem('mdc_is_cleared') === 'true';
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

// Universal Date Normalizer: Converts any date format (e.g. '02-Sep-2026', '2026-09-08T...', '09/08/2026') into standard ISO YYYY-MM-DD
export function normalizeDateToIso(dateInput) {
  if (!dateInput) return new Date().toISOString().split('T')[0];
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) return new Date().toISOString().split('T')[0];

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    // ISO string with T: e.g. 2026-09-08T...
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.split('T')[0];

    // Match DD-MMM-YYYY or DD-MMM-YY (e.g. 02-Sep-2026, 02-SEP-2026, 2-Sep-26, 02 Sep 2026)
    const dMonYMatch = trimmed.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$/);
    if (dMonYMatch) {
      const day = dMonYMatch[1].padStart(2, '0');
      const monthStr = dMonYMatch[2].slice(0, 3).toLowerCase();
      let year = dMonYMatch[3];
      if (year.length === 2) {
        year = `20${year}`;
      }
      const monthMap = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
      };
      const month = monthMap[monthStr];
      if (month) {
        return `${year}-${month}-${day}`;
      }
    }

    // Match YYYY-MMM-DD (e.g. 2026-Sep-02)
    const yMonDMatch = trimmed.match(/^(\d{4})[-/\s]([A-Za-z]{3,9})[-/\s](\d{1,2})$/);
    if (yMonDMatch) {
      const year = yMonDMatch[1];
      const monthStr = yMonDMatch[2].slice(0, 3).toLowerCase();
      const day = yMonDMatch[3].padStart(2, '0');
      const monthMap = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
      };
      const month = monthMap[monthStr];
      if (month) {
        return `${year}-${month}-${day}`;
      }
    }

    // Match MM/DD/YYYY or DD/MM/YYYY
    const mdyMatch = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (mdyMatch) {
      const p1 = parseInt(mdyMatch[1], 10);
      const p2 = parseInt(mdyMatch[2], 10);
      const year = mdyMatch[3];
      if (p1 > 12) {
        return `${year}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
      } else {
        return `${year}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
      }
    }

    // Native Date parser fallback
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  } else if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    const y = dateInput.getFullYear();
    const m = String(dateInput.getMonth() + 1).padStart(2, '0');
    const d = String(dateInput.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return new Date().toISOString().split('T')[0];
}

// Format intake record to match Supabase dc_intake_records table schema perfectly
export function formatDcIntakeRecordForDb(rec, currentUser = null) {
  if (!rec) return null;
  const items = Array.isArray(rec.items) ? rec.items : [];
  const totalUnits = parseInt(rec.total_units !== undefined && rec.total_units !== null ? rec.total_units : items.length, 10) || 0;
  const cleanDate = normalizeDateToIso(rec.intake_date || rec.intakeDate || rec.created_at);

  return {
    id: String(rec.id),
    record_name: String(rec.record_name || rec.id),
    intake_date: cleanDate,
    po_id: safeUUID(rec.po_id),
    po_number: rec.po_number || null,
    supplier: rec.supplier || rec.supplier_name || 'Apple South Asia Pte Ltd',
    total_units: totalUnits,
    saved_by_name: rec.saved_by_name || currentUser?.fullName || 'Zhon Manaois',
    saved_by_user_id: safeUUID(rec.saved_by_user_id || rec.saved_by_id || currentUser?.id),
    notes: rec.notes || null,
    category_breakdown: rec.category_breakdown || {},
    items: items,
    is_manual_intake: rec.is_manual_intake === true,
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
  const cleanDate = normalizeDateToIso(row.intake_date || row.created_at);

  return {
    id: String(row.id),
    record_name: String(row.record_name || row.id),
    intake_date: cleanDate,
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
    is_manual_intake: row.is_manual_intake === true,
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
  } else if (rawStatus === 'pending_pickup' || rawStatus === 'ready_for_pickup' || rawStatus === 'ready_for_dispatch' || rawStatus === 'ready') {
    validStatus = 'pending_pickup';
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

// Detect if a string represents a direct intake or non-PO placeholder (e.g. 'Direct Receiving', 'Direct Intake', 'None', etc.)
export const isDirectOrNonPo = (str) => {
  if (!str) return true;
  const s = String(str).trim().toUpperCase();
  return (
    s === '' ||
    s === 'DIRECT' ||
    s === 'DIRECT RECEIVING' ||
    s === 'DIRECT INTAKE' ||
    s === 'DIRECT DISPATCH' ||
    s === 'DIRECT BARCODE INTAKE' ||
    s === 'DIRECT DISPATCH (NO PO)' ||
    s === 'DIRECT INTAKE BATCH' ||
    s.startsWith('DIRECT RECEIVING') ||
    s.startsWith('DIRECT INTAKE') ||
    s.startsWith('DIRECT DISPATCH') ||
    s.startsWith('DIRECT BARCODE') ||
    s === 'NO PO' ||
    s === 'N/A' ||
    s === 'NONE' ||
    s === 'NULL' ||
    s === 'UNDEFINED'
  );
};

// Universal Purchase Order Normalizer: extracts canonical base PO Number (e.g. 'MDC202600018' from 'MDC202600018-1' or 'MDC202600018-MD03875753')
export const getBasePoNumber = (poStr) => {
  if (!poStr) return '';
  if (isDirectOrNonPo(poStr)) return '';
  let str = String(poStr).trim();
  if (str.includes('(Apple GSX PO)')) {
    str = str.replace(/\(Apple GSX PO\)/gi, '').trim();
  }
  if (isDirectOrNonPo(str)) return '';
  if (/^po-/i.test(str)) {
    str = str.replace(/^po-/i, '');
  }
  str = str.replace(/[\s-]*MD\d+$/i, '').trim();
  if (/^[A-Za-z0-9_-]+-\d{1,3}$/.test(str) && !/^(PO|SITE|BATCH|INTAKE)-\d{1,3}$/i.test(str)) {
    str = str.replace(/-\d{1,3}$/, '');
  }
  const res = str.trim().toUpperCase();
  if (isDirectOrNonPo(res)) return '';
  return res;
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

// Extract maximum numerical ID from a record ID or name (e.g. MDC202600024 -> 202600024)
export const extractMaxIdNumber = (idStr) => {
  if (!idStr) return 0;
  const matches = String(idStr).match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  return Math.max(...matches.map(m => parseInt(m, 10)));
};

// Sorts batches in descending order so that the newly created record is always at the top
export const sortBatchesNewestFirst = (a, b) => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  // 1. Primary: created_at timestamp descending (most recently created/saved first)
  const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
  const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
  if (timeA && timeB && timeA !== timeB && !isNaN(timeA) && !isNaN(timeB)) {
    return timeB - timeA;
  }

  // 2. Secondary: Sequential Batch ID numeric descending (e.g. MDC202600024 > MDC202600022 > MDC202600021 > MDC202600020)
  const idNumA = extractMaxIdNumber(a.id || a.record_name);
  const idNumB = extractMaxIdNumber(b.id || b.record_name);
  if (idNumA !== idNumB && idNumA > 0 && idNumB > 0) {
    return idNumB - idNumA;
  }

  // 3. Tertiary: intake_date descending (latest intake date first)
  const dateA = a.intake_date ? new Date(a.intake_date).getTime() : 0;
  const dateB = b.intake_date ? new Date(b.intake_date).getTime() : 0;
  if (dateA && dateB && dateA !== dateB && !isNaN(dateA) && !isNaN(dateB)) {
    return dateB - dateA;
  }

  // 4. Fallback: string comparison on ID descending
  return String(b.id || '').localeCompare(String(a.id || ''));
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

    // 0. Heal legacy records corrupted by earlier consolidation bug (id set to 'DIRECT RECEIVING')
    let recordToProcess = r;
    const rawIdUpper = String(r.id || '').trim().toUpperCase();
    const rawNameUpper = String(r.record_name || '').trim().toUpperCase();

    // Check for and purge obsolete composite records (e.g. "MDC202600022 AND MDC202600024")
    if (rawIdUpper.includes(' AND ') || rawNameUpper.includes(' AND ')) {
      obsoleteIdsToPurge.add(String(r.id).trim());
      if (r.record_name) obsoleteIdsToPurge.add(String(r.record_name).trim());
      return;
    }

    if (rawIdUpper === 'DIRECT RECEIVING' || rawIdUpper === 'DIRECT_RECEIVING' || rawIdUpper.startsWith('DIRECT RECEIVING')) {
      obsoleteIdsToPurge.add(String(r.id).trim());
      obsoleteIdsToPurge.add('DIRECT RECEIVING');
      recordToProcess = {
        ...r,
        id: 'MDC202600021',
        record_name: (r.record_name && !r.record_name.toUpperCase().startsWith('DIRECT RECEIVING'))
          ? r.record_name
          : 'MDC202600021',
        po_number: null,
        po_id: null,
        supplier_name: r.supplier_name && !r.supplier_name.toUpperCase().includes('APPLE') ? r.supplier_name : 'Direct Intake',
        supplier: r.supplier && !r.supplier.toUpperCase().includes('APPLE') ? r.supplier : 'Direct Intake',
        notes: (r.notes && !r.notes.includes('Purchase Order DIRECT RECEIVING')) ? r.notes : 'Direct Intake Batch',
        is_manual_intake: true
      };
    }

    // 1. Direct-intake / manual intake records saved by warehouse staff with no linked PO must NEVER be
    // routed into the PO consolidation path — doing so would overwrite their custom names and
    // data with auto-generated PO batch content. Protect them first.
    const isExplicitlyManual = recordToProcess.is_manual_intake === true;
    const hasDirectPo = isDirectOrNonPo(recordToProcess.po_number);
    const hasDirectPoId = isDirectOrNonPo(recordToProcess.po_id);
    const isDirectRecordId = isDirectOrNonPo(recordToProcess.id);

    // Check if the record matches an ACTUAL Purchase Order in purchaseOrders (poMap)
    const basePoCandidate = getBasePoNumber(recordToProcess.po_number) ||
      (recordToProcess.record_name && recordToProcess.record_name.includes('(Apple GSX PO)') ? getBasePoNumber(recordToProcess.record_name.split(' ')[0]) : '') ||
      (recordToProcess.po_id && !hasDirectPoId ? getBasePoNumber(recordToProcess.po_id) : '');

    const matchesRealPo = basePoCandidate ? poMap.has(basePoCandidate) : false;

    // A record is ONLY a PO batch if it is NOT manual, has a non-direct PO number, and matches a registered PO or has Apple GSX PO badge (without being a direct receiving badge)
    const isPoBatch = !isExplicitlyManual && !hasDirectPo && Boolean(
      (basePoCandidate && matchesRealPo) ||
      (recordToProcess.record_name && recordToProcess.record_name.includes('(Apple GSX PO)') && !recordToProcess.record_name.toUpperCase().startsWith('DIRECT'))
    );

    if (!isPoBatch) {
      const cleanRecord = {
        ...recordToProcess,
        po_number: isDirectOrNonPo(recordToProcess.po_number) ? null : recordToProcess.po_number,
        po_id: isDirectOrNonPo(recordToProcess.po_id) ? null : recordToProcess.po_id,
        is_manual_intake: true
      };
      if (cleanRecord.record_name && cleanRecord.record_name.includes('(Apple GSX PO)') && (hasDirectPo || isDirectRecordId)) {
        cleanRecord.record_name = cleanRecord.record_name.replace(/\s*\(Apple GSX PO\)/gi, '').trim();
      }
      nonPoRecords.push(cleanRecord);
      return;
    }

    const basePo = basePoCandidate || getBasePoNumber(recordToProcess.id);

    if (!basePo || isDirectOrNonPo(basePo)) {
      nonPoRecords.push({ ...recordToProcess, is_manual_intake: true, po_number: null });
      return;
    }

    if (!poRecordsMap.has(basePo)) {
      poRecordsMap.set(basePo, []);
    }
    poRecordsMap.get(basePo).push(recordToProcess);
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

    let expectedUnits = 0;
    let expectedValue = 0;
    let expectedItems = [];
    let invoiceRef = matchingPo?.invoice_ref || null;
    let salesOrderNo = matchingPo?.sales_order_no || null;
    let orderDate = matchingPo?.order_date ? normalizeDateToIso(matchingPo.order_date) : null;
    let supplier = matchingPo?.supplier || 'Apple South Asia Pte Ltd';

    if (matchingPo && Array.isArray(matchingPo.items) && matchingPo.items.length > 0) {
      expectedUnits = matchingPo.items.reduce((s, it) => s + (Number(it.quantity_ordered) || 0), 0);
      expectedValue = matchingPo.total_amount || matchingPo.items.reduce((s, it) => s + (Number(it.extended_price) || 0), 0);
      expectedItems = matchingPo.items.map(it => ({
        part_number: String(it.part_number || '').trim().toUpperCase(),
        description: it.description || 'Apple Genuine Service Part',
        quantity_ordered: Number(it.quantity_ordered) || 0,
        unit_price: Number(it.unit_price) || 0,
        destination: it.destination || 'MDC - Forecasting'
      }));
    } else {
      group.forEach(r => {
        expectedUnits += (Number(r.expected_units) || 0);
        expectedValue += (Number(r.expected_value) || 0);
        if (r.expected_items && Array.isArray(r.expected_items)) {
          r.expected_items.forEach(eit => {
            const pn = String(eit.part_number || '').trim().toUpperCase();
            if (!expectedItems.some(x => x.part_number === pn)) {
              expectedItems.push({
                part_number: pn,
                description: eit.description || 'Apple Genuine Service Part',
                quantity_ordered: Number(eit.quantity_ordered) || 0,
                unit_price: Number(eit.unit_price) || 0,
                destination: eit.destination || 'MDC - Forecasting'
              });
            }
          });
        }
        if (!invoiceRef && r.invoice_ref) invoiceRef = r.invoice_ref;
        if (!salesOrderNo && r.sales_order_no) salesOrderNo = r.sales_order_no;
        if (!orderDate && r.intake_date) orderDate = normalizeDateToIso(r.intake_date);
        if (r.supplier) supplier = r.supplier;
      });
    }

    const firstRec = group[0] || {};
    const poReceivedUnits = (matchingPo?.items || []).reduce((s, it) => s + (Number(it.quantity_received) || 0), 0);

    // Resolved Intake Date:
    // Manual intakes retain their user-specified intake_date.
    // For auto-saved PO records, the intake date at the DC warehouse represents when the shipment entered/was intaken into DC (received_at, created_at, or today), NOT Apple's historical invoice order_date!
    let resolvedIntakeDate;
    const isExplicitManual = Boolean(firstRec.is_manual_intake);
    const dcReceiptDate = normalizeDateToIso(firstRec.received_at || matchingPo?.received_at || firstRec.created_at || matchingPo?.created_at || new Date());

    if (isExplicitManual && firstRec.intake_date) {
      resolvedIntakeDate = normalizeDateToIso(firstRec.intake_date);
    } else if (firstRec.intake_date && orderDate && firstRec.intake_date === orderDate) {
      // Previously set to Apple's invoice order_date; heal to actual DC receipt/creation date
      resolvedIntakeDate = dcReceiptDate;
    } else if (firstRec.intake_date && !orderDate) {
      resolvedIntakeDate = normalizeDateToIso(firstRec.intake_date);
    } else {
      // Auto-saved PO record intake date: use actual DC receipt/creation date
      resolvedIntakeDate = dcReceiptDate;
    }

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

    // 1. Gather candidate pool from saved records in group and active inventory units
    const candidatePool = [];
    group.forEach(r => {
      (r.items || []).forEach(item => {
        if (item) candidatePool.push(item);
      });
    });

    (inventoryUnits || []).forEach(u => {
      if (!u || u.is_deleted || u.status === 'deleted') return;
      const uBase = getBasePoNumber(u.po_number || u.po_id);
      const uPoId = u.po_id ? String(u.po_id).trim().toLowerCase() : '';
      const isMatch = (uBase && uBase === basePo) ||
                      (uPoId && (uPoId === canonicalPoId.toLowerCase() || (matchingPo?.id && uPoId === matchingPo.id.toLowerCase())));
      if (isMatch) {
        candidatePool.push(u);
      }
    });

    // Helper: determine if a unit is an auto-generated placeholder
    const isGeneratedUnit = (it) => {
      if (!it) return false;
      if (it.is_generated === true || it.is_placeholder === true) return true;
      const idStr = String(it.id || '').trim().toLowerCase();
      if (idStr.startsWith('unit-mdc') || idStr.startsWith('unit-po') || idStr.startsWith('gen-')) return true;
      return false;
    };

    // Separate candidate units into Real Scanned vs Generated Placeholders per part number
    const candidateRealByPn = new Map();
    const candidatePlaceholderByPn = new Map();
    const seenSerials = new Set();

    candidatePool.forEach(u => {
      const pn = String(u.part_number || '').trim().toUpperCase();
      if (!pn) return;
      const serial = u.serial_number ? String(u.serial_number).trim().toUpperCase() : null;
      if (serial && seenSerials.has(serial)) {
        return;
      }
      if (serial) seenSerials.add(serial);

      if (isGeneratedUnit(u)) {
        if (!candidatePlaceholderByPn.has(pn)) candidatePlaceholderByPn.set(pn, []);
        candidatePlaceholderByPn.get(pn).push(u);
      } else {
        if (!candidateRealByPn.has(pn)) candidateRealByPn.set(pn, []);
        candidateRealByPn.get(pn).push(u);
      }
    });

    // 2. Strict PO Structure Building:
    // Real scanned physical units ALWAYS take priority (1-for-1 replacement of placeholders).
    // All units inherit the official PO line item description to eliminate duplicate SVC/Non-SVC entries!
    const mergedItems = [];
    const processedPartNumbers = new Set();

    if (expectedItems.length > 0) {
      expectedItems.forEach(eit => {
        const pn = String(eit.part_number || '').trim().toUpperCase();
        processedPartNumbers.add(pn);
        const targetQty = Number(eit.quantity_ordered) || 0;
        const realUnits = candidateRealByPn.get(pn) || [];
        const placeholders = candidatePlaceholderByPn.get(pn) || [];

        const selectedForPn = [];

        // Add real scanned units first (unified to PO description)
        realUnits.forEach(ru => {
          selectedForPn.push({
            ...ru,
            part_number: pn,
            description: eit.description || ru.description || 'Apple Genuine Service Part',
            po_id: canonicalPoId,
            po_number: basePo
          });
        });

        // Fill remaining slots up to targetQty with placeholders
        const neededPlaceholders = Math.max(0, targetQty - selectedForPn.length);
        let usedPlaceholders = 0;

        for (let i = 0; i < placeholders.length && usedPlaceholders < neededPlaceholders; i++) {
          const pl = placeholders[i];
          selectedForPn.push({
            ...pl,
            part_number: pn,
            description: eit.description || pl.description || 'Apple Genuine Service Part',
            po_id: canonicalPoId,
            po_number: basePo
          });
          usedPlaceholders++;
        }

        // If still fewer than targetQty, generate deterministic serial placeholders
        const remainingToGenerate = neededPlaceholders - usedPlaceholders;
        for (let i = 0; i < remainingToGenerate; i++) {
          const unitIndex = selectedForPn.length;
          const serial = generateAppleSerialNumber(basePo, pn, unitIndex, eit.description);
          selectedForPn.push({
            id: `unit-${basePo.toLowerCase()}-${pn.toLowerCase()}-${unitIndex}`,
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
            received_at: `${resolvedIntakeDate}T12:00:00.000Z`,
            received_by: resolvedAuthorName,
            status: 'in_stock',
            box_number: 1,
            is_generated: true
          });
        }

        mergedItems.push(...selectedForPn);
      });
    }

    // Keep any real scanned units for parts not originally in expectedItems
    candidateRealByPn.forEach((realUnits, pn) => {
      if (!processedPartNumbers.has(pn)) {
        realUnits.forEach(ru => {
          mergedItems.push({
            ...ru,
            part_number: pn,
            po_id: canonicalPoId,
            po_number: basePo
          });
        });
      }
    });

    const isGroupCompleted = group.some(r => r.status === 'completed' || r.status === 'fulfilled');
    const isPoReceived = matchingPo?.status === 'received';
    const realScannedCount = mergedItems.filter(it => !isGeneratedUnit(it)).length;
    const isUnitsFulfilled = expectedUnits > 0 && (realScannedCount >= expectedUnits || poReceivedUnits >= expectedUnits);

    const isCompleted = isGroupCompleted || isPoReceived || isUnitsFulfilled;

    const effectiveUnits = mergedItems.length > 0
      ? mergedItems.length
      : (isCompleted ? expectedUnits : (poReceivedUnits > 0 ? poReceivedUnits : expectedUnits));

    const status = isCompleted
      ? 'completed'
      : (realScannedCount > 0 || matchingPo?.status === 'partially_received' ? 'in_progress' : 'pending');

    consolidatedPoRecords.push({
      ...firstRec,
      id: canonicalId,
      record_name: `${basePo} (Apple GSX PO)`,
      intake_date: resolvedIntakeDate,
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

  const allConsolidated = [];
  const seenCanonicalIds = new Set();

  consolidatedPoRecords.forEach(r => {
    const canonicalKey = String(r.id || '').trim().toUpperCase();
    if (canonicalKey && !seenCanonicalIds.has(canonicalKey)) {
      seenCanonicalIds.add(canonicalKey);
      allConsolidated.push(r);
    }
  });

  nonPoRecords.forEach(r => {
    const canonicalKey = String(r.id || '').trim().toUpperCase();
    if (canonicalKey && !seenCanonicalIds.has(canonicalKey)) {
      seenCanonicalIds.add(canonicalKey);
      allConsolidated.push(r);
    } else if (canonicalKey) {
      obsoleteIdsToPurge.add(String(r.id).trim());
    }
  });

  allConsolidated.sort(sortBatchesNewestFirst);

  return {
    consolidatedRecords: allConsolidated,
    obsoleteIdsToPurge: Array.from(obsoleteIdsToPurge)
  };
};

/**
 * Canonical helper to filter for live, available physical IN-STOCK inventory units in the Central DC warehouse.
 * Standardizes filtering across System Dashboard, DC Stock Records, and Receive Scan-In Workstation.
 * 
 * Guarantees:
 * 1. 100% synchronization and identical counts across all components.
 * 2. Complete exclusion of packed, shipped, dispatched, or allocated serials (from drafts, active shipments, and past manifests).
 * 3. Complete exclusion of deleted items (is_deleted || status === 'deleted').
 * 4. Complete exclusion of outdated pre-September 2026 units that were previously delivered to sites.
 * 5. Complete exclusion of virtual / PO placeholder items not representing physical DC shelf stock.
 * 6. Strict site isolation ensuring only units located in Central DC (site-dc / DC-MDC) are counted.
 */
export function filterAvailableDcInStockUnits({
  inventoryUnits = [],
  activePackDraft = null,
  shipments = [],
  sessionScans = null,
  sites = []
} = {}) {
  // 1. Serials that are currently in an active packing list draft or saved/dispatched shipments
  const packedSerialsSet = new Set();

  // 1a. Items in active packing draft state
  if (activePackDraft?.items && Array.isArray(activePackDraft.items)) {
    activePackDraft.items.forEach(it => {
      const s = String(it.serial_number || it.serialNumber || it.serial || '').trim().toUpperCase();
      if (s) packedSerialsSet.add(s);
    });
  }

  // 1b. Check localStorage fallback for active packing draft and user-scoped drafts
  if (typeof window !== 'undefined') {
    try {
      if (!activePackDraft) {
        const localDraft = JSON.parse(localStorage.getItem('mdc_active_pack_draft') || 'null');
        if (localDraft?.items && Array.isArray(localDraft.items)) {
          localDraft.items.forEach(it => {
            const s = String(it.serial_number || it.serialNumber || it.serial || '').trim().toUpperCase();
            if (s) packedSerialsSet.add(s);
          });
        }
      }
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('mdc_pack_draft_')) {
          const saved = localStorage.getItem(key);
          if (saved) {
            const d = JSON.parse(saved);
            // If activePackDraft is explicitly provided and matches this draft ID, skip localStorage entry to use active in-memory state
            if (activePackDraft && d?.id === activePackDraft.id) {
              continue;
            }
            if (d?.items && Array.isArray(d.items)) {
              d.items.forEach(it => {
                const s = String(it.serial_number || it.serialNumber || it.serial || '').trim().toUpperCase();
                if (s) packedSerialsSet.add(s);
              });
            }
          }
        }
      }
    } catch (e) {}
  }

  // 1c. Items in ALL finalized, pending, shipped, or received shipments
  (shipments || []).forEach(sh => {
    if (sh && Array.isArray(sh.items) && sh.status !== 'cancelled') {
      if (activePackDraft && sh.id === activePackDraft.id) {
        return;
      }
      sh.items.forEach(it => {
        const s = String(it.serial_number || it.serialNumber || it.serial || '').trim().toUpperCase();
        if (s) packedSerialsSet.add(s);
      });
    }
  });

  // 2. Unit pooling: overlay sessionScans if provided (for zero-latency scan-in updates)
  let pool = inventoryUnits || [];
  if (sessionScans && Array.isArray(sessionScans) && sessionScans.length > 0) {
    const serialMap = new Map();
    (inventoryUnits || []).forEach(u => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s) serialMap.set(s, u);
    });
    sessionScans.forEach(u => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s) {
        const existing = serialMap.get(s);
        serialMap.set(s, { ...existing, ...u });
      }
    });
    pool = Array.from(serialMap.values());
  }

  // 3. Filter strictly for available DC warehouse in-stock parts
  return pool.filter(u => {
    const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
    if (!cleanSerial) return false;

    // Exclude items in active packing draft or shipments
    if (packedSerialsSet.has(cleanSerial)) return false;

    // Exclude items marked with deleted status
    if (u.is_deleted || u.status === 'deleted') return false;

    // Exclude items marked with status packed, shipped, dispatched, or allocated
    if (u.status === 'packed' || u.status === 'shipped' || u.status === 'dispatched' || u.status === 'allocated') return false;
    if (u.status !== 'in_stock' && u.status) return false;

    // Must be physically in DC warehouse (strictly exclude branch stock)
    const isDc = u.current_site_id === 'site-dc' || 
                 u.site_code === 'DC-MDC' || 
                 u.site_code === 'DC' || 
                 (!u.current_site_id && !u.site_code) ||
                 (Array.isArray(sites) && sites.find(s => (s.id === u.current_site_id || s.code === u.current_site_id) && s.is_dc));
    if (!isDc) return false;

    // Exclude outdated parts prior to September 2026 (delivered to sites prior to September period)
    const recvDate = (u.received_at || u.created_at || u.intake_date || '').substring(0, 10);
    if (recvDate && recvDate < '2026-09-01') return false;

    // Exclude virtual / PO items that belong strictly to PO history tracking, not active physical warehouse inventory
    if (u.is_generated || String(u.id || '').startsWith('unit-mdc') || (recvDate === '2026-09-01' && u.po_number)) return false;

    return true;
  });
}

