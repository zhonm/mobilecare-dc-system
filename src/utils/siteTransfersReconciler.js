import * as XLSX from 'xlsx';
import appleStockingPrices from '../data/appleStockingPrices.json' with { type: 'json' };
import { resolvePartInfo } from './partResolver.js';

export const APPLE_STOCKING_PRICE_COUNT = Object.keys(appleStockingPrices || {}).length;

// Official 26-branch tab order from "FIFO & (DC stocks only) Aging Stocks Monitoring.xlsx"
export const EXCEL_BRANCH_ORDER = [
  'BHS', 'GL5', 'GB3', 'PPM', 'SMS', 'MOA', 'ANX', 'TRI', 'VER', 'MEG',
  'POD', 'NES', 'MAG', 'MRK', 'FES', 'NPM', 'LIM', 'NAG', 'LAU', 'ILO',
  'CEB', 'ABR', 'ZAM', 'COT', 'CDO', 'LAN'
];

// Standard site mapping rules matching Google Sheet and Official Branch Directory
export const SITE_CODE_MAPPINGS = [
  { code: 'ABR', pattern: /\bABR\b|\bDAVAO\b/i, name: 'MOBILECARE - DAVAO', shortName: 'Davao', standardExcelLabel: 'MOBILECARE - DAVAO' },
  { code: 'ANX', pattern: /\bANX\b|\bANNEX\b|ayala\s*north|north\s*exchange/i, name: 'MOBILECARE - APP THE ANNEX', shortName: 'The Annex', standardExcelLabel: 'MOBILECARE - APP THE ANNEX' },
  { code: 'BHS', pattern: /\bBHS\b|\bBONIFACIO\b/i, name: 'MOBILECARE - APP BONIFACIO HIGH STREET', shortName: 'Bonifacio High Street', standardExcelLabel: 'MOBILECARE - APP BONIFACIO HIGH STREET' },
  { code: 'CDO', pattern: /\bCDO\b|\bCAGAYAN\b/i, name: 'MOBILECARE - CAGAYAN DE ORO', shortName: 'Cagayan De Oro', standardExcelLabel: 'MOBILECARE - CAGAYAN DE ORO' },
  { code: 'CEB', pattern: /\bCEB\b|\bCEBU\b/i, name: 'MOBILECARE - CEBU', shortName: 'Cebu', standardExcelLabel: 'MOBILECARE - CEBU' },
  { code: 'COT', pattern: /\bCOT\b|\bCOTABATO\b|\bCBO\b/i, name: 'MOBILECARE SERVICES - COTABATO', shortName: 'Cotabato', standardExcelLabel: 'COTABATO' },
  { code: 'DC', pattern: /^DC\b|\bDC[-_]|\bDISTRIBUTION\b|\bWAREHOUSE\b/i, name: 'MOBILE CARE SERVICES PHILS. INC. - Distribution Center', shortName: 'Distribution Center', standardExcelLabel: 'DISTRIBUTION CENTER' },
  { code: 'FES', pattern: /\bFES\b|\bFESTIVAL\b/i, name: 'MOBILECARE - APP FESTIVAL MALL', shortName: 'Festival Mall', standardExcelLabel: 'MOBILECARE - APP FESTIVAL MALL' },
  { code: 'GB3', pattern: /\bGB3\b|\bGREENBELT\b/i, name: 'MOBILECARE - APP GREENBELT 3', shortName: 'Greenbelt 3', standardExcelLabel: 'MOBILECARE - APP GREENBELT 3' },
  { code: 'GL5', pattern: /\bGL5\b|\bGLORIETTA\b/i, name: 'MOBILECARE - GLORIETTA 5', shortName: 'Glorietta 5', standardExcelLabel: 'MOBILECARE - GLORIETTA 5' },
  { code: 'ILO', pattern: /\bILO\b|\bILOILO\b|\bFESTIVE\b|APPILO/i, name: 'MOBILECARE - FESTIVE WALK ILOILO', shortName: 'Iloilo', standardExcelLabel: 'ILOILO' },
  { code: 'LAN', pattern: /\bLAN\b|\bLANANG\b/i, name: 'MOBILECARE - APP SM LANANG', shortName: 'SM Lanang', standardExcelLabel: 'SM LANANG' },
  { code: 'LAU', pattern: /\bLAU\b|\bUNION\b/i, name: 'MOBILECARE - LA UNION', shortName: 'La Union', standardExcelLabel: 'MOBILECARE - LA UNION' },
  { code: 'LIM', pattern: /\bLIM\b|\bLIMA\b/i, name: 'MOBILECARE - LIMA ESTATE', shortName: 'Lima Estate', standardExcelLabel: 'MOBILECARE - LIMA ESTATE' },
  { code: 'MAG', pattern: /\bMAG\b|\bMAGNOLIA\b|\bRM\b/i, name: 'MOBILECARE - APP MAGNOLIA', shortName: 'Magnolia', standardExcelLabel: 'MOBILECARE - APP MAGNOLIA' },
  { code: 'MEG', pattern: /\bMEG\b|\bMEGAMALL\b/i, name: 'MOBILECARE - APP MEGAMALL', shortName: 'Megamall', standardExcelLabel: 'MOBILECARE - APP MEGAMALL' },
  { code: 'MOA', pattern: /\bMOA\b|\bMALL\s*OF\s*ASIA\b/i, name: 'MOBILECARE - APP MALL OF ASIA', shortName: 'Mall of Asia', standardExcelLabel: 'MOBILECARE - APP MALL OF ASIA' },
  { code: 'MRK', pattern: /\bMRK\b|\bSM\s*MARIKINA\b|\bMARIKINA\b/i, name: 'MOBILECARE - SM MARIKINA', shortName: 'SM Marikina', standardExcelLabel: 'MOBILECARE - SM MARIKINA' },
  { code: 'NAG', pattern: /\bNAG\b|\bNAGA\b/i, name: 'MOBILECARE - NAGA', shortName: 'Naga', standardExcelLabel: 'MOBILECARE - NAGA' },
  { code: 'NES', pattern: /\bNES\b|\bNORTHEAST\b/i, name: 'MOBILECARE - NORTHEAST SQUARE', shortName: 'Northeast Square', standardExcelLabel: 'MOBILECARE - NORTHEAST SQUARE' },
  { code: 'NPM', pattern: /\bNPM\b|\bNEWPOINT\b/i, name: 'MOBILECARE - NEWPOINT MALL', shortName: 'Newpoint Mall', standardExcelLabel: 'MOBILECARE - NEWPOINT MALL' },
  { code: 'POD', pattern: /\bPOD\b|\bPODIUM\b/i, name: 'MOBILECARE - THE PODIUM', shortName: 'The Podium', standardExcelLabel: 'MOBILECARE - THE PODIUM' },
  { code: 'PPM', pattern: /\bPPM\b|\bPOWER\s*PLANT\b/i, name: 'MOBILECARE - APP POWER PLANT MALL', shortName: 'Power Plant Mall', standardExcelLabel: 'MOBILECARE - APP POWER PLANT MALL' },
  { code: 'SMS', pattern: /\bSMS\b|\bS'?MAISON\b/i, name: "MOBILECARE - S'MAISON", shortName: "S'Maison", standardExcelLabel: "MOBILECARE - S'MAISON" },
  { code: 'TRI', pattern: /\bTRI\b|\bTRINOMA\b/i, name: 'MOBILECARE - APP TRINOMA', shortName: 'Trinoma', standardExcelLabel: 'MOBILECARE - APP TRINOMA' },
  { code: 'VER', pattern: /\bVER\b|\bVERTIS\b|\bVN\b/i, name: 'MOBILECARE - VERTIS NORTH', shortName: 'Vertis North', standardExcelLabel: 'MOBILECARE - VERTIS NORTH' },
  { code: 'ZAM', pattern: /\bZAM\b|\bZAMBOANGA\b/i, name: 'MOBILECARE - ZAMBOANGA', shortName: 'Zamboanga', standardExcelLabel: 'MOBILECARE - ZAMBOANGA' }
];

/**
 * Normalizes any branch string, stock code, or GSX Location Name into standard site object.
 */
export function normalizeSite(input = '') {
  const str = String(input || '').trim();
  if (!str) {
    return { code: 'UNKNOWN', name: 'Unknown / Unassigned', shortName: 'Unknown', standardExcelLabel: 'UNKNOWN' };
  }

  // Extract site code from strings like "GL5_MSPI-Owned" or "GL5_Repair" or "CBO_MSPI-Owned"
  const prefixMatch = str.match(/^([A-Za-z0-9]+)[-_]/);
  let candidatePrefix = prefixMatch ? prefixMatch[1].toUpperCase() : '';
  if (candidatePrefix === 'CBO') {
    candidatePrefix = 'COT';
  } else if (candidatePrefix === 'APPILO') {
    candidatePrefix = 'ILO';
  }

  for (const mapping of SITE_CODE_MAPPINGS) {
    if (candidatePrefix && mapping.code === candidatePrefix) {
      return mapping;
    }
    if (mapping.pattern.test(str)) {
      return mapping;
    }
  }

  // Fallback if not matched
  const cleanName = str.replace(/[-_]MSPI[-_]Owned/gi, '').replace(/[-_]Repair/gi, ' Repair').trim();
  return {
    code: candidatePrefix || cleanName.substring(0, 4).toUpperCase(),
    name: cleanName,
    shortName: cleanName,
    standardExcelLabel: cleanName
  };
}

/**
 * Parses a date value from Excel number or date string into standard ISO YYYY-MM-DD.
 * Handles Excel serial floats (e.g. 46181.333333333336, "46181.333333333336"),
 * ISO strings, and slash formats (M/D/YYYY, YYYY/MM/DD).
 */
export function normalizeDate(val) {
  if (!val && val !== 0) return '';

  // 1. Excel serial date (number or numeric string like 46181 or "46181.333333333336")
  const num = typeof val === 'number' ? val : (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val.trim()) ? Number(val.trim()) : NaN);
  if (!isNaN(num) && num > 1000 && num < 100000) {
    const utcDays = Math.floor(num - 25569);
    const dateInfo = new Date(utcDays * 86400 * 1000);
    if (!isNaN(dateInfo.getTime())) {
      return dateInfo.toISOString().split('T')[0];
    }
  }

  const str = String(val).trim();
  if (!str) return '';

  // 2. Check standard YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // 3. Check ISO string with timestamp (e.g. "2026-06-08T08:00:00.000Z")
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    return str.split('T')[0];
  }

  // 4. Check M/D/YYYY or D/M/YYYY or YYYY/MM/DD
  const parts = str.split(/[-/]/);
  if (parts.length === 3) {
    let year = parts[2];
    let month = parts[0];
    let day = parts[1];
    if (parts[0].length === 4) {
      year = parts[0];
      month = parts[1];
      day = parts[2];
    } else if (year.length === 2) {
      year = '20' + year;
    }
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    if (year.length === 4) {
      return `${year}-${month}-${day}`;
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return str;
}

/**
 * Look up official Apple Stocking Price from Sheet35 dictionary (`appleStockingPrices.json`).
 */
export function lookupSheet35StockPrice(partNumber, customPrices = null, partsCatalog = []) {
  const cleanPn = String(partNumber || '').trim().toUpperCase();
  if (!cleanPn) return 0;

  if (customPrices && cleanPn in customPrices) {
    return Number(customPrices[cleanPn]) || 0;
  }
  if (appleStockingPrices && cleanPn in appleStockingPrices) {
    return Number(appleStockingPrices[cleanPn]) || 0;
  }

  const resolvedPart = resolvePartInfo(cleanPn, partsCatalog);
  if (resolvedPart && Number(resolvedPart.stocking_price) > 0) {
    return Number(resolvedPart.stocking_price);
  }
  return 0;
}

/**
 * Parses GSX KBB/KGBs Used Report file (XLSX or CSV, supporting ; or , delimiters,
 * multi-sheet workbooks, and side-by-side multi-table sheets like "Used Serial").
 */
export async function parseGsxKbbKgbsUsedFile(file) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    // Prefer "KGB Used" or "Used Serial" sheet when a multi-sheet workbook is uploaded
    let sheetName = workbook.SheetNames[0];
    for (const candidate of workbook.SheetNames) {
      if (/^kgb\s*used$/i.test(candidate.trim())) {
        sheetName = candidate;
        break;
      }
    }
    if (sheetName === workbook.SheetNames[0] && workbook.SheetNames.length > 1) {
      for (const candidate of workbook.SheetNames) {
        if (/kgb\s*used|gsx|used\s*serial/i.test(candidate) && !/kgb\s*used\s*serials/i.test(candidate)) {
          sheetName = candidate;
          break;
        }
      }
    }

    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      return { success: false, error: 'The uploaded GSX report has no readable worksheet.' };
    }

    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rawRows || rawRows.length < 2) {
      return { success: false, error: 'The uploaded GSX report is empty or missing data rows.' };
    }

    // Locate header row
    let headerIdx = -1;
    for (let r = 0; r < Math.min(10, rawRows.length); r++) {
      const rowStr = (rawRows[r] || []).join(' ').toLowerCase();
      if (
        (rowStr.includes('order') || rowStr.includes('repair')) &&
        (rowStr.includes('kgb') || rowStr.includes('kbb') || rowStr.includes('serial') || rowStr.includes('code') || rowStr.includes('part number'))
      ) {
        headerIdx = r;
        break;
      }
    }

    if (headerIdx === -1) {
      headerIdx = 0;
    }

    const rawHeaders = (rawRows[headerIdx] || []).map(h => String(h || '').trim());
    // Isolate primary table columns if side-by-side tables exist (e.g. "Used Serial" sheet)
    const firstEmptyHeaderIdx = rawHeaders.findIndex((h, idx) => idx >= 4 && !h);
    const headers = firstEmptyHeaderIdx !== -1 ? rawHeaders.slice(0, firstEmptyHeaderIdx) : rawHeaders;

    let orderCol = -1, locCol = -1, repairCol = -1, stratCol = -1, statusCol = -1;
    let dateCol = -1, codeCol = -1, descCol = -1, kgbCol = -1, kbbCol = -1;

    headers.forEach((h, idx) => {
      const clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (orderCol === -1 && (/^order(id|num|no)?$/.test(clean) || clean.includes('orderid'))) orderCol = idx;
      else if (locCol === -1 && /location(name)?|site|branch/.test(clean)) locCol = idx;
      else if (repairCol === -1 && /repairnumber|gsxrepair|repairno|repairid/.test(clean)) repairCol = idx;
      else if (stratCol === -1 && /strategy/.test(clean)) stratCol = idx;
      else if (statusCol === -1 && /currentgsxstatus|gsxstatus|^status$/.test(clean)) statusCol = idx;
      else if (dateCol === -1 && /repaircloseddate|closeddate|repairdate|^date$/.test(clean)) dateCol = idx;
      else if (codeCol === -1 && /productcode|partnumber|partcode|itemcode|pn|code/.test(clean)) codeCol = idx;
      else if (descCol === -1 && /productdescription|partdescription|desc|description|name/.test(clean)) descCol = idx;
      else if (kgbCol === -1 && /productkgb|kgb|serialnumber|serial|sn/.test(clean)) kgbCol = idx;
      else if (kbbCol === -1 && /productkbb|kbb|returnserial/.test(clean)) kbbCol = idx;
    });

    // Sensible defaults for standard 10-column GSX KBB/KGBs Used export
    if (headers.length >= 9) {
      if (orderCol === -1) orderCol = 0;
      if (locCol === -1) locCol = 1;
      if (repairCol === -1) repairCol = 2;
      if (stratCol === -1) stratCol = 3;
      if (statusCol === -1) statusCol = 4;
      if (dateCol === -1) dateCol = 5;
      if (codeCol === -1) codeCol = 6;
      if (descCol === -1) descCol = 7;
      if (kgbCol === -1) kgbCol = 8;
      if (kbbCol === -1 && headers.length >= 10) kbbCol = 9;
    } else {
      // Compact 6-column "Used Parts" table (Order id | Date | Site | Part Number | Part Description | Serial)
      if (orderCol === -1) orderCol = 0;
      if (dateCol === -1) dateCol = 1;
      if (locCol === -1) locCol = 2;
      if (codeCol === -1) codeCol = 3;
      if (descCol === -1) descCol = 4;
      if (kgbCol === -1) kgbCol = 5;
    }

    const records = [];
    for (let r = headerIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r] || [];
      const kgb = String(row[kgbCol] || '').trim().toUpperCase();
      const code = String(row[codeCol] || '').trim();
      const desc = String(row[descCol] || '').trim();
      const orderId = String(row[orderCol] || '').trim();
      const loc = String(row[locCol] || '').trim();
      const repairNo = repairCol !== -1 ? String(row[repairCol] || '').trim() : '';
      const rawDate = row[dateCol];
      const repairDate = normalizeDate(rawDate);
      const kbb = kbbCol !== -1 ? String(row[kbbCol] || '').trim().toUpperCase() : '';
      const status = statusCol !== -1 ? String(row[statusCol] || '').trim() : 'SCOM';

      // Skip row if completely empty
      if (!orderId && !kgb && !code && !desc) continue;

      const normSite = normalizeSite(loc);

      records.push({
        order_id: orderId,
        location_name: loc,
        site_code: normSite.code,
        site_name: normSite.name,
        gsx_repair_number: repairNo,
        gsx_repair_strategy: stratCol !== -1 ? String(row[stratCol] || '').trim() : '',
        current_gsx_status: status,
        repair_closed_date: repairDate,
        product_code: code,
        product_description: desc,
        product_kgb: kgb,
        product_kbb: kbb
      });
    }

    return {
      success: true,
      records,
      metadata: {
        fileName: file.name,
        sheetName,
        totalRows: records.length,
        withSerialsCount: records.filter(r => Boolean(r.product_kgb)).length,
        importedAt: new Date().toISOString()
      }
    };
  } catch (err) {
    console.error('Error parsing GSX report:', err);
    return { success: false, error: `Failed to parse GSX report: ${err.message}` };
  }
}

