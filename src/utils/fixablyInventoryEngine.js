import * as XLSX from 'xlsx';
import knownDcSerialsList from '../data/knownDcSerials.json' with { type: 'json' };
import { OFFICIAL_BRANCH_DIRECTORY } from '../constants/branchDirectory.js';
import { normalizeSite, normalizeDate } from './siteTransfersReconciler.js';
import { getPartCategory } from './categoryFilter.js';
import { resolveCanonicalIPhoneModel } from './partResolver.js';

export { normalizeSite, normalizeDate };

// Pre-index known DC transfer serials for O(1) matching
const KNOWN_DC_SERIALS_SET = new Set(
  (knownDcSerialsList || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean)
);

/**
 * Standardized site code to branch directory mapping
 */
export const STANDARDIZED_SITE_CODES = [
  { code: 'ABR', name: 'MOBILECARE - DAVAO', city: 'Davao' },
  { code: 'ANX', name: 'MOBILECARE - APP THE ANNEX', city: 'The Annex' },
  { code: 'BHS', name: 'MOBILECARE - APP BONIFACIO HIGH STREET', city: 'Bonifacio High Street' },
  { code: 'CDO', name: 'MOBILECARE - CAGAYAN DE ORO', city: 'Cagayan De Oro' },
  { code: 'CEB', name: 'MOBILECARE - CEBU', city: 'Cebu' },
  { code: 'COT', altCode: 'CBO', name: 'MOBILECARE SERVICES - COTABATO', city: 'Cotabato' },
  { code: 'FES', name: 'MOBILECARE - APP FESTIVAL MALL', city: 'Festival Mall' },
  { code: 'GB3', name: 'MOBILECARE - APP GREENBELT 3', city: 'Greenbelt 3' },
  { code: 'GL5', name: 'MOBILECARE - GLORIETTA 5', city: 'Glorietta 5' },
  { code: 'ILO', altCode: 'APP ILO', name: 'MOBILECARE - FESTIVE WALK ILOILO', city: 'Iloilo' },
  { code: 'LAN', name: 'MOBILECARE - APP SM LANANG', city: 'SM Lanang' },
  { code: 'LAU', name: 'MOBILECARE - LA UNION', city: 'La Union' },
  { code: 'LIM', name: 'MOBILECARE - LIMA ESTATE', city: 'Lima Estate' },
  { code: 'MAG', altCode: 'RM', name: 'MOBILECARE - APP MAGNOLIA', city: 'Magnolia' },
  { code: 'MEG', name: 'MOBILECARE - APP MEGAMALL', city: 'Megamall' },
  { code: 'MOA', name: 'MOBILECARE - APP MALL OF ASIA', city: 'Mall of Asia' },
  { code: 'MRK', name: 'MOBILECARE - SM MARIKINA', city: 'SM Marikina' },
  { code: 'NAG', name: 'MOBILECARE - NAGA', city: 'Naga' },
  { code: 'NES', name: 'MOBILECARE - NORTHEAST SQUARE', city: 'Northeast Square' },
  { code: 'NPM', name: 'MOBILECARE - NEWPOINT MALL', city: 'Newpoint Mall' },
  { code: 'POD', name: 'MOBILECARE - THE PODIUM', city: 'The Podium' },
  { code: 'PPM', name: 'MOBILECARE - APP POWER PLANT MALL', city: 'Power Plant Mall' },
  { code: 'SMS', name: "MOBILECARE - S'MAISON", city: "S'Maison" },
  { code: 'TRI', name: 'MOBILECARE - APP TRINOMA', city: 'Trinoma' },
  { code: 'VER', altCode: 'VN', name: 'MOBILECARE - VERTIS NORTH', city: 'Vertis North' },
  { code: 'ZAM', name: 'MOBILECARE - ZAMBOANGA', city: 'Zamboanga' }
];

/**
 * Aging Bracket Constants
 */
export const AGING_BRACKETS = {
  IN_STOCK: 'In Stock',
  SLOW_MOVING: 'Slow-Moving',
  NON_MOVING: 'Non-Moving',
  DEAD_STOCK: 'Dead Stock'
};

/**
 * Calculates aging days and assigns categorization matching Fixably reporting.
 * - In Stock (Active): < 60 days
 * - Slow-Moving: 60 - 89 days
 * - Non-Moving: 90 - 179 days
 * - Dead Stock: >= 180 days (Label: "Dead Stock - Action Required (X days)")
 */
export function calculateAging(lastReceivedDate, currentDate = new Date()) {
  const normDateStr = normalizeDate(lastReceivedDate);
  if (!normDateStr) {
    return {
      days: 0,
      bracket: AGING_BRACKETS.IN_STOCK,
      statusLabel: 'In Stock (Active)',
      badgeColor: '#10b981',
      badgeBg: '#ecfdf5',
      receivedDate: ''
    };
  }

  const recDate = new Date(`${normDateStr}T00:00:00Z`);
  const curr = typeof currentDate === 'string' ? new Date(`${currentDate.split('T')[0]}T00:00:00Z`) : new Date(currentDate);
  const diffMs = curr.getTime() - recDate.getTime();
  const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (days >= 180) {
    return {
      days,
      bracket: AGING_BRACKETS.DEAD_STOCK,
      statusLabel: `Dead Stock - Action Required (${days} days)`,
      badgeColor: '#dc2626',
      badgeBg: '#fef2f2',
      receivedDate: normDateStr
    };
  }
  if (days >= 90) {
    return {
      days,
      bracket: AGING_BRACKETS.NON_MOVING,
      statusLabel: `Non-Moving (${days} days)`,
      badgeColor: '#ea580c',
      badgeBg: '#fff7ed',
      receivedDate: normDateStr
    };
  }
  if (days >= 60) {
    return {
      days,
      bracket: AGING_BRACKETS.SLOW_MOVING,
      statusLabel: `Slow-Moving (${days} days)`,
      badgeColor: '#d97706',
      badgeBg: '#fffbeb',
      receivedDate: normDateStr
    };
  }
  return {
    days,
    bracket: AGING_BRACKETS.IN_STOCK,
    statusLabel: `In Stock (${days} days)`,
    badgeColor: '#16a34a',
    badgeBg: '#f0fdf4',
    receivedDate: normDateStr
  };
}

