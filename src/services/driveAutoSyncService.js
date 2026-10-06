/**
 * Automated Google Drive Archiving Service for MDC DC System
 * 
 * Handles automatic background archiving of:
 * 1. Packing Lists when marked "Pending for Pickup by Rider" (with date & time in filename).
 * 2. Forecasting & Master Allocation XLSX workbooks upon Masterlist Ingestion.
 */

import { uploadToGoogleDrive, getOrCreateFolder, GOOGLE_DRIVE_CONFIG, listFilesInDriveFolder, isGoogleDriveConfigured } from './googleDriveService.js';
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
 * Persists a client-side backup receipt in localStorage for instantaneous status recovery
 */
export function saveLocalDriveBackupReceipt(periodLabel, { forecastResult, allocationResult }) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const cleanPeriod = String(periodLabel || '').trim();
    const key = `mdc_drive_dataset_backup_${cleanPeriod.replace(/[\s/\\:]+/g, '_')}`;
    const payload = {
      periodLabel: cleanPeriod,
      timestamp: new Date().toISOString(),
      forecasting: forecastResult?.success ? {
        uploaded: true,
        fileName: forecastResult.name,
        fileId: forecastResult.fileId,
        webViewLink: forecastResult.webViewLink || (forecastResult.fileId ? `https://drive.google.com/file/d/${forecastResult.fileId}/view` : null),
        updatedTime: new Date().toISOString()
      } : { uploaded: false },
      allocation: allocationResult?.success ? {
        uploaded: true,
        fileName: allocationResult.name,
        fileId: allocationResult.fileId,
        webViewLink: allocationResult.webViewLink || (allocationResult.fileId ? `https://drive.google.com/file/d/${allocationResult.fileId}/view` : null),
        updatedTime: new Date().toISOString()
      } : { uploaded: false }
    };
    localStorage.setItem(key, JSON.stringify(payload));
    return payload;
  } catch (_) {
    return null;
  }
}

/**
 * Retrieves the cached local backup receipt for a given period
 */