/**
 * Parses a full multi-sheet FIFO Monitoring Workbook (e.g. "FIFO & (DC stocks only) Aging Stocks Monitoring.xlsx"
 * or "SIte Stocks (Fixably).xlsx") and extracts Stock Transfer, KGB Used, and optional Sheet35 Stocking Prices in one pass.
 */
export async function parseFifoMonitoringWorkbook(file) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    const transferSheetName = workbook.SheetNames.find(n => /^stock\s*transfers?$/i.test(n.trim())) ||
      workbook.SheetNames.find(n => /stock\s*transfer/i.test(n));
    const kgbSheetName = workbook.SheetNames.find(n => /^kgb\s*used$/i.test(n.trim())) ||
      workbook.SheetNames.find(n => /kgb\s*used/i.test(n) && !/serials/i.test(n)) ||
      workbook.SheetNames.find(n => /^used\s*serial$/i.test(n.trim()));
    const priceSheetName = workbook.SheetNames.find(n => /^sheet35$/i.test(n.trim()) || /price/i.test(n));

    if (!transferSheetName && !kgbSheetName) {
      return {
        success: false,
        error: 'Workbook does not contain recognizable "Stock Transfer" or "KGB Used" sheets.'
      };
    }

    // 1. Parse Stock Transfers sheet if present
    const transferRecords = [];
    if (transferSheetName) {
      const ws = workbook.Sheets[transferSheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      let headerIdx = 0;
      for (let r = 0; r < Math.min(10, rawRows.length); r++) {
        const rowStr = (rawRows[r] || []).join(' ').toLowerCase();
        if (rowStr.includes('from stock') && rowStr.includes('to stock')) {
          headerIdx = r;
          break;
        }
      }
      for (let r = headerIdx + 1; r < rawRows.length; r++) {
        const row = rawRows[r] || [];
        const fromVal = String(row[1] || '').trim();
        const toVal = String(row[2] || '').trim();
        const codeVal = String(row[3] || '').trim();
        const nameVal = String(row[4] || '').trim();
        const qtyVal = Number(row[5]) || 1;
        const snVal = String(row[6] || '').trim();
        const imeiVal = String(row[7] || '').trim();
        const valRaw = Number(row[8]) || 0;
        if (!fromVal && !toVal && !codeVal && !snVal) continue;
        transferRecords.push({
          id: `trf-wb-${r}`,
          transfer_received_date: normalizeDate(row[0]),
          from_stock: fromVal,
          to_stock: toVal,
          product_code: codeVal,
          product_name: nameVal,
          transfer_quantity: qtyVal,
          serial_number: snVal,
          imei_number: imeiVal,
          transfer_value: valRaw
        });
      }
    }

    // 2. Parse KGB Used sheet if present
    const gsxRecords = [];
    if (kgbSheetName) {
      const ws = workbook.Sheets[kgbSheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      let headerIdx = 0;
      for (let r = 0; r < Math.min(10, rawRows.length); r++) {
        const rowStr = (rawRows[r] || []).join(' ').toLowerCase();
        if ((rowStr.includes('order') || rowStr.includes('repair')) && (rowStr.includes('kgb') || rowStr.includes('serial'))) {
          headerIdx = r;
          break;
        }
      }
      const rawHeaders = (rawRows[headerIdx] || []).map(h => String(h || '').trim());
      const firstEmpty = rawHeaders.findIndex((h, i) => i >= 4 && !h);
      const headers = firstEmpty !== -1 ? rawHeaders.slice(0, firstEmpty) : rawHeaders;
      const isCompactUsedSerial = headers.length <= 7;

      for (let r = headerIdx + 1; r < rawRows.length; r++) {
        const row = rawRows[r] || [];
        const orderId = String(row[0] || '').trim();
        const loc = String(row[isCompactUsedSerial ? 2 : 1] || '').trim();
        const repairNo = isCompactUsedSerial ? '' : String(row[2] || '').trim();
        const strat = isCompactUsedSerial ? '' : String(row[3] || '').trim();
        const status = isCompactUsedSerial ? 'SCOM' : String(row[4] || '').trim();
        const closedDate = normalizeDate(row[isCompactUsedSerial ? 1 : 5]);
        const code = String(row[isCompactUsedSerial ? 3 : 6] || '').trim();
        const desc = String(row[isCompactUsedSerial ? 4 : 7] || '').trim();
        const kgb = String(row[isCompactUsedSerial ? 5 : 8] || '').trim().toUpperCase();
        const kbb = isCompactUsedSerial ? '' : String(row[9] || '').trim().toUpperCase();

        if (!orderId && !kgb && !code && !desc) continue;
        const normSite = normalizeSite(loc);
        gsxRecords.push({
          order_id: orderId,
          location_name: loc,
          site_code: normSite.code,
          site_name: normSite.name,
          gsx_repair_number: repairNo,
          gsx_repair_strategy: strat,
          current_gsx_status: status,
          repair_closed_date: closedDate,
          product_code: code,
          product_description: desc,
          product_kgb: kgb,
          product_kbb: kbb
        });
      }
    }

    // 3. Parse Sheet35 custom prices if present
    const customPrices = {};
    if (priceSheetName && workbook.Sheets[priceSheetName]) {
      const s35Rows = XLSX.utils.sheet_to_json(workbook.Sheets[priceSheetName], { header: 1, defval: '' });
      for (let i = 1; i < s35Rows.length; i++) {
        const pn = String(s35Rows[i][15] || s35Rows[i][1] || '').trim().toUpperCase();
        const priceType = String(s35Rows[i][17] || s35Rows[i][7] || '').trim();
        const val = Number(s35Rows[i][18] ?? s35Rows[i][8]);
        if (pn && !isNaN(val) && (!priceType || /stocking/i.test(priceType)) && !(pn in customPrices)) {
          customPrices[pn] = val;
        }
      }
    }

    return {
      success: true,
      transfers: transferRecords,
      transferRecords,
      gsxRecords,
      customPrices,
      metadata: {
        fileName: file.name,
        transferSheetName,
        kgbSheetName,
        priceSheetName,
        transferCount: transferRecords.length,
        gsxCount: gsxRecords.length,
        pricesCount: Object.keys(customPrices).length,
        importedAt: new Date().toISOString()
      }
    };
  } catch (err) {
    console.error('Error parsing FIFO Monitoring Workbook:', err);
    return { success: false, error: `Failed to parse workbook: ${err.message}` };
  }
}