/**
 * Classifies an item/serial as DC Stock vs MSPI-Owned / C/I REP.
 */
export function classifyStockType(serial, stockName = '', stockType = '', dynamicDcSerials = null) {
  const cleanSerial = String(serial || '').trim().toUpperCase();
  const cleanStockName = String(stockName || '').toUpperCase();
  const cleanStockType = String(stockType || '').toUpperCase();

  // 1. Check if serial is in dynamic DC serials set (passed from stock_transfer.csv)
  if (cleanSerial && dynamicDcSerials && dynamicDcSerials.has(cleanSerial)) {
    return 'DC Stock';
  }

  // 2. Check if serial is in known DC transfer serials set
  if (cleanSerial && KNOWN_DC_SERIALS_SET.has(cleanSerial)) {
    return 'DC Stock';
  }

  // 3. Check if stockName or stockType explicitly indicates DC origin
  if (cleanStockName.includes('DC') || cleanStockType.includes('DC')) {
    return 'DC Stock';
  }

  // Default to MSPI-Owned / C/I REP
  return 'MSPI-Owned / C/I REP';
}

/**
 * Robust CSV line parser handling semicolons or commas and quoted values with commas/semicolons.
 */
export function parseDelimitedLine(line, delim = ';') {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delim && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Helper to extract plain text string from File, Blob, ArrayBuffer, or string.
 */
export async function extractTextContent(fileOrContent) {
  if (typeof fileOrContent === 'string') return fileOrContent;
  if (fileOrContent && typeof fileOrContent.text === 'function') {
    return await fileOrContent.text();
  }
  if (fileOrContent instanceof ArrayBuffer) {
    return new TextDecoder().decode(fileOrContent);
  }
  if (fileOrContent && fileOrContent.data) {
    return String(fileOrContent.data);
  }
  return '';
}

/**
 * Auto-detects and validates an uploaded Fixably file.
 * Returns { valid, detectedType, rowCount, delimiter, message, error }
 * Types: 'site_stock' | 'kgb_used' | 'stock_transfer'
 */
export async function validateFixablyFile(fileOrContent, expectedType = null) {
  try {
    const text = await extractTextContent(fileOrContent);
    if (!text || text.trim().length === 0) {
      return { valid: false, error: 'The file is empty.' };
    }

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return { valid: false, error: 'File contains no data rows.' };
    }

    const first5Lines = lines.slice(0, 5).join('\n').toLowerCase();
    let detectedType = null;
    let delimiter = ',';

    // 1. Detect KGB Used Report
    if (
      first5Lines.includes('product kgb') ||
      first5Lines.includes('kgb') ||
      first5Lines.includes('gsx kbb / kgb') ||
      (first5Lines.includes('repair closed date') && first5Lines.includes('order id'))
    ) {
      detectedType = 'kgb_used';
      delimiter = lines[0].includes(';') ? ';' : ',';
    }
    // 2. Detect Stock Transfer Report
    else if (
      first5Lines.includes('stock transfer') ||
      (first5Lines.includes('from stock') && first5Lines.includes('to stock')) ||
      (first5Lines.includes('transfer received') && first5Lines.includes('transfer quantity'))
    ) {
      detectedType = 'stock_transfer';
      delimiter = lines[0].includes(';') ? ';' : ',';
    }
    // 3. Detect Site Stock (output.csv)
    else if (
      (first5Lines.includes('stock name') || first5Lines.includes('mspi-owned') || first5Lines.includes('stock type')) &&
      first5Lines.includes('part number')
    ) {
      detectedType = 'site_stock';
      delimiter = lines[0].includes(';') ? ';' : ',';
    }

    if (!detectedType) {
      return {
        valid: false,
        error: 'Unable to recognize Fixably report structure. Please check the file headers.'
      };
    }

    if (expectedType && detectedType !== expectedType) {
      const typeLabels = {
        site_stock: 'Site Stocks (output.csv)',
        kgb_used: 'GSX KGB Used Report',
        stock_transfer: 'Stock Transfers Report'
      };
      return {
        valid: false,
        detectedType,
        error: `Incorrect file: Detected ${typeLabels[detectedType]}, but this slot expects ${typeLabels[expectedType]}.`
      };
    }

    return {
      valid: true,
      detectedType,
      rowCount: lines.length - 1,
      delimiter,
      message: `Valid ${detectedType === 'site_stock' ? 'Site Stocks' : detectedType === 'kgb_used' ? 'KGB Used' : 'Stock Transfers'} file (${lines.length - 1} rows)`
    };
  } catch (err) {
    return { valid: false, error: `Validation error: ${err.message}` };
  }
}

/**
 * Parses KGB Used report CSV/text.
 * Skips report title row if present, extracts closed repairs and serials.
 */
