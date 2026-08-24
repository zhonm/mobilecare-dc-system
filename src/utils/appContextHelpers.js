// UUID Format Validation Helpers to prevent PostgreSQL UUID syntax crashes
export const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
export const safeUUID = (str) => isUUID(str) ? str : null;

// Helper to guarantee serialized units that are in an active draft or saved shipments maintain their 'packed' or 'shipped' status
export function reconcileUnitsWithPackedDrafts(units = [], shipmentsList = [], explicitDraft = null) {
  if (!Array.isArray(units) || units.length === 0) return [];

  const packedSerialsMap = new Map();

  // 1. Check active draft from arg or localStorage (actively being packed in Scan-Out right now)
  let draft = explicitDraft;
  if (!draft && typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('mdc_active_pack_draft');
      if (saved) draft = JSON.parse(saved);
    } catch (e) {}
  }
  if (draft && Array.isArray(draft.items) && draft.status !== 'shipped' && draft.status !== 'delivered') {
    draft.items.forEach(it => {
      const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
      if (s) {
        packedSerialsMap.set(s, {
          status: 'packed',
          box_number: it.box_number || 1,
          current_site_id: draft.site_id || 'site-dc',
          shipped_at: draft.shipment_date || new Date().toISOString(),
          isDraft: true
        });
      }
    });
  }

  // 2. Check all finalized shipments in shipmentsList or from localStorage
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
    return {
      ...u,
      status: 'in_stock',
      current_site_id: 'site-dc',
      shipped_at: null,
      shipped_by: null
    };
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

// Authority check helper: only the user who originally saved/created the record has permission to delete it
export function canUserDeleteRecord(record, user) {
  if (!record || !user) return false;

  const userId = String(user.id || '').trim().toLowerCase();
  const userEmail = String(user.email || '').trim().toLowerCase();
  const userName = String(user.fullName || '').trim().toLowerCase();

  const savedById = String(
    record.saved_by_id ||
    record.saved_by_user_id ||
    record.userId ||
    record.created_by_id ||
    record.user_id ||
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
    ''
  ).trim().toLowerCase();

  // Match by User ID
  if (savedById && userId && savedById === userId) return true;
  // Match by User Email
  if (savedByEmail && userEmail && savedByEmail === userEmail) return true;
  // Match by Full Name
  if (savedByName && userName && savedByName === userName) return true;

  // Fallback: If record was created without creator info, allow
  if (!savedById && !savedByName && !savedByEmail) return true;

  return false;
}
