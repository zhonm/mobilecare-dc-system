// UUID Format Validation Helpers to prevent PostgreSQL UUID syntax crashes
export const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
export const safeUUID = (str) => isUUID(str) ? str : null;

// Helper to guarantee serialized units that are in an active draft or saved shipments maintain their 'packed' or 'shipped' status
// NOTE: Keep in sync with the identical function in appContextHelpers.js
export function reconcileUnitsWithPackedDrafts(units = [], shipmentsList = [], explicitDraft = null, activeStations = null) {
  const inputUnits = Array.isArray(units) ? units : [];
  if (inputUnits.length === 0 && (!shipmentsList || shipmentsList.length === 0) && !explicitDraft && !activeStations && typeof window === 'undefined') {
    return [];
  }

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
    // Preserve existing unit state — do not reset units that may have been
    // dispatched via shipments not present in the current shipmentsList
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