export async function parseKgbUsedCsv(fileOrContent) {
  try {
    const text = await extractTextContent(fileOrContent);
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return { success: false, error: 'KGB Used file is empty.' };
    }

    // Determine header row (typically row 0 or 1)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const lower = lines[i].toLowerCase();
      if (lower.includes('product kgb') || lower.includes('order id') || lower.includes('repair closed')) {
        headerIdx = i;
        break;
      }
    }

    const delim = lines[headerIdx].includes(';') ? ';' : ',';
    const headers = parseDelimitedLine(lines[headerIdx], delim).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));

    const getIdx = (patterns) => headers.findIndex(h => patterns.some(p => h.includes(p)));

    const idxOrder = getIdx(['order id', 'order', 'repair id']);
    const idxLoc = getIdx(['location name', 'location', 'site', 'branch']);
    const idxRepairNum = getIdx(['gsx repair number', 'repair number', 'repair no']);
    const idxStrategy = getIdx(['gsx repair strategy', 'strategy']);
    const idxStatus = getIdx(['current gsx status', 'gsx status', 'status']);
    const idxClosedDate = getIdx(['repair closed date', 'closed date', 'repair date', 'date']);
    const idxCode = getIdx(['product code', 'part number', 'code']);
    const idxDesc = getIdx(['product description', 'description', 'part desc']);
    const idxKgb = getIdx(['product kgb', 'kgb', 'serial', 'consumed serial']);
    const idxKbb = getIdx(['product kbb', 'kbb', 'return serial']);

    if (idxKgb === -1) {
      return { success: false, error: 'Missing required "Product KGB" column in KGB Used file.' };
    }

    const kgbMap = new Map();
    let totalClosed = 0;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = parseDelimitedLine(lines[i], delim);
      if (!cols || cols.length <= idxKgb) continue;

      const serial = String(cols[idxKgb] || '').replace(/^"|"$/g, '').trim().toUpperCase();
      const status = String(cols[idxStatus] || '').replace(/^"|"$/g, '').trim().toUpperCase();
      const rawDate = cols[idxClosedDate] || '';
      const orderId = String(cols[idxOrder] || '').replace(/^"|"$/g, '').trim();

      if (!serial) continue;

      const isClosed = status === 'SCOM' || status === 'SPCM' || !status || status.includes('SCOM') || status.includes('SPCM');
      if (isClosed) totalClosed++;

      kgbMap.set(serial, {
        serial,
        orderId,
        locationName: String(cols[idxLoc] || '').replace(/^"|"$/g, '').trim(),
        gsxRepairNumber: String(cols[idxRepairNum] || '').replace(/^"|"$/g, '').trim(),
        repairStrategy: String(cols[idxStrategy] || '').replace(/^"|"$/g, '').trim(),
        gsxStatus: status || 'SCOM',
        repairClosedDate: normalizeDate(rawDate),
        rawClosedDate: rawDate,
        productCode: String(cols[idxCode] || '').replace(/^"|"$/g, '').trim(),
        productDescription: String(cols[idxDesc] || '').replace(/^"|"$/g, '').trim(),
        productKbb: String(cols[idxKbb] || '').replace(/^"|"$/g, '').trim()
      });
    }

    return {
      success: true,
      totalRows: lines.length - headerIdx - 1,
      totalClosed,
      uniqueSerials: kgbMap.size,
      kgbMap
    };
  } catch (err) {
    console.error('parseKgbUsedCsv error:', err);
    return { success: false, error: `Failed to parse KGB Used file: ${err.message}` };
  }
}

/**
 * Parses Stock Transfer report CSV/text.
 * Skips report title row if present, extracts all DC transfer serials.
 */
export async function parseStockTransferCsv(fileOrContent) {
  try {
    const text = await extractTextContent(fileOrContent);
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return { success: false, error: 'Stock Transfer file is empty.' };
    }

    // Determine header row
    let headerIdx = 0;
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const lower = lines[i].toLowerCase();
      if (lower.includes('from stock') || lower.includes('to stock') || lower.includes('serial number')) {
        headerIdx = i;
        break;
      }
    }

    const delim = lines[headerIdx].includes(';') ? ';' : ',';
    const headers = parseDelimitedLine(lines[headerIdx], delim).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));

    const getIdx = (patterns) => headers.findIndex(h => patterns.some(p => h.includes(p)));

    const idxDate = getIdx(['transfer received date', 'received date', 'date']);
    const idxFrom = getIdx(['from stock', 'from']);
    const idxTo = getIdx(['to stock', 'to']);
    const idxCode = getIdx(['product code', 'part number', 'code']);
    const idxName = getIdx(['product name', 'description', 'name']);
    const idxQty = getIdx(['transfer quantity', 'quantity', 'qty']);
    const idxSerial = getIdx(['serial number', 'serial', 's/n']);
    const idxVal = getIdx(['transfer value', 'value', 'price']);

    if (idxSerial === -1) {
      return { success: false, error: 'Missing required "Serial Number" column in Stock Transfer file.' };
    }

    const dcSerials = new Set();
    const transfers = [];

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = parseDelimitedLine(lines[i], delim);
      if (!cols || cols.length <= idxSerial) continue;

      const serial = String(cols[idxSerial] || '').replace(/^"|"$/g, '').trim().toUpperCase();
      const fromStock = String(cols[idxFrom] || '').replace(/^"|"$/g, '').trim().toUpperCase();
      const toStock = String(cols[idxTo] || '').replace(/^"|"$/g, '').trim();

      if (!serial) continue;

      const isFromDc = fromStock.includes('DC');
      if (isFromDc) {
        dcSerials.add(serial);
      }

      transfers.push({
        receivedDate: normalizeDate(cols[idxDate]),
        fromStock,
        toStock,
        productCode: String(cols[idxCode] || '').replace(/^"|"$/g, '').trim(),
        productName: String(cols[idxName] || '').replace(/^"|"$/g, '').trim(),
        quantity: parseInt(cols[idxQty], 10) || 1,
        serialNumber: serial,
        transferValue: parseFloat(cols[idxVal]) || 0,
        isFromDc
      });
    }

    return {
      success: true,
      totalRows: lines.length - headerIdx - 1,
      transfers,
      dcSerials,
      dcTransfersCount: dcSerials.size
    };
  } catch (err) {
    console.error('parseStockTransferCsv error:', err);
    return { success: false, error: `Failed to parse Stock Transfer file: ${err.message}` };
  }
}

/**
 * Parses Fixably export CSV (e.g. output.csv) and joins with optional KGB & Transfer records.
 */
