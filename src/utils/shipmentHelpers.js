import { resolveSite } from './appContextHelpers.js';
import { isProvincialSite } from './partResolver.js';

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