export function getLocalDriveBackupReceipt(periodLabel) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const cleanPeriod = String(periodLabel || '').trim();
    const key = `mdc_drive_dataset_backup_${cleanPeriod.replace(/[\s/\\:]+/g, '_')}`;
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Automatically archives both Forecasting and Master Allocation XLSX workbooks to Google Drive
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
    const cleanPeriod = String(periodLabel || 'Current_Period').replace(/[\s/\\:]+/g, '_');

    let forecastResult = null;
    let allocationResult = null;

    // 1. Generate & Upload Forecasting XLSX (if items exist)
    if (forecastItems && forecastItems.length > 0) {
      if (onProgress) onProgress({ stage: 'forecasting', message: 'Generating & uploading Demand Forecasting (.xlsx) to Drive...' });
      const forecastFileName = `Demand_Forecast_${cleanPeriod}_${timestampStr}.xlsx`;
      const { buffer: forecastBuffer } = await exportForecastToExcel(forecastItems, periodLabel, { saveFile: false });
      
      forecastResult = await uploadToGoogleDrive({
        name: forecastFileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: forecastBuffer,
        folderType: 'forecasting'
      });
    } else {
      forecastResult = { success: true, skipped: true, name: 'No forecast items' };
    }

    // 2. Generate & Upload Master Allocation XLSX (if items exist)
    if (allocations && allocations.length > 0) {
      if (onProgress) onProgress({ stage: 'allocation', message: 'Generating & uploading Master Allocation (.xlsx) to Drive...' });
      const allocFileName = `Master_Allocation_${cleanPeriod}_${timestampStr}.xlsx`;
      const { buffer: allocBuffer } = await exportAllocationToExcel(allocations, sites, periodLabel, { saveFile: false });

      allocationResult = await uploadToGoogleDrive({
        name: allocFileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: allocBuffer,
        folderType: 'allocation'
      });
    } else {
      allocationResult = { success: true, skipped: true, name: 'No allocation items' };
    }

    if (onProgress) onProgress({ stage: 'completed', message: 'Successfully archived to Google Drive!' });

    // Persist local receipt
    saveLocalDriveBackupReceipt(periodLabel, { forecastResult, allocationResult });

    return {
      success: Boolean(forecastResult?.success && allocationResult?.success),
      forecastResult,
      allocationResult
    };
  } catch (err) {
    console.error('[Google Drive] Auto-archive dataset error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Checks whether Forecasting and Allocation data for a specified month has been uploaded to Google Drive
 * 
 * @param {string} periodLabel - Month label (e.g. "October 2026")
 * @returns {Promise<{
 *   isConfigured: boolean,
 *   checked: boolean,
 *   periodLabel: string,
 *   forecasting: { uploaded: boolean, file?: Object, fileName?: string, webViewLink?: string, updatedTime?: string },
 *   allocation: { uploaded: boolean, file?: Object, fileName?: string, webViewLink?: string, updatedTime?: string },
 *   allUploaded: boolean,
 *   error?: string
 * }>}
 */
export async function checkDriveDatasetStatusForPeriod(periodLabel = 'October 2026') {
  const cleanPeriod = String(periodLabel || 'Current Period').trim();
  const normalizedPeriod = cleanPeriod.replace(/[\s/\\:]+/g, '_');
  const isConfigured = isGoogleDriveConfigured();

  // Extract month and year components (e.g. "October" and "2026")
  const parts = cleanPeriod.split(/[\s_/-]+/);
  const monthWord = parts.find(p => /^[a-zA-Z]+$/.test(p))?.toLowerCase() || '';
  const yearDigits = parts.find(p => /^\d{4}$/.test(p)) || '';

  // Local cached receipt fallback
  const localReceipt = getLocalDriveBackupReceipt(cleanPeriod);

  if (!isConfigured) {
    const hasForecast = Boolean(localReceipt?.forecasting?.uploaded);
    const hasAlloc = Boolean(localReceipt?.allocation?.uploaded);
    return {
      isConfigured: false,
      checked: true,
      period: cleanPeriod,
      periodLabel: cleanPeriod,
      forecasting: localReceipt?.forecasting ? { ...localReceipt.forecasting, latestFile: { name: localReceipt.forecasting.fileName, webViewLink: localReceipt.forecasting.webViewLink } } : { uploaded: false },
      allocation: localReceipt?.allocation ? { ...localReceipt.allocation, latestFile: { name: localReceipt.allocation.fileName, webViewLink: localReceipt.allocation.webViewLink } } : { uploaded: false },
      allUploaded: Boolean(hasForecast && hasAlloc),
      anyUploaded: Boolean(hasForecast || hasAlloc)
    };
  }

  try {
    const [forecastFiles, allocFiles] = await Promise.all([
      listFilesInDriveFolder('forecasting', 40),
      listFilesInDriveFolder('allocation', 40)
    ]);

    const isMatch = (file) => {
      if (!file || !file.name) return false;
      const lower = file.name.toLowerCase();
      if (lower.includes(normalizedPeriod.toLowerCase()) || lower.includes(cleanPeriod.toLowerCase())) {
        return true;
      }
      if (monthWord && yearDigits && lower.includes(monthWord) && lower.includes(yearDigits)) {
        return true;
      }
      return false;
    };

    const matchingForecast = (forecastFiles || []).find(isMatch);
    const matchingAlloc = (allocFiles || []).find(isMatch);

    const forecastStatus = matchingForecast ? {
      uploaded: true,
      file: matchingForecast,
      fileName: matchingForecast.name,
      fileId: matchingForecast.id,
      webViewLink: matchingForecast.webViewLink || `https://drive.google.com/file/d/${matchingForecast.id}/view`,
      updatedTime: matchingForecast.createdTime || matchingForecast.modifiedTime || new Date().toISOString()
    } : (localReceipt?.forecasting?.uploaded ? localReceipt.forecasting : { uploaded: false });

    const allocStatus = matchingAlloc ? {
      uploaded: true,
      file: matchingAlloc,
      fileName: matchingAlloc.name,
      fileId: matchingAlloc.id,
      webViewLink: matchingAlloc.webViewLink || `https://drive.google.com/file/d/${matchingAlloc.id}/view`,
      updatedTime: matchingAlloc.createdTime || matchingAlloc.modifiedTime || new Date().toISOString()
    } : (localReceipt?.allocation?.uploaded ? localReceipt.allocation : { uploaded: false });

    // Update local cache if files found in cloud
    if (matchingForecast || matchingAlloc) {
      saveLocalDriveBackupReceipt(cleanPeriod, {
        forecastResult: forecastStatus.uploaded ? { success: true, name: forecastStatus.fileName, fileId: forecastStatus.fileId, webViewLink: forecastStatus.webViewLink } : null,
        allocationResult: allocStatus.uploaded ? { success: true, name: allocStatus.fileName, fileId: allocStatus.fileId, webViewLink: allocStatus.webViewLink } : null
      });
    }

    const forecastReturn = {
      ...forecastStatus,
      latestFile: matchingForecast || (forecastStatus.uploaded ? { name: forecastStatus.fileName, webViewLink: forecastStatus.webViewLink } : null)
    };
    const allocReturn = {
      ...allocStatus,
      latestFile: matchingAlloc || (allocStatus.uploaded ? { name: allocStatus.fileName, webViewLink: allocStatus.webViewLink } : null)
    };

    return {
      isConfigured: true,
      checked: true,
      period: cleanPeriod,
      periodLabel: cleanPeriod,
      forecasting: forecastReturn,
      allocation: allocReturn,
      allUploaded: Boolean(forecastStatus.uploaded && allocStatus.uploaded),
      anyUploaded: Boolean(forecastStatus.uploaded || allocStatus.uploaded)
    };
  } catch (err) {
    console.warn('[Google Drive] Status check error:', err);
    const hasForecast = Boolean(localReceipt?.forecasting?.uploaded);
    const hasAlloc = Boolean(localReceipt?.allocation?.uploaded);
    return {
      isConfigured: true,
      checked: true,
      period: cleanPeriod,
      periodLabel: cleanPeriod,
      forecasting: localReceipt?.forecasting ? { ...localReceipt.forecasting, latestFile: { name: localReceipt.forecasting.fileName, webViewLink: localReceipt.forecasting.webViewLink } } : { uploaded: false },
      allocation: localReceipt?.allocation ? { ...localReceipt.allocation, latestFile: { name: localReceipt.allocation.fileName, webViewLink: localReceipt.allocation.webViewLink } } : { uploaded: false },
      allUploaded: Boolean(hasForecast && hasAlloc),
      anyUploaded: Boolean(hasForecast || hasAlloc),
      error: err.message
    };
  }
}

/**
 * Resolves standard PMG site folder name (e.g. "LIMA", "BHS", "GB3", "CEBU")
 */
export function resolvePmgSiteFolderName(siteOrCode) {
  if (!siteOrCode) return 'BRANCH';
  let rawName = '';
  let rawCode = '';

  if (typeof siteOrCode === 'string') {
    rawName = siteOrCode;
    rawCode = siteOrCode;
  } else if (typeof siteOrCode === 'object' && siteOrCode !== null) {
    rawName = siteOrCode.name || siteOrCode.destination_site_name || siteOrCode.site_name || '';
    rawCode = siteOrCode.code || siteOrCode.destination_site_code || siteOrCode.site_code || '';
  }

  const clean = `${rawName} ${rawCode}`.trim().toUpperCase();

  if (clean.includes('LIMA') || clean.includes('ASP LIM')) return 'LIMA';
  if (clean.includes('BONIFACIO') || clean.includes('APP BHS')) return 'BHS';
  if (clean.includes('GREENBELT') || clean.includes('APP GB3')) return 'GB3';
  if (clean.includes('POWER PLANT') || clean.includes('ROCKWELL') || clean.includes('APP PPM')) return 'PPM';
  if (clean.includes('GLORIETTA') || clean.includes('ASP GL5')) return 'GL5';
  if (clean.includes("S'MAISON") || clean.includes('S MAISON') || clean.includes('ASP SMS')) return 'SMS';
  if (clean.includes('MALL OF ASIA') || clean.includes('APP MOA')) return 'MOA';
  if (clean.includes('PODIUM') || clean.includes('ASP POD')) return 'PODIUM';
  if (clean.includes('MEGAMALL') || clean.includes('APP MEG')) return 'MEGAMALL';
  if (clean.includes('ANNEX') || clean.includes('APP ANX')) return 'ANNEX';
  if (clean.includes('TRINOMA') || clean.includes('APP TRI')) return 'TRINOMA';
  if (clean.includes('VERTIS') || clean.includes('ASP VN')) return 'VERTIS NORTH';
  if (clean.includes('NORTHEAST') || clean.includes('ASP NES')) return 'NORTHEAST SQUARE';
  if (clean.includes('FESTIVAL') || clean.includes('APP FES')) return 'FESTIVAL MALL';
  if (clean.includes('MARIKINA') || clean.includes('ASP MRK')) return 'MARIKINA';
  if (clean.includes('MAGNOLIA') || clean.includes('APP RM')) return 'MAGNOLIA';
  if (clean.includes('NEWPOINT') || clean.includes('ASP NPM')) return 'NEWPOINT';
  if (clean.includes('NAGA') || clean.includes('ASP NAG')) return 'NAGA';
  if (clean.includes('LA UNION') || clean.includes('ASP LAU')) return 'LA UNION';
  if (clean.includes('ILOILO') || clean.includes('ASP ILO')) return 'ILOILO';
  if (clean.includes('CEBU') || clean.includes('ASP CEB')) return 'CEBU';
  if (clean.includes('ZAMBOANGA') || clean.includes('ASP ZAM')) return 'ZAMBOANGA';
  if (clean.includes('DAVAO') || clean.includes('ABREEZA') || clean.includes('ASP ABR') || clean.includes('ASP DVO')) return 'DAVAO';
  if (clean.includes('COTABATO') || clean.includes('ASP COT')) return 'COTABATO';
  if (clean.includes('CAGAYAN') || clean.includes('ASP CDO') || clean.includes('CDO')) return 'CDO';
  if (clean.includes('BAGUIO') || clean.includes('ASP BAG')) return 'BAGUIO';
  if (clean.includes('LANANG') || clean.includes('APP LAN')) return 'LANANG';

  // Dynamic fallback for any newly added site:
  if (rawName) {
    const strippedName = rawName.toUpperCase()
      .replace(/^MOBILECARE\s*[-–—]?\s*/i, '')
      .replace(/^(ASP|APP|PMA)\s+/i, '')
      .replace(/SERVICE\s*BRANCH/i, '')
      .trim();
    if (strippedName && !strippedName.includes('DISTRIBUTION') && !strippedName.includes('DC')) {
      return strippedName.replace(/[/\\:*?"<>|]/g, '_');
    }
  }

  if (rawCode) {
    const strippedCode = rawCode.toUpperCase()
      .replace(/^SITE[-_]/i, '')
      .replace(/^(ASP|APP|PMA)\s+/i, '')
      .trim();
    if (strippedCode) {
      return strippedCode.replace(/[/\\:*?"<>|]/g, '_');
    }
  }

  return 'BRANCH';
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

/**
 * Offload Heavy Monthly Snapshots to Google Drive (Feature B)
 * Archives complete forecasting, allocation matrices, and masterlist states
 * directly to the Google Drive "snapshots" folder, keeping Supabase free-tier database lean.
 * 
 * @param {Object} params
 * @param {string} params.periodLabel - Month/Period name (e.g. "October 2026")
 * @param {Object} params.dataset - Data payload (forecastItems, allocations, parts, sites, stats)
 * @param {Object} [params.user] - Operator details
 * @param {Function} [params.onProgress] - Optional upload progress callback
 * @returns {Promise<{ success: boolean, fileId?: string, webViewLink?: string, filename?: string, error?: string }>}
 */
export async function archiveMonthlySnapshotToDrive({
  periodLabel = 'Current Period',
  dataset = {},
  user = null,
  onProgress
}) {
  try {
    const timestampStr = getFormattedSaveTimestamp();
    const cleanPeriod = String(periodLabel).replace(/[\s/\\:]+/g, '_');
    const filename = `MDC_SNAPSHOT_${cleanPeriod}_${timestampStr}.json`;

    const snapshotPayload = {
      system: 'MDC DC Logistics System',
      type: 'MONTHLY_DATASET_SNAPSHOT',
      periodLabel,
      createdAt: new Date().toISOString(),
      archivedBy: user?.fullName || user?.email || 'MDC Specialist',
      summary: {
        forecastItemsCount: (dataset.forecastItems || []).length,
        allocationsCount: (dataset.allocations || []).length,
        partsCount: (dataset.parts || []).length,
        sitesCount: (dataset.sites || []).length,
        totalForecastUnits: (dataset.forecastItems || []).reduce((sum, item) => sum + (Number(item.forecast_qty || item.quantity) || 0), 0)
      },
      data: {
        forecastItems: dataset.forecastItems || [],
        allocations: dataset.allocations || [],
        parts: dataset.parts || [],
        sites: dataset.sites || []
      }
    };

    const result = await uploadToGoogleDrive({
      name: filename,
      mimeType: 'application/json',
      data: JSON.stringify(snapshotPayload, null, 2),
      folderType: 'snapshots',
      useDateFolder: false,
      onProgress
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to archive snapshot to Google Drive');
    }

    return {
      success: true,
      fileId: result.fileId,
      webViewLink: result.webViewLink,
      filename,
      summary: snapshotPayload.summary
    };
  } catch (err) {
    console.error('[Google Drive] archiveMonthlySnapshotToDrive error:', err);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Downloads and parses an archived snapshot from Google Drive
 * 
 * @param {string} fileId - The Google Drive file ID
 * @returns {Promise<Object>} The parsed snapshot object
 */
export async function loadSnapshotFromDrive(fileId) {
  const { downloadJsonFromGoogleDrive } = await import('./googleDriveService.js');
  return await downloadJsonFromGoogleDrive(fileId);
}