export async function parseFixablyExportCsv(fileOrContent, options = {}) {
  try {
    let text = '';
    let fileName = 'output.csv';

    if (typeof fileOrContent === 'string') {
      text = fileOrContent;
    } else if (fileOrContent && typeof fileOrContent.text === 'function') {
      fileName = fileOrContent.name || fileName;
      text = await fileOrContent.text();
    } else if (fileOrContent instanceof ArrayBuffer) {
      text = new TextDecoder().decode(fileOrContent);
    } else if (fileOrContent && fileOrContent.data) {
      text = String(fileOrContent.data);
    } else {
      return { success: false, error: 'Invalid file input for Fixably CSV parsing.' };
    }

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return { success: false, error: 'CSV file contains no inventory records.' };
    }

    // Auto-detect delimiter (; or ,)
    const delim = lines[0].includes(';') ? ';' : ',';
    const headerRow = parseDelimitedLine(lines[0], delim).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));

    const getColIdx = (aliases) => headerRow.findIndex(h => aliases.some(a => h.includes(a)));

    const idxStockName = getColIdx(['stock name', 'location', 'site', 'branch']);
    const idxStockType = getColIdx(['stock type', 'type']);
    const idxPartNumber = getColIdx(['part number', 'part #', 'p/n', 'code']);
    const idxPartDesc = getColIdx(['part description', 'description', 'desc', 'product name']);
    const idxPartSerial = getColIdx(['part serial', 'serial', 's/n', 'imei']);
    const idxPartImei = getColIdx(['part imei', 'imei']);
    const idxLastReceived = getColIdx(['last received date', 'received date', 'last received', 'date']);
    const idxQty = getColIdx(['quantity', 'qty']);
    const idxPartValue = getColIdx(['part value', 'unit value', 'value', 'price']);
    const idxTotalValue = getColIdx(['total value', 'total']);

    if (idxPartNumber === -1 && idxPartDesc === -1) {
      return { success: false, error: 'Required column "Part Number" was not found in the CSV header.' };
    }

    const currentDate = options.currentDate || new Date('2026-10-09T00:00:00Z');
    const dynamicDcSerials = options.dynamicDcSerials instanceof Set ? options.dynamicDcSerials : null;
    const kgbUsedMap = options.kgbUsedMap instanceof Map ? options.kgbUsedMap : null;
    const siteCatalog = options.sites || [];

    const items = [];
    const investigationItems = [];
    const siteMap = new Map();
    const partsCatalogMap = new Map();
    let totalNetworkUnits = 0;
    let totalNetworkValue = 0;
    const globalAgingCounts = {
      [AGING_BRACKETS.IN_STOCK]: 0,
      [AGING_BRACKETS.SLOW_MOVING]: 0,
      [AGING_BRACKETS.NON_MOVING]: 0,
      [AGING_BRACKETS.DEAD_STOCK]: 0
    };
    const globalClassificationCounts = {
      'DC Stock': 0,
      'MSPI-Owned / C/I REP': 0
    };

    for (let i = 1; i < lines.length; i++) {
      const cols = parseDelimitedLine(lines[i], delim);
      if (!cols || cols.length <= 1) continue;

      const rawStockName = (cols[idxStockName] || '').replace(/^"|"$/g, '').trim();
      const rawStockType = (cols[idxStockType] || '').replace(/^"|"$/g, '').trim();
      const rawPartNumber = (cols[idxPartNumber] || '').replace(/^"|"$/g, '').trim();
      const rawDescription = (cols[idxPartDesc] || '').replace(/^"|"$/g, '').trim();
      const rawSerial = (cols[idxPartSerial] || '').replace(/^"|"$/g, '').trim();
      const rawImei = idxPartImei !== -1 ? (cols[idxPartImei] || '').replace(/^"|"$/g, '').trim() : '';
      const rawLastReceived = (cols[idxLastReceived] || '').replace(/^"|"$/g, '').trim();
      const rawQty = parseInt((cols[idxQty] || '1').replace(/[^0-9]/g, ''), 10) || 1;
      const rawPartVal = parseFloat((cols[idxPartValue] || '0').replace(/[^0-9.]/g, '')) || 0;
      const rawTotalVal = parseFloat((cols[idxTotalValue] || '0').replace(/[^0-9.]/g, '')) || (rawPartVal * rawQty);

      if (!rawPartNumber && !rawDescription) continue;

      const cleanPn = rawPartNumber.split(/[;,]/)[0].trim().toUpperCase();
      const cleanSerial = rawSerial.trim().toUpperCase();
      const isBlankSerial = !cleanSerial || ['NOT VISIBLE', 'N/A', 'N//A', 'NONE', 'UNKNOWN', 'FOR DELETE'].includes(cleanSerial);

      // Site normalization
      const normSite = normalizeSite(rawStockName);
      let matchedSite = siteCatalog.find(s => {
        if (!s) return false;
        const code = String(s.code || '').toUpperCase();
        const clean = code.replace(/^(ASP|APP)\s+/, '');
        return code === normSite.code || clean === normSite.code ||
          (normSite.code === 'VER' && (clean === 'VN' || code === 'ASP VN')) ||
          (normSite.code === 'MAG' && (clean === 'RM' || code === 'APP RM')) ||
          (normSite.code === 'ILO' && (clean === 'ILO' || code === 'ASP ILO')) ||
          (normSite.code === 'COT' && (clean === 'COT' || code === 'ASP COT'));
      });

      const siteCode = matchedSite?.code || normSite.code;
      const siteName = matchedSite?.name || normSite.name;
      const siteId = matchedSite?.id || `site-${siteCode.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

      // Stock Classification
      const stockClassification = classifyStockType(cleanSerial, rawStockName, rawStockType, dynamicDcSerials);

      // Aging
      const aging = calculateAging(rawLastReceived, currentDate);

      // Cross-File Reconciliation with KGB Used
      const kgbMatch = !isBlankSerial && kgbUsedMap ? kgbUsedMap.get(cleanSerial) : null;
      const isFlaggedInvestigation = Boolean(kgbMatch);

      const itemRecord = {
        id: `fixably-${i}-${cleanPn}-${cleanSerial || 'noserial'}`,
        rowIndex: i,
        stockName: rawStockName,
        stockType: stockClassification,
        rawStockType,
        partNumber: cleanPn,
        part_number: cleanPn,
        description: rawDescription,
        serialNumber: cleanSerial,
        serial_number: cleanSerial,
        raw_serial: cleanSerial,
        imei: rawImei,
        lastReceivedDate: aging.receivedDate,
        dateReceived: aging.receivedDate,
        received_at: aging.receivedDate,
        quantity: rawQty,
        partValue: rawPartVal,
        totalValue: rawTotalVal,
        stocking_price: rawPartVal,
        siteCode,
        site_code: siteCode,
        siteName,
        site_name: siteName,
        siteId,
        current_site_id: siteId,
        agingDays: aging.days,
        agingBracket: aging.bracket,
        statusLabel: aging.statusLabel,
        badgeColor: aging.badgeColor,
        badgeBg: aging.badgeBg,
        isSerialized: !isBlankSerial,
        status: 'VALID',
        isInvestigation: isFlaggedInvestigation,
        isFlaggedInvestigation,
        investigationDetails: kgbMatch || null
      };

      items.push(itemRecord);
      if (isFlaggedInvestigation) {
        investigationItems.push(itemRecord);
      }

      totalNetworkUnits += 1;
      totalNetworkValue += rawTotalVal;

      globalAgingCounts[aging.bracket] = (globalAgingCounts[aging.bracket] || 0) + 1;
      globalClassificationCounts[stockClassification] = (globalClassificationCounts[stockClassification] || 0) + 1;

      // Group per Site
      if (!siteMap.has(siteCode)) {
        siteMap.set(siteCode, {
          siteCode,
          siteName,
          siteId,
          shipTo: OFFICIAL_BRANCH_DIRECTORY[siteCode]?.ship_to || matchedSite?.ship_to || '',
          supervisor: OFFICIAL_BRANCH_DIRECTORY[siteCode]?.contact_person || matchedSite?.contact_person || 'Branch Supervisor',
          phone: OFFICIAL_BRANCH_DIRECTORY[siteCode]?.contact_phone || matchedSite?.contact_phone || '',
          email: OFFICIAL_BRANCH_DIRECTORY[siteCode]?.contact_email || matchedSite?.contact_email || '',
          address: OFFICIAL_BRANCH_DIRECTORY[siteCode]?.full_address || matchedSite?.full_address || matchedSite?.address || '',
          region: OFFICIAL_BRANCH_DIRECTORY[siteCode]?.region || (['ABR', 'CDO', 'CEB', 'COT', 'ILO', 'LAN', 'LAU', 'LIM', 'NAG', 'ZAM'].includes(siteCode) ? 'Provincial' : 'Metro Manila'),
          items: []
        });
      }
      siteMap.get(siteCode).items.push(itemRecord);

      // Parts catalog summary
      if (!partsCatalogMap.has(cleanPn)) {
        const catCode = getPartCategory({ part_number: cleanPn, description: rawDescription });
        const canonicalModel = resolveCanonicalIPhoneModel ? resolveCanonicalIPhoneModel(rawDescription) : null;
        partsCatalogMap.set(cleanPn, {
          part_number: cleanPn,
          description: rawDescription,
          category_id: catCode === 'DISPLAY' ? 'cat-display' : 'cat-battery',
          stocking_price: rawPartVal > 0 ? rawPartVal : 99,
          iphone_model: canonicalModel || 'iPhone Model',
          is_active: true
        });
      }
    }

    // Build Site KPI Summaries
    const siteSummaries = [];
    siteMap.forEach((siteData) => {
      const metrics = calculateSiteInventoryHealth(siteData.items);
      siteSummaries.push({
        ...siteData,
        metrics,
        totalUnits: metrics.total.units,
        totalValue: metrics.total.value,
        uniquePartsCount: metrics.partAggregations.length,
        investigationCount: metrics.segmentedLists.investigation.length
      });
    });

    siteSummaries.sort((a, b) => a.siteCode.localeCompare(b.siteCode));

    return {
      success: true,
      fileName,
      timestamp: new Date().toISOString(),
      items,
      sites: siteSummaries,
      investigationItems,
      extractedParts: Array.from(partsCatalogMap.values()),
      globalMetrics: {
        totalUnits: totalNetworkUnits,
        totalValue: totalNetworkValue,
        uniqueParts: partsCatalogMap.size,
        sitesCount: siteSummaries.length,
        investigationCount: investigationItems.length,
        agingCounts: globalAgingCounts,
        classificationCounts: globalClassificationCounts,
        deadStockPercent: totalNetworkUnits > 0 ? ((globalAgingCounts[AGING_BRACKETS.DEAD_STOCK] / totalNetworkUnits) * 100).toFixed(1) : '0.0',
        slowMovingPercent: totalNetworkUnits > 0 ? ((globalAgingCounts[AGING_BRACKETS.SLOW_MOVING] / totalNetworkUnits) * 100).toFixed(1) : '0.0',
        nonMovingPercent: totalNetworkUnits > 0 ? ((globalAgingCounts[AGING_BRACKETS.NON_MOVING] / totalNetworkUnits) * 100).toFixed(1) : '0.0',
        inStockPercent: totalNetworkUnits > 0 ? ((globalAgingCounts[AGING_BRACKETS.IN_STOCK] / totalNetworkUnits) * 100).toFixed(1) : '0.0'
      }
    };
  } catch (err) {
    console.error('parseFixablyExportCsv error:', err);
    return { success: false, error: `Failed to parse Fixably CSV: ${err.message}` };
  }
}

/**
 * Reconciles all 3 Fixably files:
 * 1. Site Stocks (output.csv)
 * 2. KGB Used (kgb_used.csv)
 * 3. Stock Transfer (stock_transfer.csv)
 */
export async function reconcileFixablyMultiFile({
  siteStockContent,
  kgbUsedContent = null,
  stockTransferContent = null,
  options = {}
}) {
  try {
    // 1. Parse Stock Transfers (if provided)
    let dynamicDcSerials = new Set();
    let transferStats = null;
    if (stockTransferContent) {
      const transferRes = await parseStockTransferCsv(stockTransferContent);
      if (transferRes.success) {
        dynamicDcSerials = transferRes.dcSerials;
        transferStats = {
          totalRows: transferRes.totalRows,
          dcTransfersCount: transferRes.dcTransfersCount
        };
      }
    }

    // 2. Parse KGB Used (if provided)
    let kgbUsedMap = new Map();
    let kgbStats = null;
    if (kgbUsedContent) {
      const kgbRes = await parseKgbUsedCsv(kgbUsedContent);
      if (kgbRes.success) {
        kgbUsedMap = kgbRes.kgbMap;
        kgbStats = {
          totalRows: kgbRes.totalRows,
          totalClosed: kgbRes.totalClosed,
          uniqueSerials: kgbRes.uniqueSerials
        };
      }
    }

    // 3. Parse Site Stocks with joined cross-file sets
    const stockRes = await parseFixablyExportCsv(siteStockContent, {
      ...options,
      dynamicDcSerials,
      kgbUsedMap
    });

    if (!stockRes.success) {
      return stockRes;
    }

    const batchSummary = {
      batchId: `sync-batch-${Date.now()}`,
      syncedAt: new Date().toISOString(),
      siteStocksCount: stockRes.items.length,
      transferStats: transferStats || { dcTransfersCount: KNOWN_DC_SERIALS_SET.size },
      kgbStats: kgbStats || { uniqueSerials: 0 },
      flaggedInvestigationCount: stockRes.investigationItems.length,
      globalMetrics: stockRes.globalMetrics
    };

    return {
      ...stockRes,
      batchSummary
    };
  } catch (err) {
    console.error('reconcileFixablyMultiFile error:', err);
    return { success: false, error: `Multi-file reconciliation failed: ${err.message}` };
  }
}

/**
 * Calculates complete Inventory Health Metrics and KPI Breakdown for a site's items,
 * matching the layout and calculations of `SIte Stocks (Fixably).xlsx`.
 */
export function calculateSiteInventoryHealth(items = []) {
  const dcItems = [];
  const mspiItems = [];

  items.forEach(it => {
    if (it.stockType === 'DC Stock') {
      dcItems.push(it);
    } else {
      mspiItems.push(it);
    }
  });

  const calcGroup = (groupItems) => {
    const total = groupItems.length;
    let dead = 0;
    let nonMoving = 0;
    let slow = 0;
    let inStock = 0;
    let value = 0;

    groupItems.forEach(it => {
      value += it.totalValue || it.partValue || 0;
      if (it.agingBracket === AGING_BRACKETS.DEAD_STOCK) dead++;
      else if (it.agingBracket === AGING_BRACKETS.NON_MOVING) nonMoving++;
      else if (it.agingBracket === AGING_BRACKETS.SLOW_MOVING) slow++;
      else inStock++;
    });

    return {
      units: total,
      value,
      dead,
      deadPercent: total > 0 ? ((dead / total) * 100).toFixed(1) + '%' : '0.0%',
      nonMoving,
      nonMovingPercent: total > 0 ? ((nonMoving / total) * 100).toFixed(1) + '%' : '0.0%',
      slow,
      slowPercent: total > 0 ? ((slow / total) * 100).toFixed(1) + '%' : '0.0%',
      inStock,
      inStockPercent: total > 0 ? ((inStock / total) * 100).toFixed(1) + '%' : '0.0%'
    };
  };

  const dcGroup = calcGroup(dcItems);
  const mspiGroup = calcGroup(mspiItems);
  const totalGroup = calcGroup(items);

  // Segmented lists
  const deadStockList = items.filter(it => it.agingBracket === AGING_BRACKETS.DEAD_STOCK);
  const nonMovingList = items.filter(it => it.agingBracket === AGING_BRACKETS.NON_MOVING);
  const slowMovingList = items.filter(it => it.agingBracket === AGING_BRACKETS.SLOW_MOVING);
  const activeStockList = items.filter(it => it.agingBracket === AGING_BRACKETS.IN_STOCK);
  const investigationList = items.filter(it => it.isInvestigation);

  // Group by Part Number and Description (Total Serials On-Hand)
  const partMap = new Map();
  items.forEach(it => {
    const pn = it.partNumber;
    if (!partMap.has(pn)) {
      partMap.set(pn, {
        partNumber: pn,
        partDescription: it.description,
        totalSerialsOnHand: 0,
        serials: [],
        dcStockCount: 0,
        mspiCount: 0,
        deadCount: 0,
        nonMovingCount: 0,
        slowCount: 0,
        inStockCount: 0,
        investigationCount: 0
      });
    }
    const entry = partMap.get(pn);
    entry.totalSerialsOnHand += 1;
    if (it.serialNumber) entry.serials.push(it.serialNumber);
    if (it.stockType === 'DC Stock') entry.dcStockCount++;
    else entry.mspiCount++;

    if (it.isInvestigation) entry.investigationCount++;

    if (it.agingBracket === AGING_BRACKETS.DEAD_STOCK) entry.deadCount++;
    else if (it.agingBracket === AGING_BRACKETS.NON_MOVING) entry.nonMovingCount++;
    else if (it.agingBracket === AGING_BRACKETS.SLOW_MOVING) entry.slowCount++;
    else entry.inStockCount++;
  });

  const partAggregations = Array.from(partMap.values()).sort((a, b) => b.totalSerialsOnHand - a.totalSerialsOnHand);

  return {
    dcStock: dcGroup,
    mspiOwned: mspiGroup,
    total: totalGroup,
    segmentedLists: {
      deadStock: deadStockList,
      nonMoving: nonMovingList,
      slowMoving: slowMovingList,
      activeStock: activeStockList,
      investigation: investigationList
    },
    partAggregations
  };
}

/**
 * Generates and triggers download of Dead Stock CSV for a site or all sites.
 */
export function exportDeadStockToCsv(items = [], siteCode = 'ALL') {
  const deadStockItems = items.filter(it => it.agingBracket === AGING_BRACKETS.DEAD_STOCK);
  if (deadStockItems.length === 0) return false;

  const headers = [
    'Site Code',
    'Site Name',
    'Stock Type',
    'Part Number',
    'Part Description',
    'Part Serial',
    'IMEI',
    'Last Received Date',
    'Aging Days',
    'Status Label',
    'Part Value ($)',
    'Total Value ($)'
  ];

  const rows = deadStockItems.map(it => [
    `"${it.siteCode}"`,
    `"${it.siteName}"`,
    `"${it.stockType}"`,
    `"${it.partNumber}"`,
    `"${(it.description || '').replace(/"/g, '""')}"`,
    `"${it.serialNumber || ''}"`,
    `"${it.imei || ''}"`,
    `"${it.lastReceivedDate || ''}"`,
    it.agingDays,
    `"${it.statusLabel}"`,
    (it.partValue || 0).toFixed(2),
    (it.totalValue || 0).toFixed(2)
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Dead_Stock_Pullout_${siteCode}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Generates and triggers download of Dead Stock Excel workbook (.xlsx)
 */
