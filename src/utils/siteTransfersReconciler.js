import * as XLSX from 'xlsx';
import { resolvePartInfo } from './partResolver.js';

// Standard site mapping rules matching Google Sheet and Official Branch Directory
export const SITE_CODE_MAPPINGS = [
  { code: 'ABR', pattern: /\bABR\b|\bDAVAO\b/i, name: 'MOBILECARE - DAVAO', shortName: 'Davao' },
  { code: 'ANX', pattern: /\bANX\b|\bANNEX\b/i, name: 'MOBILECARE - APP THE ANNEX', shortName: 'The Annex' },
  { code: 'BHS', pattern: /\bBHS\b|\bBONIFACIO\b/i, name: 'MOBILECARE - APP BONIFACIO HIGH STREET', shortName: 'Bonifacio High Street' },
  { code: 'CDO', pattern: /\bCDO\b|\bCAGAYAN\b/i, name: 'MOBILECARE - CAGAYAN DE ORO', shortName: 'Cagayan De Oro' },
  { code: 'CEB', pattern: /\bCEB\b|\bCEBU\b/i, name: 'MOBILECARE - CEBU', shortName: 'Cebu' },
  { code: 'COT', pattern: /\bCOT\b|\bCOTABATO\b|\bCBO\b/i, name: 'MOBILECARE SERVICES - COTABATO', shortName: 'Cotabato' },
  { code: 'DC', pattern: /^DC\b|\bDC[-_]|\bDISTRIBUTION\b|\bWAREHOUSE\b/i, name: 'MOBILE CARE SERVICES PHILS. INC. - Distribution Center', shortName: 'Distribution Center' },
  { code: 'FES', pattern: /\bFES\b|\bFESTIVAL\b/i, name: 'MOBILECARE - APP FESTIVAL MALL', shortName: 'Festival Mall' },
  { code: 'GB3', pattern: /\bGB3\b|\bGREENBELT\b/i, name: 'MOBILECARE - APP GREENBELT 3', shortName: 'Greenbelt 3' },
  { code: 'GL5', pattern: /\bGL5\b|\bGLORIETTA\b/i, name: 'MOBILECARE - GLORIETTA 5', shortName: 'Glorietta 5' },
  { code: 'ILO', pattern: /\bILO\b|\bILOILO\b|\bFESTIVE\b|APPILO/i, name: 'MOBILECARE - FESTIVE WALK ILOILO', shortName: 'Iloilo' },
  { code: 'LAN', pattern: /\bLAN\b|\bLANANG\b/i, name: 'MOBILECARE - APP SM LANANG', shortName: 'SM Lanang' },
  { code: 'LAU', pattern: /\bLAU\b|\bUNION\b/i, name: 'MOBILECARE - LA UNION', shortName: 'La Union' },
  { code: 'LIM', pattern: /\bLIM\b|\bLIMA\b/i, name: 'MOBILECARE - LIMA ESTATE', shortName: 'Lima Estate' },
  { code: 'MAG', pattern: /\bMAG\b|\bMAGNOLIA\b|\bRM\b/i, name: 'MOBILECARE - APP MAGNOLIA', shortName: 'Magnolia' },
  { code: 'MEG', pattern: /\bMEG\b|\bMEGAMALL\b/i, name: 'MOBILECARE - APP MEGAMALL', shortName: 'Megamall' },
  { code: 'MOA', pattern: /\bMOA\b|\bMALL\s*OF\s*ASIA\b/i, name: 'MOBILECARE - APP MALL OF ASIA', shortName: 'Mall of Asia' },
  { code: 'MRK', pattern: /\bMRK\b|\bSM\s*MARIKINA\b|\bMARIKINA\b/i, name: 'MOBILECARE - SM MARIKINA', shortName: 'SM Marikina' },
  { code: 'NAG', pattern: /\bNAG\b|\bNAGA\b/i, name: 'MOBILECARE - NAGA', shortName: 'Naga' },
  { code: 'NES', pattern: /\bNES\b|\bNORTHEAST\b/i, name: 'MOBILECARE - NORTHEAST SQUARE', shortName: 'Northeast Square' },
  { code: 'NPM', pattern: /\bNPM\b|\bNEWPOINT\b/i, name: 'MOBILECARE - NEWPOINT MALL', shortName: 'Newpoint Mall' },
  { code: 'POD', pattern: /\bPOD\b|\bPODIUM\b/i, name: 'MOBILECARE - THE PODIUM', shortName: 'The Podium' },
  { code: 'PPM', pattern: /\bPPM\b|\bPOWER\s*PLANT\b/i, name: 'MOBILECARE - APP POWER PLANT MALL', shortName: 'Power Plant Mall' },
  { code: 'SMS', pattern: /\bSMS\b|\bS'?MAISON\b/i, name: "MOBILECARE - S'MAISON", shortName: "S'Maison" },
  { code: 'TRI', pattern: /\bTRI\b|\bTRINOMA\b/i, name: 'MOBILECARE - APP TRINOMA', shortName: 'Trinoma' },
  { code: 'VER', pattern: /\bVER\b|\bVERTIS\b|\bVN\b/i, name: 'MOBILECARE - VERTIS NORTH', shortName: 'Vertis North' },
  { code: 'ZAM', pattern: /\bZAM\b|\bZAMBOANGA\b/i, name: 'MOBILECARE - ZAMBOANGA', shortName: 'Zamboanga' }
];

/**
 * Normalizes any branch string, stock code, or GSX Location Name into standard site object.
 */
export function normalizeSite(input = '') {
  const str = String(input || '').trim();
  if (!str) {
    return { code: 'UNKNOWN', name: 'Unknown / Unassigned', shortName: 'Unknown' };
  }

  // Extract site code from strings like "GL5_MSPI-Owned" or "GL5_Repair"
  const prefixMatch = str.match(/^([A-Za-z0-9]+)[-_]/);
  const candidatePrefix = prefixMatch ? prefixMatch[1].toUpperCase() : '';

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
    shortName: cleanName
  };
}