/**
 * Determines whether a given part/product description corresponds to an iPhone 13 or newer model.
 * Explicitly filters out older iPhone models (iPhone 4, 5, 6, 7, 8, X, XR, XS, 11, 12, SE) and non-iPhones.
 */
export function isIPhone13AndUp(description) {
  if (!description) return false;
  const str = String(description).trim();
  if (!/iphone/i.test(str)) return false;

  // Exclude legacy/older iPhone models (4, 5, 6, 7, 8, X, XR, XS, 11, 12, SE)
  if (/\b(4|4s|5|5s|5c|6|6s|7|8|x|xr|xs|11|12|se)\b/i.test(str)) {
    const hasNewer = /\b(1[3-9]|[2-9][0-9])([a-z])?\b|iphone\s*air/i.test(str);
    if (!hasNewer) return false;
  }
  return /\b(1[3-9]|[2-9][0-9])([a-z])?\b|iphone\s*air/i.test(str);
}

/**
 * Helper matching Excel's standard_j regex mapping in 'KGB Used Serials'!A2
 * to detect Cross-Site ("Transferred to ...") consumption accurately.
 */
export function getExcelStandardSiteLabel(toStock = '') {
  const u = String(toStock || '').toUpperCase();
  if (/ABR/.test(u)) return 'MOBILECARE - DAVAO';
  if (/ANX/.test(u)) return 'MOBILECARE - APP THE ANNEX';
  if (/BHS/.test(u)) return 'MOBILECARE - APP BONIFACIO HIGH STREET';
  if (/CDO/.test(u)) return 'MOBILECARE - CAGAYAN DE ORO';
  if (/CEB/.test(u)) return 'MOBILECARE - CEBU';
  if (/FES/.test(u)) return 'MOBILECARE - APP FESTIVAL MALL';
  if (/GB3/.test(u)) return 'MOBILECARE - APP GREENBELT 3';
  if (/GL5/.test(u)) return 'MOBILECARE - GLORIETTA 5';
  if (/ILO/.test(u)) return 'ILOILO';
  if (/LAU/.test(u)) return 'MOBILECARE - LA UNION';
  if (/LIM/.test(u)) return 'MOBILECARE - LIMA ESTATE';
  if (/MAG|RM/.test(u)) return 'MOBILECARE - APP MAGNOLIA';
  if (/MEG/.test(u)) return 'MOBILECARE - APP MEGAMALL';
  if (/MOA/.test(u)) return 'MOBILECARE - APP MALL OF ASIA';
  if (/MRK/.test(u)) return 'MOBILECARE - SM MARIKINA';
  if (/NAG/.test(u)) return 'MOBILECARE - NAGA';
  if (/NES/.test(u)) return 'MOBILECARE - NORTHEAST SQUARE';
  if (/NPM/.test(u)) return 'MOBILECARE - NEWPOINT MALL';
  if (/POD/.test(u)) return 'MOBILECARE - THE PODIUM';
  if (/PPM/.test(u)) return 'MOBILECARE - APP POWER PLANT MALL';
  if (/SMS/.test(u)) return "MOBILECARE - S'MAISON";
  if (/TRI/.test(u)) return 'MOBILECARE - APP TRINOMA';
  if (/VER|VN/.test(u)) return 'MOBILECARE - VERTIS NORTH';
  if (/ZAM/.test(u)) return 'MOBILECARE - ZAMBOANGA';
  return String(toStock || '').trim();
}