export function exportDeadStockToExcel(items = [], siteCode = 'ALL') {
  const deadStockItems = items.filter(it => it.agingBracket === AGING_BRACKETS.DEAD_STOCK);
  if (deadStockItems.length === 0) return false;

  const dataRows = deadStockItems.map(it => ({
    'Site Code': it.siteCode,
    'Site Name': it.siteName,
    'Stock Type': it.stockType,
    'Part Number': it.partNumber,
    'Part Description': it.description,
    'Part Serial': it.serialNumber || '',
    'IMEI': it.imei || '',
    'Last Received Date': it.lastReceivedDate || '',
    'Aging Days': it.agingDays,
    'Status Label': it.statusLabel,
    'Part Value ($)': Number((it.partValue || 0).toFixed(2)),
    'Total Value ($)': Number((it.totalValue || 0).toFixed(2))
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(dataRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Dead Stock Pull-Out');

  const fileName = `Dead_Stock_Pullout_${siteCode}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return true;
}

/**
 * Generates and triggers download of Dispatch / For Investigation CSV for a site or network.
 */
export function exportInvestigationToCsv(items = [], siteCode = 'ALL') {
  const flaggedItems = items.filter(it => it.isInvestigation);
  if (flaggedItems.length === 0) return false;

  const headers = [
    'Transfer Received Date',
    'Repair Closed Date',
    'To Stock',
    'Serial Used By (Location)',
    'Part Number',
    'Part Description',
    'Transferred Serial',
    'Order Number',
    'Stock Type',
    'GSX Status'
  ];

  const rows = flaggedItems.map(it => [
    `"${it.lastReceivedDate || ''}"`,
    `"${it.investigationDetails?.repairClosedDate || ''}"`,
    `"${it.stockName || ''}"`,
    `"${it.investigationDetails?.locationName || it.siteName || ''}"`,
    `"${it.partNumber}"`,
    `"${(it.description || '').replace(/"/g, '""')}"`,
    `"${it.serialNumber || ''}"`,
    `"${it.investigationDetails?.orderId || ''}"`,
    `"${it.stockType}"`,
    `"${it.investigationDetails?.gsxStatus || 'SCOM'}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Dispatch_Investigation_${siteCode}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Generates and triggers download of Dispatch / For Investigation Excel workbook (.xlsx).
 */
export function exportInvestigationToExcel(items = [], siteCode = 'ALL') {
  const flaggedItems = items.filter(it => it.isInvestigation);
  if (flaggedItems.length === 0) return false;

  const dataRows = flaggedItems.map(it => ({
    'Transfer Received Date': it.lastReceivedDate || '',
    'Repair Closed Date': it.investigationDetails?.repairClosedDate || '',
    'To Stock': it.stockName || '',
    'Serial Used by:': it.investigationDetails?.locationName || it.siteName || '',
    'Part Number': it.partNumber,
    'Part Description': it.description,
    'Transferred Serial': it.serialNumber || '',
    'Order Number': it.investigationDetails?.orderId || '',
    'Stock Type': it.stockType,
    'GSX Status': it.investigationDetails?.gsxStatus || 'SCOM'
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(dataRows);
  XLSX.utils.book_append_sheet(wb, ws, 'For Investigation');

  const fileName = `Dispatch_Investigation_${siteCode}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return true;
}

/**
 * Exports complete site inventory workbook with aging breakdown matching SIte Stocks (Fixably).xlsx
 */
export function exportSiteToExcel(siteData, items = []) {
  if (!siteData) return false;
  const siteCode = siteData.siteCode || 'SITE';
  const siteItems = items.filter(it => it.siteCode === siteCode || it.siteName === siteData.siteName);
  const metrics = calculateSiteInventoryHealth(siteItems);

  const wb = XLSX.utils.book_new();

  // Sheet 1: Master Site Stock
  const masterRows = siteItems.map(it => ({
    'Transfer Received Date': it.lastReceivedDate,
    'To Stock': it.stockName,
    'Part Number': it.partNumber,
    'Part Description': it.description,
    'Transferred Serial': it.serialNumber,
    'Stock Type': it.stockType,
    'Aging Days': it.agingDays,
    'Status': it.statusLabel,
    'Unit Value ($)': Number((it.partValue || 0).toFixed(2)),
    'Total Value ($)': Number((it.totalValue || 0).toFixed(2))
  }));
  const wsMaster = XLSX.utils.json_to_sheet(masterRows);
  XLSX.utils.book_append_sheet(wb, wsMaster, `${siteCode}_All_Stock`);

  // Sheet 2: Inventory Aging & Health Summary
  const summaryRows = [
    {
      'Stock Type': 'DC Stock',
      'Dead Stock': metrics.dcStock.dead,
      'Non-Moving': metrics.dcStock.nonMoving,
      'Slow-Moving': metrics.dcStock.slow,
      'In Stock': metrics.dcStock.inStock,
      'Total Units': metrics.dcStock.units,
      'Dead Stock %': metrics.dcStock.deadPercent,
      'Non-Moving %': metrics.dcStock.nonMovingPercent,
      'Slow-Moving %': metrics.dcStock.slowPercent,
      'In Stock %': metrics.dcStock.inStockPercent
    },
    {
      'Stock Type': 'MSPI-Owned / C/I REP',
      'Dead Stock': metrics.mspiOwned.dead,
      'Non-Moving': metrics.mspiOwned.nonMoving,
      'Slow-Moving': metrics.mspiOwned.slow,
      'In Stock': metrics.mspiOwned.inStock,
      'Total Units': metrics.mspiOwned.units,
      'Dead Stock %': metrics.mspiOwned.deadPercent,
      'Non-Moving %': metrics.mspiOwned.nonMovingPercent,
      'Slow-Moving %': metrics.mspiOwned.slowPercent,
      'In Stock %': metrics.mspiOwned.inStockPercent
    },
    {
      'Stock Type': 'COMBINED TOTAL',
      'Dead Stock': metrics.total.dead,
      'Non-Moving': metrics.total.nonMoving,
      'Slow-Moving': metrics.total.slow,
      'In Stock': metrics.total.inStock,
      'Total Units': metrics.total.units,
      'Dead Stock %': metrics.total.deadPercent,
      'Non-Moving %': metrics.total.nonMovingPercent,
      'Slow-Moving %': metrics.total.slowPercent,
      'In Stock %': metrics.total.inStockPercent
    }
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Aging Health Summary');

  // Sheet 3: Dead Stock
  const deadRows = metrics.segmentedLists.deadStock.map(it => ({
    'Transfer Received Date': it.lastReceivedDate,
    'Part Number': it.partNumber,
    'Part Description': it.description,
    'Serial Number': it.serialNumber,
    'Stock Type': it.stockType,
    'Aging Days': it.agingDays,
    'Status': it.statusLabel
  }));
  const wsDead = XLSX.utils.json_to_sheet(deadRows);
  XLSX.utils.book_append_sheet(wb, wsDead, 'Dead Stock');

  // Sheet 4: Dispatch / For Investigation
  const investigationRows = metrics.segmentedLists.investigation.map(it => ({
    'Transfer Received Date': it.lastReceivedDate,
    'Repair Closed Date': it.investigationDetails?.repairClosedDate || '',
    'To Stock': it.stockName,
    'Serial Used by:': it.investigationDetails?.locationName || it.siteName,
    'Part Number': it.partNumber,
    'Part Description': it.description,
    'Transferred Serial': it.serialNumber,
    'Order Number': it.investigationDetails?.orderId || '',
    'Stock Type': it.stockType
  }));
  const wsInv = XLSX.utils.json_to_sheet(investigationRows);
  XLSX.utils.book_append_sheet(wb, wsInv, 'For Investigation');

  // Sheet 5: Part Aggregations
  const partRows = metrics.partAggregations.map(p => ({
    'Part Number': p.partNumber,
    'Part Description': p.partDescription,
    'Total Serials On-Hand': p.totalSerialsOnHand,
    'DC Stock Units': p.dcStockCount,
    'MSPI Units': p.mspiCount,
    'Dead Stock Units': p.deadCount,
    'Active Units': p.inStockCount,
    'Flagged in KGB': p.investigationCount
  }));
  const wsParts = XLSX.utils.json_to_sheet(partRows);
  XLSX.utils.book_append_sheet(wb, wsParts, 'Part Aggregations');

  const fileName = `Fixably_Inventory_${siteCode}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return true;
}

/**
 * Strips redundant nested item arrays to create an ultra-compact payload (~2MB)
 * safe for Supabase PostgreSQL upserts (preventing HTTP 413 Payload Too Large).
 */
export function compactFixablySnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.items)) return snapshot;

  const compactItems = snapshot.items.map(it => ({
    id: it.id,
    stockName: it.stockName || '',
    stockType: it.stockType || 'MSPI-Owned / C/I REP',
    partNumber: it.partNumber || it.part_number || '',
    description: it.description || '',
    serialNumber: it.serialNumber || it.serial_number || '',
    imei: it.imei || '',
    lastReceivedDate: it.lastReceivedDate || it.dateReceived || '',
    quantity: it.quantity || 1,
    partValue: it.partValue || 0,
    totalValue: it.totalValue || 0,
    siteCode: it.siteCode || it.site_code || '',
    siteName: it.siteName || it.site_name || '',
    siteId: it.siteId || it.current_site_id || '',
    agingDays: typeof it.agingDays === 'number' ? it.agingDays : 0,
    agingBracket: it.agingBracket || AGING_BRACKETS.IN_STOCK,
    statusLabel: it.statusLabel || 'In Stock',
    badgeColor: it.badgeColor || '#15803d',
    badgeBg: it.badgeBg || '#dcfce7',
    isSerialized: it.isSerialized !== false,
    isInvestigation: Boolean(it.isInvestigation || it.isFlaggedInvestigation),
    investigationDetails: it.investigationDetails || null
  }));

  return {
    fileName: snapshot.fileName || 'output.csv',
    timestamp: snapshot.timestamp || new Date().toISOString(),
    items: compactItems,
    investigationItems: snapshot.investigationItems || [],
    globalMetrics: snapshot.globalMetrics || null,
    batchSummary: snapshot.batchSummary || null
  };
}

/**
 * Reconstructs all site structures, KPI health breakdowns, and segmented lists
 * from compact items in ~1ms with 100% data fidelity.
 */
export function hydrateFixablySnapshot(snapshot, sitesList = []) {
  if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length === 0) {
    return snapshot;
  }

  // If sites are already present and have complete segmented lists, return as-is
  if (Array.isArray(snapshot.sites) && snapshot.sites.length > 0 && snapshot.sites[0]?.metrics?.segmentedLists) {
    return snapshot;
  }

  const siteMap = new Map();
  snapshot.items.forEach(it => {
    const siteCode = (it.siteCode || it.site_code || 'UNKNOWN').toUpperCase().replace(/^(ASP|APP)\s+/, '');
    if (!siteMap.has(siteCode)) {
      const matchedSite = (sitesList || []).find(s => (s.code || '').toUpperCase().replace(/^(ASP|APP)\s+/, '') === siteCode);
      const dirEntry = OFFICIAL_BRANCH_DIRECTORY[siteCode] || OFFICIAL_BRANCH_DIRECTORY[`APP ${siteCode}`] || OFFICIAL_BRANCH_DIRECTORY[`ASP ${siteCode}`] || {};
      const siteName = dirEntry.name || matchedSite?.name || it.siteName || siteCode;

      siteMap.set(siteCode, {
        siteCode,
        siteName,
        siteId: matchedSite?.id || it.siteId || it.current_site_id || `site-${siteCode.toLowerCase()}`,
        shipTo: dirEntry.ship_to || matchedSite?.ship_to || null,
        supervisor: dirEntry.contact_person || matchedSite?.contact_person || 'Store Supervisor',
        phone: dirEntry.contact_phone || matchedSite?.contact_phone || '',
        email: dirEntry.contact_email || matchedSite?.contact_email || '',
        address: dirEntry.full_address || matchedSite?.full_address || matchedSite?.address || '',
        region: dirEntry.region || (['ABR', 'CDO', 'CEB', 'COT', 'ILO', 'LAN', 'LAU', 'LIM', 'NAG', 'ZAM'].includes(siteCode) ? 'Provincial' : 'Metro Manila'),
        items: []
      });
    }
    siteMap.get(siteCode).items.push(it);
  });

  const siteSummaries = [];
  siteMap.forEach((siteData) => {
    const metrics = calculateSiteInventoryHealth(siteData.items);
    siteSummaries.push({
      ...siteData,
      metrics,
      totalUnits: metrics.total.units,
      totalValue: metrics.total.value,
      uniquePartsCount: metrics.partAggregations.length,
      investigationCount: metrics.segmentedLists.investigation.length
    });
  });

  siteSummaries.sort((a, b) => a.siteCode.localeCompare(b.siteCode));

  return {
    ...snapshot,
    sites: siteSummaries
  };
}

