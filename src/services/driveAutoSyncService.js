/**
 * Automated Google Drive Archiving Service for MDC DC System
 * 
 * Handles automatic background archiving of:
 * 1. Packing Lists when marked "Pending for Pickup by Rider" (with date & time in filename).
 * 2. Forecasting & Master Allocation XLSX workbooks upon Masterlist Ingestion.
 */

import { uploadToGoogleDrive, getOrCreateFolder, GOOGLE_DRIVE_CONFIG } from './googleDriveService.js';
import { generatePackingListPDF } from '../utils/pdfGenerator.js';
import { exportForecastToExcel, exportAllocationToExcel } from '../utils/excelParser.js';

const pad = (n) => String(n).padStart(2, '0');

export function getFormattedSaveTimestamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}${min}`;
}

/**
 * Automatically archives a Packing List PDF to Google Drive when marked Pending for Pickup
 * 
 * @param {Object} shipment - The shipment object
 * @param {Array} items - Items in the shipment
 * @param {Object} site - Destination branch/site object
 * @param {Object} options - Supervisor and guard options
 * @returns {Promise<{ success: boolean, fileId?: string, webViewLink?: string, filename?: string, error?: string }>}
 */
export async function autoArchivePackingListToDrive(shipment, items = [], site = {}, options = {}) {
  try {
    const timestampStr = getFormattedSaveTimestamp();
    const invoiceRef = String(shipment.invoice_ref || shipment.shipment_number || 'DRAFT').replace(/[/\\:*?"<>|]/g, '_');
    const filename = `PackingList_${invoiceRef}_${timestampStr}.pdf`;
    const sourceItems = (items && items.length > 0) ? items : (shipment.items || []);

    const { doc } = generatePackingListPDF(shipment, sourceItems, site, {
      ...options,
      includeDeclarationForm: true,
      saveFile: false
    });

    const pdfBlob = doc.output('blob');

    const result = await uploadToGoogleDrive({
      name: filename,
      mimeType: 'application/pdf',
      data: pdfBlob,
      folderType: 'shipments'
    });

    return {
      ...result,
      filename
    };
  } catch (err) {
    console.error('[Google Drive] Auto-archive packing list error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Automatically archives both Forecasting and Master Allocation XLSX workbooks to Google Drive upon dataset import
 * 
 * @param {Object} params
 * @param {Array} params.forecastItems - Computed forecasting items
 * @param {Array} params.allocations - Computed allocation matrix
 * @param {Array} params.sites - Ordered sites array
 * @param {string} params.periodLabel - Target month/period (e.g. "October 2026")
 * @param {Function} [params.onProgress] - Optional progress callback
 * @returns {Promise<{ success: boolean, forecastResult?: Object, allocationResult?: Object, error?: string }>}
 */
export async function autoArchiveDatasetToDrive({
  forecastItems = [],
  allocations = [],
  sites = [],
  periodLabel = 'October 2026',
  onProgress
}) {
  try {
    const timestampStr = getFormattedSaveTimestamp();
    const cleanPeriod = periodLabel.replace(/[\s/\\:]+/g, '_');

    // 1. Generate & Upload Forecasting XLSX
    if (onProgress) onProgress({ stage: 'forecasting', message: 'Generating & uploading Demand Forecasting (.xlsx) to Drive...' });
    const forecastFileName = `Demand_Forecast_${cleanPeriod}_${timestampStr}.xlsx`;
    const { buffer: forecastBuffer } = await exportForecastToExcel(forecastItems, periodLabel, { saveFile: false });
    
    const forecastResult = await uploadToGoogleDrive({
      name: forecastFileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: forecastBuffer,
      folderType: 'forecasting'
    });

    // 2. Generate & Upload Master Allocation XLSX
    if (onProgress) onProgress({ stage: 'allocation', message: 'Generating & uploading Master Allocation (.xlsx) to Drive...' });
    const allocFileName = `Master_Allocation_${cleanPeriod}_${timestampStr}.xlsx`;
    const { buffer: allocBuffer } = await exportAllocationToExcel(allocations, sites, periodLabel, { saveFile: false });

    const allocationResult = await uploadToGoogleDrive({
      name: allocFileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: allocBuffer,
      folderType: 'allocation'
    });

    if (onProgress) onProgress({ stage: 'completed', message: 'Successfully archived to Google Drive!' });

    return {
      success: forecastResult.success && allocationResult.success,
      forecastResult,
      allocationResult
    };
  } catch (err) {
    console.error('[Google Drive] Auto-archive dataset error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Resolves standard PMG site folder name (e.g. "LIMA", "BHS", "GB3", "CEBU")
 */
export function resolvePmgSiteFolderName(siteOrCode) {
  if (!siteOrCode) return 'BRANCH';
  let raw = '';
  if (typeof siteOrCode === 'string') {
    raw = siteOrCode;
  } else if (typeof siteOrCode === 'object' && siteOrCode !== null) {
    raw = siteOrCode.name || siteOrCode.code || siteOrCode.destination_site_name || siteOrCode.site_name || '';
  }
  const clean = raw.trim().toUpperCase();

  if (clean.includes('LIMA') || clean === 'ASP LIM' || clean === 'LIM') return 'LIMA';
  if (clean.includes('BONIFACIO') || clean === 'APP BHS' || clean === 'BHS') return 'BHS';
  if (clean.includes('GREENBELT') || clean === 'APP GB3' || clean === 'GB3') return 'GB3';
  if (clean.includes('POWER PLANT') || clean.includes('ROCKWELL') || clean === 'APP PPM' || clean === 'PPM') return 'PPM';
  if (clean.includes('GLORIETTA') || clean === 'ASP GL5' || clean === 'GL5') return 'GL5';
  if (clean.includes("S'MAISON") || clean.includes('S MAISON') || clean === 'ASP SMS' || clean === 'SMS') return 'SMS';
  if (clean.includes('MALL OF ASIA') || clean === 'APP MOA' || clean === 'MOA') return 'MOA';
  if (clean.includes('PODIUM') || clean === 'ASP POD' || clean === 'POD') return 'PODIUM';
  if (clean.includes('MEGAMALL') || clean === 'APP MEG' || clean === 'MEG') return 'MEGAMALL';
  if (clean.includes('ANNEX') || clean === 'APP ANX' || clean === 'ANX') return 'ANNEX';
  if (clean.includes('TRINOMA') || clean === 'APP TRI' || clean === 'TRI') return 'TRINOMA';
  if (clean.includes('VERTIS') || clean === 'ASP VN' || clean === 'VN') return 'VERTIS NORTH';
  if (clean.includes('NORTHEAST') || clean === 'ASP NES' || clean === 'NES') return 'NORTHEAST SQUARE';
  if (clean.includes('FESTIVAL') || clean === 'APP FES' || clean === 'FES') return 'FESTIVAL MALL';
  if (clean.includes('MARIKINA') || clean === 'ASP MRK' || clean === 'MRK') return 'MARIKINA';
  if (clean.includes('MAGNOLIA') || clean === 'APP RM' || clean === 'RM') return 'MAGNOLIA';
  if (clean.includes('NEWPOINT') || clean === 'ASP NPM' || clean === 'NPM') return 'NEWPOINT';
  if (clean.includes('NAGA') || clean === 'ASP NAG' || clean === 'NAG') return 'NAGA';
  if (clean.includes('LA UNION') || clean === 'ASP LAU' || clean === 'LAU') return 'LA UNION';
  if (clean.includes('ILOILO') || clean === 'ASP ILO' || clean === 'ILO') return 'ILOILO';
  if (clean.includes('CEBU') || clean === 'ASP CEB' || clean === 'CEB') return 'CEBU';
  if (clean.includes('ZAMBOANGA') || clean === 'ASP ZAM' || clean === 'ZAM') return 'ZAMBOANGA';
  if (clean.includes('DAVAO') || clean.includes('ABREEZA') || clean === 'ASP ABR' || clean === 'ABR' || clean === 'ASP DVO' || clean === 'DVO') return 'DAVAO';
  if (clean.includes('COTABATO') || clean === 'ASP COT' || clean === 'COT') return 'COTABATO';
  if (clean.includes('CAGAYAN') || clean === 'ASP CDO' || clean === 'CDO') return 'CDO';
  if (clean.includes('BAGUIO') || clean === 'ASP BAG' || clean === 'BAG') return 'BAGUIO';
  if (clean.includes('LANANG') || clean === 'APP LAN' || clean === 'LAN') return 'LANANG';

  // Fallback: extract short code by removing common prefixes
  const stripped = clean.replace(/^(ASP|APP|MOBILECARE\s*-\s*|SITE-)\s*/i, '').trim();
  return stripped.replace(/[/\\:*?"<>|]/g, '_') || 'BRANCH';
}

/**
 * Uploads a PMG Signed Packing List to Google Drive inside 'DC- MSPI- PACKING LIST' / [SITE]
 * 
 * @param {Object} params
 * @param {File|Blob|ArrayBuffer|string} params.file - The uploaded signed PL file (PDF, image, etc.)
 * @param {Object} params.shipment - The shipment being confirmed
 * @param {Object} [params.site] - Destination/receiving site
 * @param {string} [params.receivedByName] - Name of the PMG staff signing/receiving
 * @returns {Promise<{ success: boolean, fileId?: string, webViewLink?: string, filename?: string, siteFolder?: string, error?: string }>}
 */
export async function uploadPmgSignedPackingListToDrive({
  file,
  shipment,
  site = {}
}) {
  try {
    const rootFolderId = GOOGLE_DRIVE_CONFIG.folders.pmg_signed_pl || '1ltAwtMav9hGaJTvEJpVqnv72_S41ODaW';

    // 1. Resolve site folder name (e.g. "LIMA")
    const siteFolderName = resolvePmgSiteFolderName(site || shipment?.site_name || shipment?.site_id);

    // 2. Get or create site subfolder inside "DC- MSPI- PACKING LIST"
    const siteFolderId = await getOrCreateFolder(rootFolderId, siteFolderName);

    // 3. Format timestamp and filename
    const timestampStr = getFormattedSaveTimestamp();
    const invoiceRef = String(shipment.invoice_ref || shipment.shipment_number || 'PL').replace(/[/\\:*?"<>|]/g, '_');
    
    let ext = 'pdf';
    let mimeType = 'application/pdf';
    if (file && typeof file === 'object') {
      if (file.name && file.name.includes('.')) {
        ext = file.name.split('.').pop().toLowerCase();
      }
      mimeType = file.type || (ext === 'pdf' ? 'application/pdf' : (ext === 'png' ? 'image/png' : 'image/jpeg'));
    }

    const filename = `Signed_PackingList_${invoiceRef}_${timestampStr}.${ext}`;

    // 4. Upload file directly into siteFolderId (useDateFolder: false to store directly inside site folder)
    const result = await uploadToGoogleDrive({
      name: filename,
      mimeType,
      data: file,
      folderId: siteFolderId,
      useDateFolder: false
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to upload signed packing list to Google Drive');
    }

    return {
      success: true,
      fileId: result.fileId,
      webViewLink: result.webViewLink,
      filename,
      siteFolder: siteFolderName
    };
  } catch (err) {
    console.error('[Google Drive] uploadPmgSignedPackingListToDrive error:', err);
    return {
      success: false,
      error: err.message
    };
  }
}

