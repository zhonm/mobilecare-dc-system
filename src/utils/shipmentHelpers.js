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
  if (Boolean(sh.received_confirmed_at || sh.received_at || sh.received_date)) {
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
export const formatSerialsForExport = (shipment, format = 'lines') => {
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
      const pn = it.part_number || it.partNumber || 'N/A';
      const desc = it.description || it.partDescription || '';
      const sn = String(it.serial_number || it.serialNumber || it.serial || '').trim().toUpperCase();
      const box = it.box_number ? `${it.box_number}/${shipment.total_boxes || 1}` : '1/1';
      return `${idx + 1}\t${pn}\t${desc}\t${sn}\t${box}`;
    });
    return `NO\tPART NUMBER\tDESCRIPTION\tSERIAL NUMBER\tBOX #\n${rows.join('\n')}`;
  }

  return serials.join('\n');
};
