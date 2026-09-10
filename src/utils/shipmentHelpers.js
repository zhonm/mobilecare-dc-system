import { resolveSite, isLockedConfirmedShipment } from './appContextHelpers.js';
import { isProvincialSite } from './partResolver.js';

/**
 * Detects whether a shipment is marked as received or delivered by destination branch.
 */
export const isShipmentReceived = (sh) => {
  if (!sh) return false;
  if (isLockedConfirmedShipment(sh)) return true;
  const status = String(sh.status || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (status === 'received' || status === 'receivedconfirmed' || status === 'delivered' || status === 'completed') {
    return true;
  }
  if (sh.received_confirmed_at || sh.received_at || sh.received_date) {
    return true;
  }
  return false;
};

/**
 * Checks if a shipment is active in the outbound pipeline (Shipped or Pending).
 * Excludes Received, Delivered, and Cancelled shipments.
 */
export const isShipmentActive = (sh) => {
  if (!sh) return false;
  const status = String(sh.status || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (status === 'cancelled') return false;
  if (isShipmentReceived(sh)) return false;
  const hasItems = (Array.isArray(sh.items) && sh.items.length > 0) || (Number(sh.total_units) > 0);
  return hasItems;
};

/**
 * Filters shipments to only include active outbound manifests (Shipped or Pending).
 */
export const filterActiveOutboundShipments = (shipments = []) => {
  if (!Array.isArray(shipments)) return [];
  return shipments.filter(isShipmentActive);
};

/**
 * Calculates the total parts in queue across active drafts and active outbound shipments.
 * Completely excludes parts from received shipments.
 */
export const calculateActiveQueuePartsCount = (activePackDraft = null, activeShipments = []) => {
  let count = 0;
  const countedSerials = new Set();

  if (activePackDraft?.items && Array.isArray(activePackDraft.items)) {
    activePackDraft.items.forEach(it => {
      const s = String(it.serial_number || it.serialNumber || it.serial || '').trim().toUpperCase();
      if (s) {
        if (!countedSerials.has(s)) {
          countedSerials.add(s);
          count++;
        }
      } else {
        count++;
      }
    });
  }

  (activeShipments || []).forEach(sh => {
    if (Array.isArray(sh.items) && sh.items.length > 0) {
      sh.items.forEach(it => {
        const s = String(it.serial_number || it.serialNumber || it.serial || '').trim().toUpperCase();
        if (s) {
          if (!countedSerials.has(s)) {
            countedSerials.add(s);
            count++;
          }
        } else {
          count++;
        }
      });
    } else if (Number(sh.total_units) > 0) {
      count += Number(sh.total_units);
    }
  });

  return count;
};


/**
 * Detects whether a shipment is destined for a Metro Manila ASP site.
 * Excludes DC Central Warehouse.
 */
export const isShipmentMetroManila = (sh, sitesList = []) => {
  if (!sh) return false;
  const site = resolveSite(sh.site_id || sh.site_name, sitesList);
  if (!site) return false;
  if (site.is_dc || site.code === 'DC-MDC' || site.code === 'DC') return false;
  const reg = (site.region || '').trim().toLowerCase();
  if (reg === 'metro manila' || reg === 'ncr') return true;
  if (reg && reg !== 'metro manila' && reg !== 'ncr') return false;
  return !isProvincialSite(site);
};

/**
 * Detects whether a shipment is destined for a Provincial branch.
 * Excludes DC Central Warehouse and Metro Manila sites.
 */
export const isShipmentProvince = (sh, sitesList = []) => {
  if (!sh) return false;
  const site = resolveSite(sh.site_id || sh.site_name, sitesList);
  if (!site) return false;
  if (site.is_dc || site.code === 'DC-MDC' || site.code === 'DC') return false;
  return !isShipmentMetroManila(sh, sitesList);
};

/**
 * Extracts clean, trimmed, uppercased serial numbers from a shipment's items array.
 * Filters out empty or missing serial values.
/**
 * Checks if a part number is missing, placeholder, or unknown
 */
export const isUnknownPn = (pn) => {
  if (!pn || typeof pn !== 'string') return true;
  const clean = pn.trim().toUpperCase();
  return !clean || clean === 'UNKNOWN-PN' || clean === 'UNKNOWN' || clean === 'N/A' || clean === 'NA';
};

/**
 * Checks if a description is missing, placeholder, or generic
 */
export const isUnknownDesc = (desc) => {
  if (!desc || typeof desc !== 'string') return true;
  const clean = desc.trim().toLowerCase();
  return !clean || clean === 'part description' || clean === 'service part' || clean === 'n/a' || clean === 'na';
};

/**
 * Normalizes DC part numbers and descriptions to enforce DC inventory rules:
 * - MobileCare DC does NOT stock or ship "iPhone 13 mini" (only iPhone 13 and up models).
 * - Part 661-22374 is normalized to 661-21991 (Battery, iPhone 13).
 * - Part 661-22311 is normalized to 661-21988 (Display, iPhone 13).
 * - Any "iPhone 13 mini" designation is cleaned to "iPhone 13".
 */
export const normalizeDcPartDetails = (pn, desc) => {
  let cleanPn = pn ? String(pn).trim().toUpperCase() : pn;
  let cleanDesc = desc ? String(desc).trim() : desc;

  if (cleanPn === '661-22374') {
    cleanPn = '661-21991';
    if (!cleanDesc || isUnknownDesc(cleanDesc) || /mini/i.test(cleanDesc)) {
      cleanDesc = 'Battery, iPhone 13';
    }
  } else if (cleanPn === '661-22311') {
    cleanPn = '661-21988';
    if (!cleanDesc || isUnknownDesc(cleanDesc) || /mini/i.test(cleanDesc)) {
      cleanDesc = 'Display, iPhone 13';
    }
  }

  if (cleanDesc && /iPhone 13 mini/i.test(cleanDesc)) {
    cleanDesc = cleanDesc.replace(/iPhone 13 mini/gi, 'iPhone 13');
    if (cleanPn === '661-22374') {
      cleanPn = '661-21991';
    }
  }

  return { part_number: cleanPn, description: cleanDesc };
};

/**
 * Builds a unified serial number lookup dictionary across all available system sources:
 * - dcIntakeRecords (direct intake table)
 * - inventoryUnits (active/historical units)
 * - parts catalog & masterlistData
 * - savedRecords (master_dc_intakes_registry and intake batches)
 * - shipments (historical manifests with valid items)
 */
export const buildSerialDictionary = ({
  dcIntakeRecords = [],
  inventoryUnits = [],
  parts = [],
  masterlistData = [],
  savedRecords = [],
  shipments = []
} = {}) => {
  const serialDict = new Map();
  const partsMapByPn = new Map();
  const partsMapById = new Map();

  // 1. Index parts catalog
  if (Array.isArray(parts)) {
    parts.forEach(p => {
      if (!p) return;
      if (p.id) partsMapById.set(String(p.id).trim().toLowerCase(), p);
      const norm = normalizeDcPartDetails(p.part_number, p.description);
      const pn = String(norm.part_number || '').trim().toUpperCase();
      if (pn && !isUnknownPn(pn)) {
        if (!partsMapByPn.has(pn) || (!isUnknownDesc(norm.description) && isUnknownDesc(partsMapByPn.get(pn)?.description))) {
          partsMapByPn.set(pn, { ...p, part_number: norm.part_number, description: norm.description });
        }
      }
      if (String(p.part_number).trim().toUpperCase() === '661-22374') {
        partsMapByPn.set('661-22374', { ...p, part_number: '661-21991', description: 'Battery, iPhone 13' });
      }
    });
  }

  // 2. Index masterlist data if available
  if (Array.isArray(masterlistData)) {
    masterlistData.forEach(p => {
      if (!p) return;
      const norm = normalizeDcPartDetails(p.part_number, p.description);
      const pn = String(norm.part_number || '').trim().toUpperCase();
      if (pn && !isUnknownPn(pn) && !partsMapByPn.has(pn)) {
        partsMapByPn.set(pn, { ...p, part_number: norm.part_number, description: norm.description });
      }
    });
  }

  const registerSerial = (rawSerial, pn, desc, cost, partId) => {
    const sn = String(rawSerial || '').trim().toUpperCase();
    if (!sn) return;

    const norm = normalizeDcPartDetails(pn, desc);
    const existing = serialDict.get(sn);
    const validPn = !isUnknownPn(norm.part_number) ? String(norm.part_number).trim().toUpperCase() : existing?.part_number;
    
    // Resolve description from part catalog if desc is unknown
    let validDesc = !isUnknownDesc(norm.description) ? String(norm.description).trim() : existing?.description;
    if (isUnknownDesc(validDesc) && validPn && partsMapByPn.has(validPn)) {
      validDesc = partsMapByPn.get(validPn)?.description;
    }

    const validCost = (cost !== undefined && cost !== null && Number(cost) > 0) ? Number(cost) : existing?.cost;
    const validPartId = partId || existing?.part_id;

    if (validPn || validDesc) {
      const finalNorm = normalizeDcPartDetails(validPn, validDesc);
      serialDict.set(sn, {
        part_number: finalNorm.part_number,
        description: finalNorm.description,
        cost: validCost,
        part_id: validPartId
      });
    }
  };

  // 3. Index dcIntakeRecords (Authoritative intake records)
  if (Array.isArray(dcIntakeRecords)) {
    dcIntakeRecords.forEach(rec => {
      const items = Array.isArray(rec?.items) ? rec.items : (Array.isArray(rec?.snapshot_data?.items) ? rec.snapshot_data.items : []);
      items.forEach(it => {
        if (!it) return;
        const rawPart = it.part_id ? partsMapById.get(String(it.part_id).trim().toLowerCase()) : null;
        registerSerial(
          it.serial_number || it.serialNumber || it.serial,
          it.part_number || it.partNumber || rawPart?.part_number,
          it.description || it.partDescription || rawPart?.description,
          it.cost || it.stocking_price || it.price || rawPart?.stocking_price,
          it.part_id || rawPart?.id
        );
      });
    });
  }

  // 4. Index savedRecords for any intake batches or registry
  if (Array.isArray(savedRecords)) {
    savedRecords.forEach(r => {
      if (!r) return;
      if (r.id === 'master_dc_intakes_registry' && Array.isArray(r.snapshot_data?.records)) {
        r.snapshot_data.records.forEach(rec => {
          if (Array.isArray(rec?.items)) {
            rec.items.forEach(it => {
              registerSerial(
                it.serial_number,
                it.part_number,
                it.description,
                it.cost || it.stocking_price || it.price,
                it.part_id
              );
            });
          }
        });
      } else if (r.record_type === 'intake_batch' || r.record_type === 'intake_record') {
        const items = Array.isArray(r.items) ? r.items : (Array.isArray(r.snapshot_data?.items) ? r.snapshot_data.items : []);
        items.forEach(it => {
          registerSerial(
            it.serial_number,
            it.part_number,
            it.description,
            it.cost || it.stocking_price || it.price,
            it.part_id
          );
        });
      }
    });
  }

  // 5. Index inventoryUnits
  if (Array.isArray(inventoryUnits)) {
    inventoryUnits.forEach(u => {
      if (!u) return;
      const rawPart = u.part_id ? partsMapById.get(String(u.part_id).trim().toLowerCase()) : null;
      registerSerial(
        u.serial_number,
        u.part_number || rawPart?.part_number,
        u.description || rawPart?.description,
        u.stocking_price || u.price || rawPart?.stocking_price,
        u.part_id || rawPart?.id
      );
    });
  }

  // 6. Index any existing shipments that already have authentic part details
  if (Array.isArray(shipments)) {
    shipments.forEach(s => {
      if (Array.isArray(s?.items)) {
        s.items.forEach(it => {
          if (!it) return;
          if (!isUnknownPn(it.part_number) || !isUnknownDesc(it.description)) {
            registerSerial(
              it.serial_number || it.serialNumber || it.serial,
              it.part_number || it.partNumber,
              it.description || it.partDescription,
              it.cost,
              it.part_id
            );
          }
        });
      }
    });
  }

  return { serialDict, partsMapByPn, partsMapById };
};

/**
 * Heals a single shipment item by restoring missing/unknown part_number and description
 */
export const healShipmentItem = (item, serialDict, partsMapByPn) => {
  if (!item) return item;
  const sn = String(item.serial_number || item.serialNumber || item.serial || '').trim().toUpperCase();
  const currentPn = item.part_number || item.partNumber;
  const currentDesc = item.description || item.partDescription;
  
  const hasValidPn = !isUnknownPn(currentPn);
  const hasValidDesc = !isUnknownDesc(currentDesc);

  let healedPn = currentPn;
  let healedDesc = currentDesc;
  let healedCost = item.cost || 0;

  if (hasValidPn && hasValidDesc) {
    const norm = normalizeDcPartDetails(currentPn, currentDesc);
    healedPn = norm.part_number;
    healedDesc = norm.description;
  } else {
    const lookup = sn && serialDict ? serialDict.get(sn) : null;
    healedPn = hasValidPn ? currentPn : (lookup?.part_number || currentPn || 'UNKNOWN-PN');
    
    healedDesc = hasValidDesc ? currentDesc : (lookup?.description || currentDesc);
    if (isUnknownDesc(healedDesc) && !isUnknownPn(healedPn) && partsMapByPn) {
      healedDesc = partsMapByPn.get(healedPn)?.description || healedDesc;
    }
    if (isUnknownDesc(healedDesc)) {
      healedDesc = 'Part Description';
    }

    healedCost = item.cost || lookup?.cost || 0;

    const norm = normalizeDcPartDetails(healedPn, healedDesc);
    healedPn = norm.part_number;
    healedDesc = norm.description;
  }

  const finalNorm = normalizeDcPartDetails(healedPn, healedDesc);

  return {
    ...item,
    part_number: finalNorm.part_number,
    description: finalNorm.description,
    cost: healedCost
  };
};

/**
 * Extracts clean, trimmed, uppercased serial numbers from a shipment's items array.
 * Filters out empty or missing serial values.
 */
export const extractShipmentSerials = (shipment) => {
  if (!shipment || !Array.isArray(shipment.items)) return [];
  return shipment.items
    .map(it => String(it.serial_number || it.serialNumber || it.serial || '').trim().toUpperCase())
    .filter(Boolean);
};

/**
 * Formats extracted serial numbers for direct plain-text clipboard insertion.
 * Formats:
 * - 'lines': 1 serial per line (Standard for Apple GSX Bulk & Fixably Transfer)
 * - 'csv': Comma-separated serial numbers
 * - 'tsv': Tab-separated spreadsheet table including Part # and Box #
 */
export const formatSerialsForExport = (shipment, format = 'lines', serialDict = null, partsMapByPn = null) => {
  if (!shipment) return '';
  const serials = extractShipmentSerials(shipment);
  if (serials.length === 0) return '';

  if (format === 'lines') {
    return serials.join('\n');
  }

  if (format === 'csv') {
    return serials.join(', ');
  }

  if (format === 'tsv') {
    const rows = (shipment.items || []).map((it, idx) => {
      const healed = (serialDict || partsMapByPn) ? healShipmentItem(it, serialDict, partsMapByPn) : it;
      const pn = healed.part_number || healed.partNumber || 'N/A';
      const desc = healed.description || healed.partDescription || '';
      const sn = String(healed.serial_number || healed.serialNumber || healed.serial || '').trim().toUpperCase();
      const box = healed.box_number ? `${healed.box_number}/${shipment.total_boxes || 1}` : '1/1';
      return `${idx + 1}\t${pn}\t${desc}\t${sn}\t${box}`;
    });
    return `NO\tPART NUMBER\tDESCRIPTION\tSERIAL NUMBER\tBOX #\n${rows.join('\n')}`;
  }

  return serials.join('\n');
};

