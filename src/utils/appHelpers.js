// UUID Format Validation Helpers to prevent PostgreSQL UUID syntax crashes
export const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
export const safeUUID = (str) => isUUID(str) ? str : null;

// Helper to guarantee serialized units that are in an active draft or saved shipments maintain their 'packed' or 'shipped' status
// NOTE: Keep in sync with the identical function in appContextHelpers.js
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
    // Preserve existing unit state — do not reset units that may have been
    // dispatched via shipments not present in the current shipmentsList
    return u;
  });
}