/**
 * Parses a date value from Excel number or date string into standard ISO YYYY-MM-DD.
 */
export function normalizeDate(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    // Excel serial date conversion
    const utcDays = Math.floor(val - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    return dateInfo.toISOString().split('T')[0];
  }
  const str = String(val).trim();
  if (!str) return '';
  // Check YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // Check M/D/YYYY or D/M/YYYY
  const parts = str.split(/[-/]/);
  if (parts.length === 3) {
    let year = parts[2];
    if (year.length === 2) year = '20' + year;
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
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
 * Parses GSX KBB/KGBs Used Report file (XLSX or CSV, supporting ; or , delimiters)
 */
export async function parseGsxKbbKgbsUsedFile(file) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
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
        (rowStr.includes('kgb') || rowStr.includes('kbb') || rowStr.includes('serial') || rowStr.includes('code'))
      ) {
        headerIdx = r;
        break;
      }
    }

    if (headerIdx === -1) {
      headerIdx = 0;
    }

    const headers = (rawRows[headerIdx] || []).map(h => String(h || '').trim());
    let orderCol = -1, locCol = -1, repairCol = -1, stratCol = -1, statusCol = -1;
    let dateCol = -1, codeCol = -1, descCol = -1, kgbCol = -1, kbbCol = -1;

    headers.forEach((h, idx) => {
      const clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (/^order(id|num|no)?$/.test(clean) || clean.includes('orderid')) orderCol = idx;
      else if (/location(name)?|site|branch/.test(clean)) locCol = idx;
      else if (/repairnumber|gsxrepair|repairno|repairid/.test(clean)) repairCol = idx;
      else if (/strategy/.test(clean)) stratCol = idx;
      else if (/status/.test(clean)) statusCol = idx;
      else if (/repaircloseddate|closeddate|repairdate|date/.test(clean)) dateCol = idx;
      else if (/productcode|partnumber|partcode|itemcode|pn|code/.test(clean)) codeCol = idx;
      else if (/productdescription|partdescription|desc|description|name/.test(clean)) descCol = idx;
      else if (/productkgb|kgb|serialnumber|serial|sn/.test(clean)) kgbCol = idx;
      else if (/productkbb|kbb|returnserial/.test(clean)) kbbCol = idx;
    });

    // Sensible defaults if not labeled
    if (orderCol === -1) orderCol = 0;
    if (locCol === -1) locCol = 1;
    if (repairCol === -1) repairCol = 2;
    if (stratCol === -1) stratCol = 3;
    if (statusCol === -1) statusCol = 4;
    if (dateCol === -1) dateCol = 5;
    if (codeCol === -1) codeCol = 6;
    if (descCol === -1) descCol = 7;
    if (kgbCol === -1) kgbCol = 8;
    if (kbbCol === -1) kbbCol = 9;

    const records = [];
    for (let r = headerIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r] || [];
      const kgb = String(row[kgbCol] || '').trim().toUpperCase();
      const code = String(row[codeCol] || '').trim();
      const desc = String(row[descCol] || '').trim();
      const orderId = String(row[orderCol] || '').trim();
      const loc = String(row[locCol] || '').trim();
      const repairNo = String(row[repairCol] || '').trim();
      const rawDate = row[dateCol];
      const repairDate = normalizeDate(rawDate);
      const kbb = String(row[kbbCol] || '').trim().toUpperCase();
      const status = String(row[statusCol] || '').trim();

      // Skip row if completely empty
      if (!orderId && !kgb && !code && !desc) continue;

      const normSite = normalizeSite(loc);

      records.push({
        order_id: orderId,
        location_name: loc,
        site_code: normSite.code,
        site_name: normSite.name,
        gsx_repair_number: repairNo,
        gsx_repair_strategy: String(row[stratCol] || '').trim(),
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
 * Master Reconciler: Merges Stock Transfers with GSX KBB/KGBs Used Report
 * Implements FIFO compliance validation, cross-site leak detection, and aging calculations.
 * Scoped specifically to iPhone 13 and newer models.
 */
export function reconcileSiteTransfers(transferRecords = [], gsxRecords = [], partsCatalog = []) {
  // Filter transfers to only include iPhone 13 and up models
  const scopedTransfers = (transferRecords || []).filter(t => {
    const desc = t.product_name || t.part_description || t.description || '';
    return isIPhone13AndUp(desc);
  });

  if (!scopedTransfers.length) {
    return {
      records: [],
      sitesScorecard: [],
      kpis: {
        totalSerials: 0,
        totalTransfers: 0,
        usedCount: 0,
        usedRate: 0,
        inStockCount: 0,
        inStockValue: 0,
        fifoViolationsCount: 0,
        fifoComplianceRate: 100,
        crossSiteDiscrepanciesCount: 0,
        agingOver60Count: 0
      },
      orphanGsxRecords: []
    };
  }

  // 1. Build GSX lookup map by Product KGB (serial)
  // Serials in GSX can be used in repairs. Map normalized serial -> GSX record
  const gsxBySerial = new Map();
  gsxRecords.forEach(g => {
    const sn = (g.product_kgb || '').trim().toUpperCase();
    if (sn && sn !== 'N/A' && sn !== 'NA' && sn !== 'NONE' && sn !== '—' && sn !== '-' && !gsxBySerial.has(sn)) {
      gsxBySerial.set(sn, g);
    }
  });

  // 2. Group transfers by Serial Number to establish chain of custody and determine current holder
  const transfersBySerial = new Map();
  const nonSerializedTransfers = [];

  scopedTransfers.forEach(t => {
    const sn = (t.serial_number || '').trim().toUpperCase();
    const date = normalizeDate(t.transfer_received_date);
    const cleanedTransfer = {
      ...t,
      serial_number: sn,
      transfer_received_date: date,
      from_site: normalizeSite(t.from_stock),
      to_site: normalizeSite(t.to_stock)
    };

    if (!sn || sn === 'N/A' || sn === 'NA' || sn === 'NONE' || sn === '—' || sn === '-') {
      nonSerializedTransfers.push(cleanedTransfer);
      return;
    }

    if (!transfersBySerial.has(sn)) {
      transfersBySerial.set(sn, []);
    }
    transfersBySerial.get(sn).push(cleanedTransfer);
  });

  // 3. Process each serialized part to determine latest transfer, usage, FIFO, and discrepancies
  const reconciledRecords = [];
  const matchedGsxSerials = new Set();
  const now = new Date();

  transfersBySerial.forEach((transfers, serialNumber) => {
    // Sort chronologically by received date
    transfers.sort((a, b) => {
      const da = new Date(a.transfer_received_date || '1970-01-01').getTime();
      const db = new Date(b.transfer_received_date || '1970-01-01').getTime();
      return da - db;
    });

    const latestTransfer = transfers[transfers.length - 1];
    const initialTransfer = transfers[0];
    const currentSite = latestTransfer.to_site;
    const fromSite = latestTransfer.from_site;

    const gsxMatch = gsxBySerial.get(serialNumber) || null;
    if (gsxMatch) {
      matchedGsxSerials.add(serialNumber);
    }

    const isUsed = Boolean(gsxMatch && gsxMatch.repair_closed_date);
    const gsxSite = gsxMatch ? normalizeSite(gsxMatch.location_name) : null;

    // Route category: DC to Site vs Site to Site vs Internal Repair
    let transferType = 'SITE_TO_SITE';
    const fromStockLower = (latestTransfer.from_stock || '').toLowerCase();
    const toStockLower = (latestTransfer.to_stock || '').toLowerCase();
    if (fromStockLower.includes('dc')) {
      transferType = 'DC_TO_SITE';
    } else if (toStockLower.includes('repair') || fromStockLower.includes('repair')) {
      transferType = 'INTERNAL_REPAIR';
    }

    // Cross-site discrepancy check:
    // Transferred to Site A, but GSX repair closed at Site B
    let isCrossSiteDiscrepancy = false;
    let crossSiteDetail = null;
    if (isUsed && gsxSite && currentSite.code !== 'UNKNOWN') {
      if (gsxSite.code !== currentSite.code) {
        isCrossSiteDiscrepancy = true;
        crossSiteDetail = {
          transferredTo: currentSite.name,
          transferredToCode: currentSite.code,
          usedAt: gsxSite.name,
          usedAtCode: gsxSite.code
        };
      }
    }

    // Days in stock calculation (aging)
    const recDate = new Date(latestTransfer.transfer_received_date || now);
    const daysInStock = isUsed
      ? Math.max(0, Math.floor((new Date(gsxMatch.repair_closed_date) - recDate) / (1000 * 60 * 60 * 24)))
      : Math.max(0, Math.floor((now - recDate) / (1000 * 60 * 60 * 24)));

    let agingBucket = '< 15 days';
    if (daysInStock > 90) agingBucket = '90+ days';
    else if (daysInStock > 60) agingBucket = '61-90 days';
    else if (daysInStock > 30) agingBucket = '31-60 days';
    else if (daysInStock >= 15) agingBucket = '15-30 days';

    // Unit Valuation
    const resolvedPart = resolvePartInfo(latestTransfer.product_code, partsCatalog);
    let unitPrice = Number(latestTransfer.transfer_value) || 0;
    if (unitPrice <= 0 && resolvedPart && Number(resolvedPart.stocking_price) > 0) {
      unitPrice = Number(resolvedPart.stocking_price);
    }
    if (unitPrice <= 0) {
      const descLower = (latestTransfer.product_name || '').toLowerCase();
      if (descLower.includes('display') || descLower.includes('screen')) unitPrice = 279;
      else if (descLower.includes('battery')) unitPrice = 99;
      else if (descLower.includes('camera')) unitPrice = 149;
      else if (descLower.includes('back glass') || descLower.includes('rear system')) unitPrice = 129;
      else unitPrice = 89;
    }

    reconciledRecords.push({
      serial_number: serialNumber,
      product_code: latestTransfer.product_code,
      product_name: latestTransfer.product_name || resolvedPart?.description || '',
      category_id: resolvedPart?.category_id || '',
      transfer_received_date: latestTransfer.transfer_received_date,
      first_received_date: initialTransfer.transfer_received_date,
      transfer_count: transfers.length,
      transfer_trail: transfers.map(t => ({
        date: t.transfer_received_date,
        from: t.from_stock,
        to: t.to_stock,
        qty: t.transfer_quantity
      })),
      from_stock: latestTransfer.from_stock,
      from_site: fromSite,
      to_stock: latestTransfer.to_stock,
      current_site: currentSite,
      transfer_type: transferType,
      unit_price: unitPrice,
      is_used: isUsed,
      days_in_stock: daysInStock,
      aging_bucket: agingBucket,
      // GSX Details
      gsx_order_id: gsxMatch?.order_id || '',
      gsx_repair_number: gsxMatch?.gsx_repair_number || '',
      repair_closed_date: gsxMatch?.repair_closed_date || '',
      gsx_location_name: gsxMatch?.location_name || '',
      gsx_site: gsxSite,
      product_kbb: gsxMatch?.product_kbb || '',
      // Discrepancy details
      is_cross_site_discrepancy: isCrossSiteDiscrepancy,
      cross_site_detail: crossSiteDetail,
      // FIFO Status (Computed in Step 4 below)
      fifo_status: isUsed ? 'FIFO_COMPLIANT' : 'IN_STOCK',
      fifo_violation_reasons: []
    });
  });

  // 4. FIFO Compliance Algorithm: Group by site and product code
  // Parity with Google Sheet: MAP(a, b, e, IF(b="", "In Stock", IF(COUNTIFS(E:E, e, A:A, "<" & a, B:B, "") > 0, "FIFO Violation", "FIFO Compliant")))
  const recordsBySiteAndSku = new Map();
  reconciledRecords.forEach(r => {
    const key = `${r.current_site.code}__${r.product_code}`;
    if (!recordsBySiteAndSku.has(key)) {
      recordsBySiteAndSku.set(key, []);
    }
    recordsBySiteAndSku.get(key).push(r);
  });

  recordsBySiteAndSku.forEach(records => {
    // Sort chronologically by transfer_received_date
    records.sort((a, b) => {
      const da = new Date(a.transfer_received_date || '1970-01-01').getTime();
      const db = new Date(b.transfer_received_date || '1970-01-01').getTime();
      return da - db;
    });

    records.forEach(r => {
      if (!r.is_used) {
        r.fifo_status = 'IN_STOCK';
        return;
      }

      // Check if there are older units of the SAME SKU received at the SAME site
      const myArrival = new Date(r.transfer_received_date || '1970-01-01').getTime();
      const myUsedDate = new Date(r.repair_closed_date || '1970-01-01').getTime();

      const olderUnits = records.filter(other => {
        if (other.serial_number === r.serial_number) return false;
        const otherArrival = new Date(other.transfer_received_date || '1970-01-01').getTime();
        return otherArrival < myArrival;
      });

      // Older units still in stock (unused)
      const olderUnused = olderUnits.filter(o => !o.is_used);

      // Older units that were used AFTER this unit (out of sequence)
      const olderUsedAfter = olderUnits.filter(o => {
        if (!o.is_used) return false;
        const oUsedDate = new Date(o.repair_closed_date || '1970-01-01').getTime();
        return oUsedDate > myUsedDate;
      });

      if (olderUnused.length > 0) {
        r.fifo_status = 'FIFO_VIOLATION_OLDER_IN_STOCK';
        r.fifo_violation_reasons = olderUnused.map(o => ({
          type: 'OLDER_STOCK_IDLE',
          olderSerial: o.serial_number,
          olderArrival: o.transfer_received_date,
          olderDaysInStock: o.days_in_stock
        }));
      } else if (olderUsedAfter.length > 0) {
        r.fifo_status = 'FIFO_VIOLATION_OUT_OF_SEQUENCE';
        r.fifo_violation_reasons = olderUsedAfter.map(o => ({
          type: 'USED_OUT_OF_SEQUENCE',
          olderSerial: o.serial_number,
          olderArrival: o.transfer_received_date,
          olderUsedDate: o.repair_closed_date
        }));
      } else {
        r.fifo_status = 'FIFO_COMPLIANT';
      }
    });
  });

  // 5. Find Orphan GSX Records (Used in GSX repairs but never transferred in Fixably)
  const orphanGsxRecords = [];
  gsxRecords.forEach(g => {
    const sn = (g.product_kgb || '').trim().toUpperCase();
    if (sn && !transfersBySerial.has(sn) && isIPhone13AndUp(g.product_description)) {
      orphanGsxRecords.push({
        ...g,
        site: normalizeSite(g.location_name)
      });
    }
  });

  // 6. Compute Rollup KPIs
  let totalSerials = reconciledRecords.length;
  let usedCount = 0;
  let inStockCount = 0;
  let inStockValue = 0;
  let fifoViolationsCount = 0;
  let fifoCompliantCount = 0;
  let crossSiteDiscrepanciesCount = 0;
  let agingOver60Count = 0;

  reconciledRecords.forEach(r => {
    if (r.is_used) {
      usedCount++;
      if (r.fifo_status.includes('VIOLATION')) {
        fifoViolationsCount++;
      } else if (r.fifo_status === 'FIFO_COMPLIANT') {
        fifoCompliantCount++;
      }
    } else {
      inStockCount++;
      inStockValue += r.unit_price;
      if (r.days_in_stock > 60) {
        agingOver60Count++;
      }
    }
    if (r.is_cross_site_discrepancy) {
      crossSiteDiscrepanciesCount++;
    }
  });

  const totalAuditedForFifo = usedCount;
  const fifoComplianceRate = totalAuditedForFifo > 0
    ? Number(((fifoCompliantCount / totalAuditedForFifo) * 100).toFixed(1))
    : 100;

  const usedRate = totalSerials > 0
    ? Number(((usedCount / totalSerials) * 100).toFixed(1))
    : 0;

  // 7. Compute Site-by-Site Scorecards (Mirroring individual site tabs in Google Sheet)
  const siteMap = new Map();
  reconciledRecords.forEach(r => {
    const code = r.current_site.code;
    if (!siteMap.has(code)) {
      siteMap.set(code, {
        code,
        name: r.current_site.name,
        shortName: r.current_site.shortName,
        totalReceived: 0,
        usedCount: 0,
        inStockCount: 0,
        inStockValue: 0,
        fifoCompliantCount: 0,
        fifoViolationsCount: 0,
        crossSiteCount: 0,
        agingOver60Count: 0
      });
    }

    const s = siteMap.get(code);
    s.totalReceived++;
    if (r.is_used) {
      s.usedCount++;
      if (r.fifo_status.includes('VIOLATION')) s.fifoViolationsCount++;
      else s.fifoCompliantCount++;
    } else {
      s.inStockCount++;
      s.inStockValue += r.unit_price;
      if (r.days_in_stock > 60) s.agingOver60Count++;
    }
    if (r.is_cross_site_discrepancy) s.crossSiteCount++;
  });

  const sitesScorecard = Array.from(siteMap.values()).map(s => {
    const audited = s.usedCount;
    const complianceRate = audited > 0
      ? Number(((s.fifoCompliantCount / audited) * 100).toFixed(1))
      : 100;
    return {
      ...s,
      complianceRate
    };
  }).sort((a, b) => b.totalReceived - a.totalReceived);

  return {
    records: reconciledRecords,
    sitesScorecard,
    kpis: {
      totalSerials,
      totalTransfers: scopedTransfers.length,
      usedCount,
      usedRate,
      inStockCount,
      inStockValue,
      fifoViolationsCount,
      fifoComplianceRate,
      crossSiteDiscrepanciesCount,
      agingOver60Count
    },
    orphanGsxRecords
  };
}