/**
 * Master Reconciler: Replicates "FIFO & (DC stocks only) Aging Stocks Monitoring.xlsx"
 * across all 26 service branches with 100% formula parity:
 * 1. Filters Stock Transfers where From Stock contains "DC" (DC Stocks Only)
 * 2. Filters KGB Used to iPhone Battery & Display repairs (first XLOOKUP match wins)
 * 3. Evaluates per-branch FIFO compliance:
 *    IF(RepairClosedDate="", "In Stock", IF(COUNTIFS(PartNumber=e, ReceivedDate<a, RepairClosedDate="")>0, "FIFO Violation (Older Stock Exists)", "FIFO Compliant"))
 * 4. Evaluates DC Aging Status & Sheet35 Stocking Price valuation:
 *    Non-Moving (>= 61 days, or >= 90 days on BHS in Excel Parity mode) & Slow-Moving (31-60 days, or 60-89 days on BHS)
 */
export function reconcileSiteTransfers(transferRecords = [], gsxRecords = [], partsCatalog = [], options = {}) {
  const {
    dcStocksOnly = true,
    agingPolicy = 'EXCEL_PARITY', // 'EXCEL_PARITY' | 'UNIFORM_61_31' | 'UNIFORM_90_60' | 'STANDARD_90_60'
    referenceDate = '2026-10-13',
    customPrices = null,
    customPriceMap = null,
    includeZeroTransferBranches = false
  } = options;
  const effectiveCustomPrices = customPriceMap || customPrices;

  // Step 1: Filter transfers (DC Stocks Only by default, matching 'Used Serial'!H3: ISNUMBER(SEARCH("DC", FromStock)))
  const rawTransfersCount = (transferRecords || []).length;
  const scopedTransfers = (transferRecords || []).filter(t => {
    const sn = String(t.serial_number || '').trim().toUpperCase();
    if (!sn || sn === 'N/A' || sn === 'NA' || sn === 'NONE' || sn === '—' || sn === '-') {
      return false;
    }
    const fromStock = String(t.from_stock || '').toUpperCase();
    if (dcStocksOnly) {
      return fromStock.includes('DC');
    }
    const desc = t.product_name || t.part_description || t.description || '';
    return isIPhone13AndUp(desc);
  });

  if (!scopedTransfers.length) {
    return {
      records: [],
      sitesScorecard: [],
      kpis: {
        totalSerials: 0,
        uniqueSerialsCount: 0,
        duplicateDcRowsCount: 0,
        duplicateTransferRowsCount: 0,
        nonDcTransfersExcluded: 0,
        totalTransfers: 0,
        rawTransfersCount,
        usedCount: 0,
        usedRate: 0,
        inStockCount: 0,
        inStockValue: 0,
        fifoCompliantCount: 0,
        fifoViolationsCount: 0,
        outOfSequenceCount: 0,
        fifoComplianceRate: 100,
        nonMovingCount: 0,
        nonMovingCost: 0,
        nonMovingValue: 0,
        slowMovingCount: 0,
        slowMovingCost: 0,
        slowMovingValue: 0,
        activeInStockCount: 0,
        activeStockCount: 0,
        activeInStockCost: 0,
        activeStockValue: 0,
        crossSiteDiscrepanciesCount: 0,
        agingOver60Count: 0
      },
      orphanGsxRecords: [],
      duplicateSerials: [],
      validations: {
        duplicateTransferSerialsCount: 0,
        duplicateTransferSerials: [],
        missingPricePartsCount: 0,
        missingPriceParts: []
      },
      validationSummary: []
    };
  }

  // Step 2: Build GSX lookup map by Product KGB (serial)
  // Matches 'Used Serial'!A3: filters KGB Used for IPHONE + (BATTERY or DISPLAY) when description is present;
  // first occurrence wins (matching Excel XLOOKUP top-to-bottom behavior).
  const gsxBySerial = new Map();
  gsxRecords.forEach(g => {
    const sn = String(g.product_kgb || '').trim().toUpperCase();
    if (!sn || sn === 'N/A' || sn === 'NA' || sn === 'NONE' || sn === '—' || sn === '-') return;

    const descUpper = String(g.product_description || '').trim().toUpperCase();
    if (descUpper && !(descUpper.includes('IPHONE') && (descUpper.includes('BATTERY') || descUpper.includes('DISPLAY')))) {
      return;
    }

    if (!gsxBySerial.has(sn)) {
      gsxBySerial.set(sn, g);
    }
  });

  // Track serial occurrences to identify duplicate DC transfer rows while preserving row parity
  const serialOccurrences = new Map();
  const duplicateSerials = [];
  const missingPricePartSet = new Set();

  const refDateStr = normalizeDate(referenceDate) || new Date().toISOString().split('T')[0];
  const refDateMs = new Date(`${refDateStr}T00:00:00Z`).getTime();

  // Step 3: Build 'KGB Used Serials' master rows
  const reconciledRecords = [];
  const transferredSerialSet = new Set();

  scopedTransfers.forEach((t, idx) => {
    const serialNumber = String(t.serial_number || '').trim().toUpperCase();
    transferredSerialSet.add(serialNumber);

    const prevCount = serialOccurrences.get(serialNumber) || 0;
    serialOccurrences.set(serialNumber, prevCount + 1);

    const normalizedRecStr = normalizeDate(t.transfer_received_date);
    const recDateMs = normalizedRecStr ? new Date(`${normalizedRecStr}T00:00:00Z`).getTime() : NaN;
    const fromSite = normalizeSite(t.from_stock);
    const currentSite = normalizeSite(t.to_stock);

    if (prevCount > 0) {
      duplicateSerials.push({
        serial_number: serialNumber,
        product_code: t.product_code,
        product_name: t.product_name,
        to_stock: t.to_stock,
        transfer_received_date: normalizedRecStr
      });
    }

    const gsxMatch = gsxBySerial.get(serialNumber) || null;
    const normalizedClosedStr = gsxMatch ? normalizeDate(gsxMatch.repair_closed_date) : '';
    const isUsed = Boolean(gsxMatch && normalizedClosedStr);
    const gsxSite = gsxMatch ? normalizeSite(gsxMatch.location_name) : null;

    // Cross-Site ("Transferred to ...") check matching 'KGB Used Serials'!A2:
    // IF((cc <> "") * ISERROR(SEARCH(standard_j, cc)), "Transferred to " & cc, cc)
    const standardJ = getExcelStandardSiteLabel(t.to_stock);
    const cc = gsxMatch ? String(gsxMatch.location_name || '').trim() : '';
    let isCrossSiteDiscrepancy = false;
    let serialUsedByLabel = '';
    let crossSiteDetail = null;

    if (isUsed && cc) {
      const matchesStandardJ = standardJ && cc.toUpperCase().includes(standardJ.toUpperCase());
      const matchesSiteCode = gsxSite && currentSite.code !== 'UNKNOWN' && gsxSite.code === currentSite.code;
      if (!matchesStandardJ && !matchesSiteCode) {
        isCrossSiteDiscrepancy = true;
        serialUsedByLabel = `Transferred to ${cc}`;
        crossSiteDetail = {
          transferredTo: currentSite.name,
          transferredToCode: currentSite.code,
          usedAt: gsxSite?.name || cc,
          usedAtCode: gsxSite?.code || 'GSX',
          rawGsxLocation: cc
        };
      } else {
        serialUsedByLabel = cc;
      }
    }

    // Route category
    let transferType = 'SITE_TO_SITE';
    const fromStockLower = String(t.from_stock || '').toLowerCase();
    const toStockLower = String(t.to_stock || '').toLowerCase();
    if (fromStockLower.includes('dc')) {
      transferType = 'DC_TO_SITE';
    } else if (toStockLower.includes('repair') || fromStockLower.includes('repair')) {
      transferType = 'INTERNAL_REPAIR';
    }

    // Days in stock calculation:
    // In Excel Column J: days_elapsed = TODAY() - TransferReceivedDate (for unused items)
    let daysInStock = 0;
    if (!isNaN(recDateMs)) {
      if (isUsed && normalizedClosedStr) {
        const closedDateMs = new Date(`${normalizedClosedStr}T00:00:00Z`).getTime();
        if (!isNaN(closedDateMs)) {
          daysInStock = Math.max(0, Math.floor((closedDateMs - recDateMs) / 86400000));
        } else {
          daysInStock = Math.max(0, Math.floor((refDateMs - recDateMs) / 86400000));
        }
      } else {
        daysInStock = Math.max(0, Math.floor((refDateMs - recDateMs) / 86400000));
      }
    }

    // Aging thresholds per branch & policy:
    // In "FIFO & (DC stocks only) Aging Stocks Monitoring.xlsx", BHS uses 90/60 while the other 25 branches use 61/31.
    const is90Policy = agingPolicy === 'STANDARD_90_60' || agingPolicy === 'UNIFORM_90_60';
    const isBhsParity = agingPolicy === 'EXCEL_PARITY' && currentSite.code === 'BHS';
    const nonMovingThreshold = (is90Policy || isBhsParity) ? 90 : 61;
    const slowMovingThreshold = (is90Policy || isBhsParity) ? 60 : 31;

    let agingCategory = 'USED';
    let agingStatusLabel = '';
    let agingBucket = '< 31 days';

    if (!isUsed) {
      if (daysInStock >= nonMovingThreshold) {
        agingCategory = 'NON_MOVING';
        agingStatusLabel = `Non-Moving (${daysInStock} days)`;
        agingBucket = `Non-Moving (${nonMovingThreshold}+ days)`;
      } else if (daysInStock >= slowMovingThreshold) {
        agingCategory = 'SLOW_MOVING';
        agingStatusLabel = `Slow-Moving (${daysInStock} days)`;
        agingBucket = `Slow-Moving (${slowMovingThreshold}–${nonMovingThreshold - 1} days)`;
      } else {
        agingCategory = 'ACTIVE';
        agingStatusLabel = '';
        agingBucket = `Active (< ${slowMovingThreshold} days)`;
      }
    }

    // Official Sheet35 Stocking Price Lookup (XLOOKUP(PartNumber, Sheet35!P:P, Sheet35!S:S, 0))
    const sheet35Price = lookupSheet35StockPrice(t.product_code, effectiveCustomPrices, partsCatalog);
    if (sheet35Price === 0 && t.product_code) {
      missingPricePartSet.add(String(t.product_code).trim().toUpperCase());
    }
    const resolvedPart = resolvePartInfo(t.product_code, partsCatalog);
    const unitPrice = sheet35Price;

    reconciledRecords.push({
      row_id: `${serialNumber}-${currentSite.code}-${idx}`,
      serial_number: serialNumber,
      product_code: String(t.product_code || '').trim(),
      product_name: String(t.product_name || resolvedPart?.description || '').trim(),
      category_id: resolvedPart?.category_id || '',
      transfer_received_date: normalizedRecStr || String(t.transfer_received_date || ''),
      first_received_date: normalizedRecStr || String(t.transfer_received_date || ''),
      transfer_count: prevCount + 1,
      transfer_trail: [{
        date: normalizedRecStr,
        from: t.from_stock,
        to: t.to_stock,
        qty: t.transfer_quantity || 1
      }],
      from_stock: String(t.from_stock || '').trim(),
      from_site: fromSite,
      to_stock: String(t.to_stock || '').trim(),
      current_site: currentSite,
      transfer_type: transferType,
      unit_price: unitPrice,
      stock_price: sheet35Price,
      is_used: isUsed,
      days_in_stock: daysInStock,
      aging_category: agingCategory,
      aging_status_label: agingStatusLabel,
      aging_bucket: agingBucket,
      // GSX Details
      gsx_order_id: gsxMatch?.order_id ? String(gsxMatch.order_id) : '',
      gsx_repair_number: gsxMatch?.gsx_repair_number || '',
      repair_closed_date: normalizedClosedStr,
      gsx_location_name: cc,
      serial_used_by_label: serialUsedByLabel,
      gsx_site: gsxSite,
      product_kbb: gsxMatch?.product_kbb || '',
      // Discrepancy details
      is_cross_site_discrepancy: isCrossSiteDiscrepancy,
      cross_site_detail: crossSiteDetail,
      // FIFO Status & Remarks (Computed in Step 4 below)
      remarks: isUsed ? 'FIFO Compliant' : 'In Stock',
      fifo_status: isUsed ? 'FIFO_COMPLIANT' : 'IN_STOCK',
      fifo_violation_reasons: [],
      out_of_sequence_reasons: []
    });
  });

  // Step 4: Per-Branch Sorting & Exact Excel FIFO Compliance Formula
  // Formula in Column I of each Branch Sheet:
  // MAP(A2:A1000, G2:G1000, D2:D1000, LAMBDA(a, b, e,
  //   IF(a="", "", IF(b="", "In Stock",
  //     IF(COUNTIFS(D:D, e, A:A, "<" & a, G:G, "") > 0, "FIFO Violation (Older Stock Exists)", "FIFO Compliant")
  //   ))
  // ))
  const recordsByBranch = new Map();
  reconciledRecords.forEach(r => {
    const code = r.current_site.code;
    if (!recordsByBranch.has(code)) {
      recordsByBranch.set(code, []);
    }
    recordsByBranch.get(code).push(r);
  });

  recordsByBranch.forEach((branchRecords) => {
    // Sort chronologically by Transfer Received Date (matching SORT(FILTER(...), 1, TRUE) in cell A2)
    branchRecords.sort((a, b) => {
      const da = new Date(a.transfer_received_date || '1970-01-01').getTime();
      const db = new Date(b.transfer_received_date || '1970-01-01').getTime();
      return da - db;
    });

    branchRecords.forEach(r => {
      if (!r.is_used) {
        r.remarks = 'In Stock';
        r.fifo_status = 'IN_STOCK';
        return;
      }

      const myArrival = new Date(r.transfer_received_date || '1970-01-01').getTime();
      const myUsedDate = new Date(r.repair_closed_date || '1970-01-01').getTime();

      // Same Part Number at the same Branch with strictly earlier Transfer Received Date (A:A < a)
      const olderUnits = branchRecords.filter(other => {
        if (other.row_id === r.row_id) return false;
        if (other.product_code !== r.product_code) return false;
        const otherArrival = new Date(other.transfer_received_date || '1970-01-01').getTime();
        return otherArrival < myArrival;
      });

      // Primary Excel FIFO Violation check: Older stock of the same SKU is STILL UNUSED (G:G = "")
      const olderUnused = olderUnits.filter(o => !o.is_used);

      // Secondary analytical check: Older stock was used AFTER this newer unit
      const olderUsedAfter = olderUnits.filter(o => {
        if (!o.is_used) return false;
        const oUsedDate = new Date(o.repair_closed_date || '1970-01-01').getTime();
        return oUsedDate > myUsedDate;
      });

      if (olderUnused.length > 0) {
        r.remarks = 'FIFO Violation (Older Stock Exists)';
        r.fifo_status = 'FIFO_VIOLATION_OLDER_IN_STOCK';
        r.fifo_violation_reasons = olderUnused.map(o => ({
          type: 'OLDER_STOCK_IDLE',
          olderSerial: o.serial_number,
          olderArrival: o.transfer_received_date,
          olderDaysInStock: o.days_in_stock,
          olderStatusLabel: o.aging_status_label || 'In Stock'
        }));
      } else {
        r.remarks = 'FIFO Compliant';
        r.fifo_status = 'FIFO_COMPLIANT';
      }

      if (olderUsedAfter.length > 0) {
        r.out_of_sequence_reasons = olderUsedAfter.map(o => ({
          type: 'USED_OUT_OF_SEQUENCE',
          olderSerial: o.serial_number,
          olderArrival: o.transfer_received_date,
          olderUsedDate: o.repair_closed_date
        }));
      }
    });
  });

  // Sort master records by To Stock ascending (matching SORT(result, 3, TRUE) in 'KGB Used Serials'!A2)
  reconciledRecords.sort((a, b) => {
    const cmp = String(a.to_stock || '').localeCompare(String(b.to_stock || ''));
    if (cmp !== 0) return cmp;
    const da = new Date(a.transfer_received_date || '1970-01-01').getTime();
    const db = new Date(b.transfer_received_date || '1970-01-01').getTime();
    return da - db;
  });

  // Step 5: Find Orphan GSX Records (Used in GSX repairs but not in DC Stock Transfers)
  const orphanGsxRecords = [];
  gsxRecords.forEach(g => {
    const sn = String(g.product_kgb || '').trim().toUpperCase();
    if (sn && !transferredSerialSet.has(sn) && isIPhone13AndUp(g.product_description)) {
      orphanGsxRecords.push({
        ...g,
        site: normalizeSite(g.location_name)
      });
    }
  });

  // Step 6: Compute Rollup KPIs
  const totalSerials = reconciledRecords.length;
  const uniqueSerialsCount = transferredSerialSet.size;
  const duplicateDcRowsCount = totalSerials - uniqueSerialsCount;
  let usedCount = 0;
  let inStockCount = 0;
  let inStockValue = 0;
  let fifoViolationsCount = 0;
  let fifoCompliantCount = 0;
  let outOfSequenceCount = 0;
  let nonMovingCount = 0;
  let nonMovingCost = 0;
  let slowMovingCount = 0;
  let slowMovingCost = 0;
  let activeInStockCount = 0;
  let activeInStockCost = 0;
  let crossSiteDiscrepanciesCount = 0;
  let agingOver60Count = 0;

  reconciledRecords.forEach(r => {
    if (r.is_used) {
      usedCount++;
      if (r.fifo_status.includes('VIOLATION')) {
        fifoViolationsCount++;
      } else {
        fifoCompliantCount++;
      }
      if (r.out_of_sequence_reasons?.length > 0) {
        outOfSequenceCount++;
      }
    } else {
      inStockCount++;
      inStockValue += r.unit_price;
      if (r.days_in_stock > 60) {
        agingOver60Count++;
      }
      if (r.aging_category === 'NON_MOVING') {
        nonMovingCount++;
        nonMovingCost += r.unit_price;
      } else if (r.aging_category === 'SLOW_MOVING') {
        slowMovingCount++;
        slowMovingCost += r.unit_price;
      } else {
        activeInStockCount++;
        activeInStockCost += r.unit_price;
      }
    }
    if (r.is_cross_site_discrepancy) {
      crossSiteDiscrepanciesCount++;
    }
  });

  const fifoComplianceRate = usedCount > 0
    ? Number(((fifoCompliantCount / usedCount) * 100).toFixed(1))
    : 100;

  const usedRate = totalSerials > 0
    ? Number(((usedCount / totalSerials) * 100).toFixed(1))
    : 0;

  // Step 7: Compute Site-by-Site Scorecards & 4-Table Branch Sheet Structures
  const siteMap = new Map();

  // Pre-seed all 26 official branches if requested or if present in data
  if (includeZeroTransferBranches || recordsByBranch.size >= 15) {
    EXCEL_BRANCH_ORDER.forEach((code, tabIndex) => {
      const mapping = SITE_CODE_MAPPINGS.find(m => m.code === code) || {
        code,
        name: `MOBILECARE - ${code}`,
        shortName: code
      };
      siteMap.set(code, {
        code,
        tabIndex: tabIndex + 1,
        name: mapping.name,
        shortName: mapping.shortName,
        totalReceived: 0,
        usedCount: 0,
        inStockCount: 0,
        inStockValue: 0,
        fifoCompliantCount: 0,
        fifoViolationsCount: 0,
        outOfSequenceCount: 0,
        nonMovingCount: 0,
        nonMovingCost: 0,
        slowMovingCount: 0,
        slowMovingCost: 0,
        activeInStockCount: 0,
        activeInStockCost: 0,
        crossSiteCount: 0,
        agingOver60Count: 0,
        agingThresholdLabel: (agingPolicy === 'STANDARD_90_60' || (agingPolicy === 'EXCEL_PARITY' && code === 'BHS'))
          ? '90+d Non-Moving / 60–89d Slow-Moving'
          : '61+d Non-Moving / 31–60d Slow-Moving',
        branchTables: {
          ledgerRows: [],
          violationRows: [],
          nonMovingRows: [],
          slowMovingRows: []
        }
      });
    });
  }

  recordsByBranch.forEach((branchRecords, code) => {
    if (!siteMap.has(code)) {
      const first = branchRecords[0].current_site;
      siteMap.set(code, {
        code,
        tabIndex: EXCEL_BRANCH_ORDER.indexOf(code) !== -1 ? EXCEL_BRANCH_ORDER.indexOf(code) + 1 : 99,
        name: first.name,
        shortName: first.shortName,
        totalReceived: 0,
        usedCount: 0,
        inStockCount: 0,
        inStockValue: 0,
        fifoCompliantCount: 0,
        fifoViolationsCount: 0,
        outOfSequenceCount: 0,
        nonMovingCount: 0,
        nonMovingCost: 0,
        slowMovingCount: 0,
        slowMovingCost: 0,
        activeInStockCount: 0,
        activeInStockCost: 0,
        crossSiteCount: 0,
        agingOver60Count: 0,
        agingThresholdLabel: (agingPolicy === 'STANDARD_90_60' || (agingPolicy === 'EXCEL_PARITY' && code === 'BHS'))
          ? '90+d Non-Moving / 60–89d Slow-Moving'
          : '61+d Non-Moving / 31–60d Slow-Moving',
        branchTables: {
          ledgerRows: [],
          violationRows: [],
          nonMovingRows: [],
          slowMovingRows: []
        }
      });
    }

    const s = siteMap.get(code);
    s.branchTables.ledgerRows = branchRecords;

    branchRecords.forEach(r => {
      s.totalReceived++;
      if (r.is_used) {
        s.usedCount++;
        if (r.fifo_status.includes('VIOLATION')) {
          s.fifoViolationsCount++;
          s.branchTables.violationRows.push(r);
        } else {
          s.fifoCompliantCount++;
        }
        if (r.out_of_sequence_reasons?.length > 0) {
          s.outOfSequenceCount++;
        }
      } else {
        s.inStockCount++;
        s.inStockValue += r.unit_price;
        if (r.days_in_stock > 60) s.agingOver60Count++;
        if (r.aging_category === 'NON_MOVING') {
          s.nonMovingCount++;
          s.nonMovingCost += r.unit_price;
          s.branchTables.nonMovingRows.push(r);
        } else if (r.aging_category === 'SLOW_MOVING') {
          s.slowMovingCount++;
          s.slowMovingCost += r.unit_price;
          s.branchTables.slowMovingRows.push(r);
        } else {
          s.activeInStockCount++;
          s.activeInStockCost += r.unit_price;
        }
      }
      if (r.is_cross_site_discrepancy) s.crossSiteCount++;
    });
  });

  const sitesScorecard = Array.from(siteMap.values()).map(s => {
    const audited = s.usedCount;
    const complianceRate = audited > 0
      ? Number(((s.fifoCompliantCount / audited) * 100).toFixed(1))
      : 100;
    const is90 = agingPolicy === 'STANDARD_90_60' || agingPolicy === 'UNIFORM_90_60' || (agingPolicy === 'EXCEL_PARITY' && s.code === 'BHS');
    return {
      ...s,
      complianceRate,
      nonMovingValue: s.nonMovingCost,
      slowMovingValue: s.slowMovingCost,
      nonMovingThreshold: is90 ? 90 : 61,
      slowMovingThreshold: is90 ? 60 : 31,
      ledgerRows: s.branchTables.ledgerRows,
      violationRows: s.branchTables.violationRows,
      nonMovingRows: s.branchTables.nonMovingRows,
      slowMovingRows: s.branchTables.slowMovingRows,
      totalAgingCost: s.nonMovingCost + s.slowMovingCost
    };
  }).sort((a, b) => a.tabIndex - b.tabIndex || b.totalReceived - a.totalReceived);

  // Step 8: Automated Data Validation & Formula Audit Insights
  const validationSummary = [
    {
      id: 'dc-scope-filter',
      status: 'PASS',
      title: 'DC Stock Transfer Scope Filter (`From Stock` contains "DC")',
      detail: `Filtered ${rawTransfersCount.toLocaleString()} raw stock transfer rows down to ${totalSerials.toLocaleString()} official DC-to-Branch transfer rows across ${sitesScorecard.length} service branches.`
    },
    {
      id: 'gsx-kgb-reconciliation',
      status: 'PASS',
      title: 'GSX KGB Repair Consumption Cross-Lookup (`XLOOKUP` Parity)',
      detail: `Matched ${usedCount.toLocaleString()} consumed serials (${usedRate}%) against GSX closed iPhone Battery & Display repairs; ${inStockCount.toLocaleString()} serials remain in stock.`
    },
    {
      id: 'fifo-compliance-check',
      status: fifoViolationsCount > 0 ? 'WARN' : 'PASS',
      title: 'FIFO Compliance Validation (`COUNTIFS` Older Unused Stock Check)',
      detail: `${fifoCompliantCount.toLocaleString()} repairs (${fifoComplianceRate}%) complied with FIFO; ${fifoViolationsCount.toLocaleString()} repairs consumed newer parts while older units of the exact same Part Number remained unused in branch stock.`
    },
    {
      id: 'cross-site-transfers',
      status: crossSiteDiscrepanciesCount > 0 ? 'WARN' : 'PASS',
      title: 'Cross-Site Consumption Detection ("Transferred to [Site]")',
      detail: `${crossSiteDiscrepanciesCount.toLocaleString()} DC-transferred serials were consumed in GSX repairs at a different branch than their Fixably transfer destination.`
    },
    {
      id: 'duplicate-dc-serials',
      status: duplicateDcRowsCount > 0 ? 'INFO' : 'PASS',
      title: 'Duplicate DC Transfer Serial Check',
      detail: duplicateDcRowsCount > 0
        ? `Detected ${duplicateDcRowsCount} duplicate DC transfer entries (${duplicateSerials.map(d => d.serial_number).join(', ')}). Preserved all ${totalSerials.toLocaleString()} rows for 100% Excel sheet parity.`
        : 'All DC transfer serial numbers are unique.'
    }
  ];

  const uniqueDupSerials = Array.from(new Set(duplicateSerials.map(d => d.serial_number)));
  const missingPriceParts = Array.from(missingPricePartSet);

  return {
    records: reconciledRecords,
    sitesScorecard,
    kpis: {
      totalSerials,
      uniqueSerialsCount,
      duplicateDcRowsCount,
      duplicateTransferRowsCount: duplicateDcRowsCount,
      nonDcTransfersExcluded: Math.max(0, rawTransfersCount - totalSerials),
      totalTransfers: scopedTransfers.length,
      rawTransfersCount,
      usedCount,
      usedRate,
      inStockCount,
      inStockValue,
      fifoCompliantCount,
      fifoViolationsCount,
      outOfSequenceCount,
      fifoComplianceRate,
      nonMovingCount,
      nonMovingCost,
      nonMovingValue: nonMovingCost,
      slowMovingCount,
      slowMovingCost,
      slowMovingValue: slowMovingCost,
      activeInStockCount,
      activeStockCount: activeInStockCount,
      activeInStockCost,
      activeStockValue: activeInStockCost,
      totalAgingCost: nonMovingCost + slowMovingCost,
      crossSiteDiscrepanciesCount,
      agingOver60Count
    },
    orphanGsxRecords,
    duplicateSerials,
    validations: {
      duplicateTransferSerialsCount: uniqueDupSerials.length,
      duplicateTransferSerials: uniqueDupSerials,
      missingPricePartsCount: missingPriceParts.length,
      missingPriceParts
    },
    validationSummary
  };
}
