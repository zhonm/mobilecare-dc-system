import * as XLSX from 'xlsx';
import { normalizeDate, normalizeSite, EXCEL_BRANCH_ORDER } from './siteTransfersReconciler.js';

export const DC_MONITORING_SLOTS = [
  {
    id: 'site_stock',
    label: 'Site Stock (Inventory Value)',
    shortLabel: 'Site Stock',
    sheetAliases: ['Site Stock'],
    requiredKeywords: ['stock name', 'part number', 'last received date'],
    optionalKeywords: ['part serial', 'quantity', 'part description', 'part value', 'total value'],
    sampleTitle: 'Custom reports - Inventory Value',
    acceptedFormats: 'CSV / XLSX'
  },
  {
    id: 'kgb_used',
    label: 'KGB Used (GSX Repairs)',
    shortLabel: 'KGB Used',
    sheetAliases: ['KGB Used'],
    requiredKeywords: ['order id', 'location name', 'product description'],
    optionalKeywords: ['product kgb', 'product kbb', 'repair closed date', 'gsx repair number', 'product code'],
    sampleTitle: 'Custom reports - GSX KBB / KGBs Used',
    acceptedFormats: 'CSV / XLSX'
  },
  {
    id: 'stock_transfer',
    label: 'Stock Transfer Logs',
    shortLabel: 'Stock Transfer',
    sheetAliases: ['Stock Transfer'],
    requiredKeywords: ['from stock', 'to stock', 'serial number'],
    optionalKeywords: ['transfer received date', 'product code', 'product name', 'transfer quantity', 'transfer value'],
    sampleTitle: 'Custom reports - Stock Transfers',
    acceptedFormats: 'CSV / XLSX'
  },
  {
    id: 'dc_masterlists',
    label: 'DC Masterlists (Order Lines)',
    shortLabel: 'DC Masterlists',
    sheetAliases: ['DC Masterlists'],
    requiredKeywords: ['order id', 'line product code', 'line price total'],
    optionalKeywords: ['line kgb', 'line kbb', 'device warranty name', 'line is dispatched', 'line is doa', 'line status name', 'closed (date)'],
    sampleTitle: 'DC Masterlists Fixably Export',
    acceptedFormats: 'CSV / XLSX'
  },
  {
    id: 'sdr_current',
    label: 'SDR Report (Current / 2026)',
    shortLabel: 'SDR Current',
    sheetAliases: ['SDR (DC)'],
    requiredKeywords: ['order id', 'received', 'closed'],
    optionalKeywords: ['location name', 'status', 'device description', 'device warranty name'],
    sampleTitle: 'same-day-repair-2026.xlsx',
    acceptedFormats: 'CSV / XLSX'
  },
  {
    id: 'sdr_baseline',
    label: 'SDR Baseline (2025 Historical)',
    shortLabel: 'SDR 2025 Baseline',
    sheetAliases: ['SDR (2025)'],
    requiredKeywords: ['order id', 'received', 'closed'],
    optionalKeywords: ['location name', 'status', 'device description', 'device warranty name', 'reptat status'],
    sampleTitle: 'SDR (2025) Non-DC Baseline',
    acceptedFormats: 'CSV / XLSX'
  }
];

export const WARRANTY_TARGET_CATEGORIES = [
  'Apple Limited Warranty',
  'Customer Satisfaction (CS) Code',
  'Out Of Warranty (No Coverage)',
  'AppleCare Protection Plan'
];

export const TAT_CATEGORY_ORDER = [
  'SDR',
  '1–3 Days',
  '4–6 Days',
  '7–9 Days',
  '10–12 Days',
  '13–15 Days',
  '16+ Days'
];

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Default baseline monthly Lalamove shipping costs observed in workbook (editable in UI)
export const DEFAULT_DC_SHIPPING_COSTS = [
  { id: 'ship-mar-2026', month: 'March', year: 2026, courier: 'Lalamove', amount: 3065.90, notes: 'DC Inter-Branch Courier' },
  { id: 'ship-apr-2026', month: 'April', year: 2026, courier: 'Lalamove', amount: 2031.98, notes: 'DC Inter-Branch Courier' },
  { id: 'ship-may-2026', month: 'May', year: 2026, courier: 'Lalamove', amount: 2493.99, notes: 'DC Inter-Branch Courier' },
  { id: 'ship-jun-2026', month: 'June', year: 2026, courier: 'Lalamove', amount: 8311.00, notes: 'DC Inter-Branch Courier' },
  { id: 'ship-jul-2026', month: 'July', year: 2026, courier: 'Lalamove', amount: 14588.00, notes: 'DC Inter-Branch Courier' },
  { id: 'ship-aug-2026', month: 'August', year: 2026, courier: 'Lalamove', amount: 24295.00, notes: 'DC Inter-Branch Courier' },
  { id: 'ship-sep-2026', month: 'September', year: 2026, courier: 'Lalamove', amount: 11835.00, notes: 'DC Inter-Branch Courier' },
  { id: 'ship-oct-2026', month: 'October', year: 2026, courier: 'Lalamove', amount: 9830.00, notes: 'DC Inter-Branch Courier' }
];

const DC_SHEET_SITE_RULES = [
  { pattern: /ABR/i, name: 'MOBILECARE - DAVAO', code: 'ABR' },
  { pattern: /ANX/i, name: 'MOBILECARE - APP THE ANNEX', code: 'ANX' },
  { pattern: /BHS/i, name: 'MOBILECARE - APP BONIFACIO HIGH STREET', code: 'BHS' },
  { pattern: /CDO/i, name: 'MOBILECARE - CAGAYAN DE ORO', code: 'CDO' },
  { pattern: /CEB/i, name: 'MOBILECARE - CEBU', code: 'CEB' },
  { pattern: /FES/i, name: 'MOBILECARE - APP FESTIVAL MALL', code: 'FES' },
  { pattern: /GB3/i, name: 'MOBILECARE - APP GREENBELT 3', code: 'GB3' },
  { pattern: /GL5/i, name: 'MOBILECARE - GLORIETTA 5', code: 'GL5' },
  { pattern: /APPILO/i, name: 'MOBILECARE - APP SM ILOILO', code: 'APPILO' },
  { pattern: /ILO/i, name: 'MOBILECARE - FESTIVE WALK ILOILO', code: 'ILO' },
  { pattern: /LAU/i, name: 'MOBILECARE - LA UNION', code: 'LAU' },
  { pattern: /LIM/i, name: 'MOBILECARE - LIMA ESTATE', code: 'LIM' },
  { pattern: /MAG|RM/i, name: 'MOBILECARE - APP MAGNOLIA', code: 'MAG' },
  { pattern: /MEG/i, name: 'MOBILECARE - APP MEGAMALL', code: 'MEG' },
  { pattern: /MOA/i, name: 'MOBILECARE - APP MALL OF ASIA', code: 'MOA' },
  { pattern: /MRK/i, name: 'MOBILECARE - SM MARIKINA', code: 'MRK' },
  { pattern: /NAG/i, name: 'MOBILECARE - NAGA', code: 'NAG' },
  { pattern: /NES/i, name: 'MOBILECARE - NORTHEAST SQUARE', code: 'NES' },
  { pattern: /NPM/i, name: 'MOBILECARE - NEWPOINT MALL', code: 'NPM' },
  { pattern: /POD/i, name: 'MOBILECARE - THE PODIUM', code: 'POD' },
  { pattern: /PPM/i, name: 'MOBILECARE - APP POWER PLANT MALL', code: 'PPM' },
  { pattern: /SMS/i, name: 'MOBILECARE - S\'MAISON', code: 'SMS' },
  { pattern: /TRI/i, name: 'MOBILECARE - APP TRINOMA', code: 'TRI' },
  { pattern: /VER|VN/i, name: 'MOBILECARE - VERTIS NORTH', code: 'VER' },
  { pattern: /ZAM/i, name: 'MOBILECARE - ZAMBOANGA', code: 'ZAM' }
];

/**
 * Converts Excel serial date numbers or date strings strictly in UTC to ISO YYYY-MM-DD,
 * eliminating off-by-one shifts across timezone offsets.
 */
export function excelDateToISO(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (val > 1000 && val < 100000) {
      const ms = Math.round(Date.UTC(1899, 11, 30) + Math.floor(val) * 86400000);
      return new Date(ms).toISOString().slice(0, 10);
    }
    return '';
  }
  const str = String(val).trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(str)) return str.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(str)) {
    const num = Number(str);
    if (num > 1000 && num < 100000) {
      const ms = Math.round(Date.UTC(1899, 11, 30) + Math.floor(num) * 86400000);
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  return normalizeDate(str);
}

/**
 * Computes exact whole-day UTC calendar difference (closedIso - receivedIso).
 */
export function diffIsoDays(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const t1 = Date.parse(`${startIso}T00:00:00Z`);
  const t2 = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.round((t2 - t1) / 86400000);
}

/**
 * Maps Fixably stock location labels (e.g., "ANX-MSPI-Owned", "VER_MSPI-Owned", "APPILO_MSPI-Owned")
 * to canonical site names matching both Google Sheet formulas and the branch directory.
 */
export function normalizeDcSheetSiteName(siteInput = '') {
  const raw = String(siteInput || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  for (const rule of DC_SHEET_SITE_RULES) {
    if (rule.pattern.test(upper)) {
      return rule.name;
    }
  }
  const fallback = normalizeSite(raw);
  return fallback.name || raw;
}

/**
 * Returns true if the repair site reflects the destination branch without inter-branch relocation.
 */
export function isTransferredOutMismatch(expectedBranchName, actualUsedSiteName) {
  const used = String(actualUsedSiteName || '').trim();
  if (!used) return false;
  const expected = String(expectedBranchName || '').trim();
  if (!expected) return false;
  const upperUsed = used.toUpperCase();
  const upperExpected = expected.toUpperCase();
  if (upperUsed.includes(upperExpected)) return false;
  // Iloilo alias parity: "MOBILECARE - APP SM ILOILO" / "MOBILECARE - FESTIVE WALK ILOILO" / "ILOILO"
  if (upperExpected.includes('ILOILO') && upperUsed.includes('ILOILO')) {
    const expAppSm = upperExpected.includes('APP SM ILOILO');
    const usedAppSm = upperUsed.includes('APP SM ILOILO');
    if (expAppSm === usedAppSm) return false;
  }
  return true;
}

export function classifyTatCategory(tatDays) {
  if (tatDays === null || tatDays === undefined || !Number.isFinite(tatDays)) return '';
  if (tatDays <= 0) return 'SDR';
  if (tatDays <= 3) return '1–3 Days';
  if (tatDays <= 6) return '4–6 Days';
  if (tatDays <= 9) return '7–9 Days';
  if (tatDays <= 12) return '10–12 Days';
  if (tatDays <= 15) return '13–15 Days';
  return '16+ Days';
}

export function formatMonthNameFromIso(isoDate) {
  if (!isoDate || isoDate.length < 7) return '';
  const mIdx = parseInt(isoDate.slice(5, 7), 10) - 1;
  return MONTH_NAMES[mIdx] || '';
}

export function formatMonthYearFromIso(isoDate) {
  if (!isoDate || isoDate.length < 7) return '';
  const year = isoDate.slice(0, 4);
  const mName = formatMonthNameFromIso(isoDate);
  return mName ? `${mName} ${year}` : '';
}

export function calculateDcAgingStatus(adjustedReceivedIso, referenceDateIso) {
  if (!adjustedReceivedIso || !referenceDateIso) {
    return { daysElapsed: null, bucket: 'Unknown', label: 'Unknown' };
  }
  const days = diffIsoDays(adjustedReceivedIso, referenceDateIso);
  if (days === null) return { daysElapsed: null, bucket: 'Unknown', label: 'Unknown' };
  const clampedDays = Math.max(0, days);
  if (clampedDays >= 180) {
    return { daysElapsed: clampedDays, bucket: 'Dead Stock', label: `Dead Stock - Action Required (${clampedDays} days)` };
  }
  if (clampedDays >= 90) {
    return { daysElapsed: clampedDays, bucket: 'Non-Moving', label: `Non-Moving (${clampedDays} days)` };
  }
  if (clampedDays >= 60) {
    return { daysElapsed: clampedDays, bucket: 'Slow-Moving', label: `Slow-Moving (${clampedDays} days)` };
  }
  return { daysElapsed: clampedDays, bucket: 'In Stock', label: `In Stock (${clampedDays} days)` };
}

export function normalizeWarrantyBucket(rawWarranty = '') {
  const trimmed = String(rawWarranty || '').trim();
  if (!trimmed) return { bucket: 'Others', isRedacted: false, raw: '' };
  if (/^\*+$/.test(trimmed)) return { bucket: 'Others', isRedacted: true, raw: trimmed };
  if (WARRANTY_TARGET_CATEGORIES.includes(trimmed)) {
    return { bucket: trimmed, isRedacted: false, raw: trimmed };
  }
  return { bucket: 'Others', isRedacted: false, raw: trimmed };
}

function cleanStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function cleanNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v || '').replace(/[₱$,\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parses CSV/TSV text (handles quoted delimiters & escaped quotes cleanly).
 */
export function parseDelimitedTextToMatrix(text = '') {
  const cleanText = String(text || '').replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/);
  const firstNonEmpty = lines.find(l => l.trim().length > 0) || '';
  const sampleNext = lines.slice(0, 5).join('\n');
  const semiCount = (sampleNext.match(/;/g) || []).length;
  const commaCount = (sampleNext.match(/,/g) || []).length;
  const tabCount = (sampleNext.match(/\t/g) || []).length;
  let delim = ',';
  if (tabCount > commaCount && tabCount > semiCount) delim = '\t';
  else if (semiCount > commaCount && !firstNonEmpty.includes(',')) delim = ';';

  const matrix = [];
  for (const rawLine of lines) {
    if (!rawLine || !rawLine.trim()) continue;
    const row = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i];
      if (ch === '"') {
        if (inQuotes && rawLine[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    row.push(current.trim());
    matrix.push(row);
  }
  return matrix;
}

/**
 * Extracts raw 2D matrix plus cell comments map (`cellRef -> commentText`) from an XLSX worksheet.
 */
function sheetToMatrixWithComments(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  const commentsByRow = new Map();
  for (const [cellRef, cellObj] of Object.entries(sheet || {})) {
    if (cellRef.startsWith('!') || !cellObj?.c?.length) continue;
    const match = cellRef.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const rowIdx = parseInt(match[2], 10) - 1;
    const text = cellObj.c.map(c => String(c.t || '').replace(/\u00C2\u00A0|\u00A0/g, ' ').trim()).filter(Boolean).join('; ');
    if (text) {
      commentsByRow.set(rowIdx, commentsByRow.get(rowIdx) ? `${commentsByRow.get(rowIdx)} | ${text}` : text);
    }
  }
  return { rows, commentsByRow };
}

/**
 * Reads an ArrayBuffer / Uint8Array / File / string into `{ workbook, matrix, fileName }`.
 */
async function readInputPayload(fileOrInput) {
  if (!fileOrInput) throw new Error('No input file provided.');
  let fileName = fileOrInput.name || 'uploaded_file';
  let buffer = null;
  let text = null;

  if (typeof File !== 'undefined' && fileOrInput instanceof File) {
    fileName = fileOrInput.name;
    if (/\.csv$|\.txt$/i.test(fileName)) {
      text = await fileOrInput.text();
    } else {
      buffer = await fileOrInput.arrayBuffer();
    }
  } else if (typeof fileOrInput === 'string') {
    text = fileOrInput;
    fileName = 'pasted_report.csv';
  } else if (fileOrInput instanceof ArrayBuffer || ArrayBuffer.isView(fileOrInput)) {
    buffer = fileOrInput;
  } else if (fileOrInput.workbook) {
    return { workbook: fileOrInput.workbook, matrix: null, fileName };
  } else if (fileOrInput.data && typeof fileOrInput.data === 'string') {
    text = fileOrInput.data;
    fileName = fileOrInput.fileName || fileName;
  } else {
    throw new Error('Unsupported file input format.');
  }

  if (buffer) {
    const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
    return { workbook: wb, matrix: null, fileName };
  }
  return { workbook: null, matrix: parseDelimitedTextToMatrix(text), fileName };
}

/**
 * Finds the best header row index (scanning rows 0..8) matching at least `minMatches` expected column names.
 */
function findBestHeaderRow(matrix, headerAliases, maxColScan = 25) {
  let bestIdx = -1;
  let bestScore = 0;
  const limit = Math.min(matrix.length, 10);
  for (let r = 0; r < limit; r++) {
    const row = (matrix[r] || []).slice(0, maxColScan).map(c => cleanStr(c).toLowerCase());
    let score = 0;
    for (const aliases of Object.values(headerAliases)) {
      if (row.some(cell => aliases.some(a => cell === a || cell.includes(a)))) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }
  return { headerRowIdx: bestIdx, score: bestScore };
}

function buildColIndexMap(headerRow = [], headerAliases, maxColScan = 20) {
  const normalized = headerRow.slice(0, maxColScan).map(c => cleanStr(c).toLowerCase());
  const colMap = {};
  for (const [key, aliases] of Object.entries(headerAliases)) {
    // Prefer exact match first, then substring match
    let idx = normalized.findIndex(cell => aliases.some(a => cell === a));
    if (idx === -1) {
      idx = normalized.findIndex(cell => aliases.some(a => cell.includes(a)));
    }
    colMap[key] = idx;
  }
  return colMap;
}

const SLOT_SCHEMAS = {
  site_stock: {
    maxColScan: 15,
    minMatches: 4,
    aliases: {
      stockName: ['stock name'],
      stockType: ['stock type'],
      partNumber: ['part number', 'product code'],
      partDescription: ['part description', 'product name'],
      partSerial: ['part serial', 'serial number'],
      partImei: ['part imei', 'imei'],
      lastReceivedDate: ['last received date', 'received date'],
      quantity: ['quantity'],
      partValue: ['part value'],
      totalValue: ['total value']
    },
    requiredFields: ['stockName', 'partNumber', 'lastReceivedDate']
  },
  kgb_used: {
    maxColScan: 15,
    minMatches: 4,
    aliases: {
      orderId: ['order id', 'order_id'],
      locationName: ['location name'],
      gsxRepairNumber: ['gsx repair number'],
      gsxRepairStrategy: ['gsx repair strategy'],
      currentGsxStatus: ['current gsx status'],
      repairClosedDate: ['repair closed date', 'closed date'],
      productCode: ['product code', 'part number'],
      productDescription: ['product description', 'part description'],
      productKgb: ['product kgb'],
      productKbb: ['product kbb']
    },
    requiredFields: ['orderId', 'locationName', 'productDescription']
  },
  stock_transfer: {
    // Cap left-hand raw data columns to A:K so right-hand analytics/pivot tables in Excel workbooks don't collide
    maxColScan: 11,
    minMatches: 4,
    aliases: {
      transferReceivedDate: ['transfer received date'],
      fromStock: ['from stock'],
      toStock: ['to stock'],
      productCode: ['product code', 'part number'],
      productName: ['product name', 'part description'],
      transferQuantity: ['transfer quantity', 'quantity'],
      serialNumber: ['serial number'],
      imeiNumber: ['imei number'],
      transferValue: ['transfer value']
    },
    requiredFields: ['transferReceivedDate', 'fromStock', 'toStock', 'serialNumber']
  },
  dc_masterlists: {
    maxColScan: 15,
    minMatches: 5,
    aliases: {
      orderId: ['order id'],
      closedDate: ['closed (date)', 'closed date'],
      locationName: ['location name'],
      lineProductCode: ['line product code'],
      lineProductName: ['line product name'],
      lineKgb: ['line kgb'],
      lineKbb: ['line kbb'],
      deviceWarrantyName: ['device warranty name'],
      status: ['status'],
      lineIsDispatched: ['line is dispatched'],
      lineStatusName: ['line status name'],
      lineIsDoa: ['line is doa'],
      linePriceTotal: ['line price total (incl. vat)', 'line price total']
    },
    requiredFields: ['orderId', 'locationName', 'lineProductCode', 'linePriceTotal']
  },
  sdr_current: {
    maxColScan: 8,
    minMatches: 4,
    aliases: {
      orderId: ['order id'],
      receivedDate: ['received (date)', 'received date'],
      closedDate: ['closed (date)', 'closed date'],
      locationName: ['location name'],
      status: ['status'],
      deviceDescription: ['device description'],
      deviceWarrantyName: ['device warranty name']
    },
    requiredFields: ['orderId', 'receivedDate', 'closedDate']
  }
};
SLOT_SCHEMAS.sdr_baseline = {
  ...SLOT_SCHEMAS.sdr_current,
  maxColScan: 9,
  aliases: {
    ...SLOT_SCHEMAS.sdr_current.aliases,
    precomputedTat: ['reptat status']
  }
};

/**
 * Parses a raw 2D matrix (optionally with worksheet comments) for a specific DC Monitoring slot,
 * returning `{ records, validationLog }`.
 */
export function parseSlotMatrix(slotId, matrix, { fileName = 'upload', commentsByRow = null } = {}) {
  const schema = SLOT_SCHEMAS[slotId];
  if (!schema) throw new Error(`Unknown ingestion slot: ${slotId}`);

  const timestamp = new Date().toISOString();
  const baseLog = {
    slot: slotId,
    fileName,
    timestamp,
    status: 'valid',
    rawRowCount: matrix?.length || 0,
    parsedCount: 0,
    skippedCount: 0,
    missingColumns: [],
    warnings: [],
    errors: []
  };

  if (!Array.isArray(matrix) || matrix.length < 2) {
    return {
      records: [],
      validationLog: {
        ...baseLog,
        status: 'error',
        errors: ['File is empty or contains no data rows.']
      }
    };
  }

  const { headerRowIdx, score } = findBestHeaderRow(matrix, schema.aliases, schema.maxColScan);
  if (headerRowIdx === -1 || score < schema.minMatches) {
    return {
      records: [],
      validationLog: {
        ...baseLog,
        status: 'error',
        errors: [`Unrecognized column structure for ${slotId} (matched ${score}/${schema.minMatches} expected headers).`]
      }
    };
  }

  const colMap = buildColIndexMap(matrix[headerRowIdx], schema.aliases, schema.maxColScan);
  const missingReq = schema.requiredFields.filter(f => colMap[f] === -1);
  if (missingReq.length > 0) {
    return {
      records: [],
      validationLog: {
        ...baseLog,
        status: 'error',
        missingColumns: missingReq,
        errors: [`Missing required columns for ${slotId}: ${missingReq.join(', ')}.`]
      }
    };
  }

  const records = [];
  let badDateCount = 0;
  let blankPrimaryCount = 0;

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || row.every(c => cleanStr(c) === '')) continue;

    if (slotId === 'site_stock') {
      const stockName = cleanStr(row[colMap.stockName]);
      const partNumber = cleanStr(row[colMap.partNumber]);
      const lastReceivedDate = excelDateToISO(row[colMap.lastReceivedDate]);
      if (!stockName && !partNumber) { blankPrimaryCount++; continue; }
      if (row[colMap.lastReceivedDate] && !lastReceivedDate) badDateCount++;
      records.push({
        stockName,
        stockType: colMap.stockType >= 0 ? cleanStr(row[colMap.stockType]) : '',
        partNumber,
        partDescription: colMap.partDescription >= 0 ? cleanStr(row[colMap.partDescription]) : '',
        partSerial: colMap.partSerial >= 0 ? cleanStr(row[colMap.partSerial]) : '',
        partImei: colMap.partImei >= 0 ? cleanStr(row[colMap.partImei]) : '',
        lastReceivedDate,
        quantity: colMap.quantity >= 0 ? cleanNum(row[colMap.quantity]) : 1,
        partValue: colMap.partValue >= 0 ? cleanNum(row[colMap.partValue]) : 0,
        totalValue: colMap.totalValue >= 0 ? cleanNum(row[colMap.totalValue]) : 0,
        rowIndex: r + 1
      });
    } else if (slotId === 'kgb_used') {
      const orderId = cleanStr(row[colMap.orderId]);
      const locationName = cleanStr(row[colMap.locationName]);
      if (!orderId && !locationName) { blankPrimaryCount++; continue; }
      const repairClosedDate = colMap.repairClosedDate >= 0 ? excelDateToISO(row[colMap.repairClosedDate]) : '';
      if (colMap.repairClosedDate >= 0 && row[colMap.repairClosedDate] && !repairClosedDate) badDateCount++;
      records.push({
        orderId,
        locationName,
        gsxRepairNumber: colMap.gsxRepairNumber >= 0 ? cleanStr(row[colMap.gsxRepairNumber]) : '',
        gsxRepairStrategy: colMap.gsxRepairStrategy >= 0 ? cleanStr(row[colMap.gsxRepairStrategy]) : '',
        currentGsxStatus: colMap.currentGsxStatus >= 0 ? cleanStr(row[colMap.currentGsxStatus]) : '',
        repairClosedDate,
        productCode: colMap.productCode >= 0 ? cleanStr(row[colMap.productCode]) : '',
        productDescription: colMap.productDescription >= 0 ? cleanStr(row[colMap.productDescription]) : '',
        productKgb: colMap.productKgb >= 0 ? cleanStr(row[colMap.productKgb]) : '',
        productKbb: colMap.productKbb >= 0 ? cleanStr(row[colMap.productKbb]) : '',
        rowIndex: r + 1
      });
    } else if (slotId === 'stock_transfer') {
      const transferReceivedDate = excelDateToISO(row[colMap.transferReceivedDate]);
      const fromStock = cleanStr(row[colMap.fromStock]);
      const toStock = cleanStr(row[colMap.toStock]);
      const serialNumber = cleanStr(row[colMap.serialNumber]);
      if (!transferReceivedDate && !fromStock && !toStock && !serialNumber) { blankPrimaryCount++; continue; }
      if (row[colMap.transferReceivedDate] && !transferReceivedDate) badDateCount++;
      records.push({
        transferReceivedDate,
        month: formatMonthNameFromIso(transferReceivedDate),
        fromStock,
        toStock,
        productCode: colMap.productCode >= 0 ? cleanStr(row[colMap.productCode]) : '',
        productName: colMap.productName >= 0 ? cleanStr(row[colMap.productName]) : '',
        transferQuantity: colMap.transferQuantity >= 0 ? cleanNum(row[colMap.transferQuantity]) : 1,
        serialNumber,
        imeiNumber: colMap.imeiNumber >= 0 ? cleanStr(row[colMap.imeiNumber]) : '',
        transferValue: colMap.transferValue >= 0 ? cleanNum(row[colMap.transferValue]) : 0,
        rowIndex: r + 1,
        seqIndex: records.length
      });
    } else if (slotId === 'dc_masterlists') {
      const orderId = cleanStr(row[colMap.orderId]);
      if (!orderId) { blankPrimaryCount++; continue; }
      const closedDate = colMap.closedDate >= 0 ? excelDateToISO(row[colMap.closedDate]) : '';
      if (colMap.closedDate >= 0 && row[colMap.closedDate] && !closedDate) badDateCount++;
      records.push({
        orderId,
        closedDate,
        locationName: colMap.locationName >= 0 ? cleanStr(row[colMap.locationName]) : '',
        lineProductCode: colMap.lineProductCode >= 0 ? cleanStr(row[colMap.lineProductCode]) : '',
        lineProductName: colMap.lineProductName >= 0 ? cleanStr(row[colMap.lineProductName]) : '',
        lineKgb: colMap.lineKgb >= 0 ? cleanStr(row[colMap.lineKgb]) : '',
        lineKbb: colMap.lineKbb >= 0 ? cleanStr(row[colMap.lineKbb]) : '',
        deviceWarrantyName: colMap.deviceWarrantyName >= 0 ? cleanStr(row[colMap.deviceWarrantyName]) : '',
        status: colMap.status >= 0 ? cleanStr(row[colMap.status]) : '',
        lineIsDispatched: colMap.lineIsDispatched >= 0 ? cleanStr(row[colMap.lineIsDispatched]) : '',
        lineStatusName: colMap.lineStatusName >= 0 ? cleanStr(row[colMap.lineStatusName]) : '',
        lineIsDoa: colMap.lineIsDoa >= 0 ? cleanStr(row[colMap.lineIsDoa]) : '',
        linePriceTotal: colMap.linePriceTotal >= 0 ? cleanNum(row[colMap.linePriceTotal]) : 0,
        rowIndex: r + 1
      });
    } else if (slotId === 'sdr_current' || slotId === 'sdr_baseline') {
      const orderId = cleanStr(row[colMap.orderId]);
      if (!orderId) { blankPrimaryCount++; continue; }
      const receivedDate = excelDateToISO(row[colMap.receivedDate]);
      const closedDate = excelDateToISO(row[colMap.closedDate]);
      if (row[colMap.receivedDate] && !receivedDate) badDateCount++;
      if (row[colMap.closedDate] && !closedDate) badDateCount++;
      records.push({
        orderId,
        receivedDate,
        closedDate,
        locationName: colMap.locationName >= 0 ? cleanStr(row[colMap.locationName]) : '',
        status: colMap.status >= 0 ? cleanStr(row[colMap.status]) : '',
        deviceDescription: colMap.deviceDescription >= 0 ? cleanStr(row[colMap.deviceDescription]) : '',
        deviceWarrantyName: colMap.deviceWarrantyName >= 0 ? cleanStr(row[colMap.deviceWarrantyName]) : '',
        commentNote: commentsByRow?.get(r) || '',
        rowIndex: r + 1
      });
    }
  }

  const warnings = [];
  if (badDateCount > 0) warnings.push(`${badDateCount} row(s) had unparseable or missing date formatting.`);
  if (blankPrimaryCount > 0) warnings.push(`${blankPrimaryCount} partial row(s) skipped due to blank key identifier.`);

  return {
    records,
    validationLog: {
      ...baseLog,
      status: warnings.length > 0 ? 'warning' : 'valid',
      parsedCount: records.length,
      skippedCount: blankPrimaryCount,
      warnings
    }
  };
}

/**
 * Parses a single uploaded CSV or XLSX file for a designated slot.
 */
export async function ingestDcMonitoringFile(slotId, fileOrInput) {
  const { workbook, matrix, fileName } = await readInputPayload(fileOrInput);
  if (workbook) {
    const slotMeta = DC_MONITORING_SLOTS.find(s => s.id === slotId);
    let targetSheetName = workbook.SheetNames.find(n =>
      slotMeta?.sheetAliases.some(alias => n.trim().toLowerCase() === alias.toLowerCase())
    );
    if (!targetSheetName) {
      targetSheetName = workbook.SheetNames[0];
    }
    const sheet = workbook.Sheets[targetSheetName];
    const { rows, commentsByRow } = sheetToMatrixWithComments(sheet);
    return parseSlotMatrix(slotId, rows, { fileName: `${fileName} [${targetSheetName}]`, commentsByRow });
  }
  return parseSlotMatrix(slotId, matrix, { fileName });
}

/**
 * Extracts initial Shipping Costs & Non-Serial Repair Remarks when importing a complete DC Stock Monitoring workbook.
 */
function extractWorkbookExtras(workbook) {
  const shippingCosts = [];
  const nonSerialRemarks = {};

  const stSheet = workbook.Sheets['Stock Transfer'];
  if (stSheet) {
    const rows = XLSX.utils.sheet_to_json(stSheet, { header: 1, raw: true, defval: '' });
    // Search header for "DC Delivery Shipping Cost" around col AQ..AT (indices 42..46)
    let hdrRow = -1;
    let monthCol = -1;
    for (let r = 0; r < Math.min(rows.length, 6); r++) {
      const idx = (rows[r] || []).findIndex((c, ci) => ci >= 35 && cleanStr(c).toLowerCase() === 'month');
      if (idx !== -1 && cleanStr(rows[r][idx + 1]).toLowerCase().includes('courier')) {
        hdrRow = r;
        monthCol = idx;
        break;
      }
    }
    if (hdrRow !== -1) {
      for (let r = hdrRow + 1; r < rows.length; r++) {
        const m = cleanStr(rows[r]?.[monthCol]);
        const courier = cleanStr(rows[r]?.[monthCol + 1]);
        const amount = cleanNum(rows[r]?.[monthCol + 2]);
        if (!m && !courier) break;
        if (m && amount > 0) {
          shippingCosts.push({
            id: `ship-wb-${m.toLowerCase()}-${r}`,
            month: m,
            year: 2026,
            courier: courier || 'Lalamove',
            amount,
            notes: 'Imported from DC Stock Monitoring workbook'
          });
        }
      }
    }
  }

  const nsrSheet = workbook.Sheets['Non-Serial Repair'];
  if (nsrSheet) {
    const { rows, commentsByRow } = sheetToMatrixWithComments(nsrSheet);
    for (const [rowIdx, note] of commentsByRow.entries()) {
      const orderId = cleanStr(rows[rowIdx]?.[8] || rows[rowIdx]?.[0]);
      if (orderId) {
        nonSerialRemarks[`nsr::${orderId}`] = {
          orderId,
          status: 'Imported Remark',
          remark: note,
          updatedAt: new Date().toISOString()
        };
      }
    }
  }

  return { shippingCosts, nonSerialRemarks };
}

/**
 * Ingests a complete multi-sheet `DC Stock Monitoring.xlsx` workbook in a single step,
 * splitting all matching input sheets into their respective normalized datasets plus extras.
 */
export async function ingestCompleteWorkbookFile(fileOrInput) {
  const { workbook, fileName } = await readInputPayload(fileOrInput);
  if (!workbook) {
    throw new Error('Complete workbook import requires a multi-sheet .xlsx / .xls file.');
  }

  const datasets = {};
  const validationLogs = {};

  for (const slot of DC_MONITORING_SLOTS) {
    const matchedName = workbook.SheetNames.find(n =>
      slot.sheetAliases.some(alias => n.trim().toLowerCase() === alias.toLowerCase())
    );
    if (matchedName) {
      const { rows, commentsByRow } = sheetToMatrixWithComments(workbook.Sheets[matchedName]);
      const { records, validationLog } = parseSlotMatrix(slot.id, rows, {
        fileName: `${fileName} [${matchedName}]`,
        commentsByRow
      });
      datasets[slot.id] = records;
      validationLogs[slot.id] = validationLog;
    }
  }

  const extras = extractWorkbookExtras(workbook);
  return {
    fileName,
    sheetNames: workbook.SheetNames,
    datasets,
    validationLogs,
    extras
  };
}

/**
 * Computes comprehensive DC Stock Monitoring, SDR/RepTAT, Transfers, Sales, Warranty,
 * Exception Queues, and Cross-File Reconciliation Analytics from ingested datasets.
 */
export function computeDcStockMonitoringAnalytics(datasets = {}, options = {}) {
  const {
    referenceDate = new Date().toISOString().slice(0, 10),
    inventoryYearFilter = '2026', // '2026' | 'ALL'
    shippingCosts = DEFAULT_DC_SHIPPING_COSTS
  } = options;

  const siteStockRows = Array.isArray(datasets.site_stock) ? datasets.site_stock : [];
  const kgbUsedRows = Array.isArray(datasets.kgb_used) ? datasets.kgb_used : [];
  const stockTransferRows = Array.isArray(datasets.stock_transfer) ? datasets.stock_transfer : [];
  const dcMasterlistsRows = Array.isArray(datasets.dc_masterlists) ? datasets.dc_masterlists : [];
  const sdrCurrentRows = Array.isArray(datasets.sdr_current) ? datasets.sdr_current : [];
  const sdrBaselineRows = Array.isArray(datasets.sdr_baseline) ? datasets.sdr_baseline : [];

  // ── 1. Part Usage (iPhone KGB Used) ─────────────────────────────────────────
  const iphoneKgbUsed = [];
  const firstUsedBySerial = new Map();
  const lastUsedBySerial = new Map();

  for (const row of kgbUsedRows) {
    if (!/IPHONE/i.test(row.productDescription || '')) continue;
    const item = {
      orderId: row.orderId,
      gsxRepairNumber: row.gsxRepairNumber,
      repairClosedDate: row.repairClosedDate,
      locationName: row.locationName,
      productCode: row.productCode,
      productDescription: row.productDescription,
      productKgb: row.productKgb,
      productKbb: row.productKbb
    };
    iphoneKgbUsed.push(item);

    const sn = cleanStr(row.productKgb);
    if (sn) {
      if (!firstUsedBySerial.has(sn)) firstUsedBySerial.set(sn, item);
      lastUsedBySerial.set(sn, item);
    }
  }

  // ── 2. Inventory Filtered (2026 default matching workbook, or ALL) ──────────
  const inventoryFiltered = siteStockRows
    .filter(r => {
      if (!inventoryYearFilter || inventoryYearFilter === 'ALL') return true;
      return r.lastReceivedDate && r.lastReceivedDate.startsWith(`${inventoryYearFilter}-`);
    })
    .map(r => ({
      lastReceivedDate: r.lastReceivedDate,
      stockName: r.stockName,
      partNumber: r.partNumber,
      partDescription: r.partDescription,
      quantity: r.quantity,
      partSerial: r.partSerial,
      partValue: r.partValue,
      totalValue: r.totalValue
    }))
    .sort((a, b) => (a.lastReceivedDate || '9999').localeCompare(b.lastReceivedDate || '9999'));

  // ── 3. DC Transfers Consolidation (Unique serials where From Stock contains DC) ──
  const allTransfersBySerial = new Map();
  const dcOriginSerials = new Set();

  for (const row of stockTransferRows) {
    const sn = cleanStr(row.serialNumber);
    if (!sn) continue;
    if (/DC/i.test(row.fromStock || '')) {
      dcOriginSerials.add(sn);
    }
    if (!allTransfersBySerial.has(sn)) allTransfersBySerial.set(sn, []);
    allTransfersBySerial.get(sn).push(row);
  }

  const dcTransfers = [];
  const dcEarliestDateBySerial = new Map();
  for (const sn of dcOriginSerials) {
    const rowsForSerial = allTransfersBySerial.get(sn) || [];
    let earliestDate = '';
    let latestRow = rowsForSerial[0];
    for (const tr of rowsForSerial) {
      if (tr.transferReceivedDate && (!earliestDate || tr.transferReceivedDate < earliestDate)) {
        earliestDate = tr.transferReceivedDate;
      }
      const dTr = tr.transferReceivedDate || '';
      const dBest = latestRow?.transferReceivedDate || '';
      if (dTr > dBest || (dTr === dBest && tr.seqIndex > latestRow.seqIndex)) {
        latestRow = tr;
      }
    }
    dcEarliestDateBySerial.set(sn, earliestDate || latestRow?.transferReceivedDate || '');
    dcTransfers.push({
      transferReceivedDate: earliestDate || latestRow?.transferReceivedDate || '',
      fromStock: latestRow?.fromStock || '',
      toStock: latestRow?.toStock || '',
      productCode: latestRow?.productCode || '',
      productName: latestRow?.productName || '',
      transferQuantity: latestRow?.transferQuantity || 1,
      serialNumber: sn,
      transferValue: latestRow?.transferValue || 0,
      hopCount: rowsForSerial.length
    });
  }
  dcTransfers.sort((a, b) => (a.transferReceivedDate || '9999').localeCompare(b.transferReceivedDate || '9999'));

  // ── 4. Reconciled Inventory (`Site Stocks` X:AI) ─────────────────────────────
  const serialOccurrences = new Map();
  const rawReconciled = inventoryFiltered
    .filter(inv => cleanStr(inv.partSerial) !== '')
    .map(inv => {
      const sn = cleanStr(inv.partSerial);
      const upperSn = sn.toUpperCase();
      if (upperSn !== 'FOR DELETE') {
        serialOccurrences.set(sn, (serialOccurrences.get(sn) || 0) + 1);
      }
      const usage = firstUsedBySerial.get(sn);
      const isDcStock = dcOriginSerials.has(sn);
      const stockType = isDcStock ? 'DC Stock' : 'MSPI Owned/ CIN REP';
      const dcDate = dcEarliestDateBySerial.get(sn);
      const adjustedReceivedDate = (isDcStock && dcDate) ? dcDate : inv.lastReceivedDate;

      const standardSite = normalizeDcSheetSiteName(inv.stockName);
      const rawUsedBy = usage?.locationName || '';
      const transferredStatus = !rawUsedBy
        ? ''
        : (isTransferredOutMismatch(standardSite, rawUsedBy) ? `Transferred to ${rawUsedBy}` : rawUsedBy);

      const isUnused = !usage?.repairClosedDate;
      const aging = isUnused
        ? calculateDcAgingStatus(adjustedReceivedDate, referenceDate)
        : { daysElapsed: null, bucket: 'Consumed', label: '' };

      return {
        adjustedReceivedDate,
        repairClosedDate: usage?.repairClosedDate || '',
        stockName: inv.stockName,
        standardSiteName: standardSite,
        serialUsedBy: transferredStatus,
        rawUsedBy,
        partNumber: inv.partNumber,
        partDescription: inv.partDescription,
        transferredSerial: sn,
        orderNumber: usage?.orderId || '',
        stockType,
        agingBucket: aging.bucket,
        daysInStock: aging.daysElapsed,
        agingStatus: aging.label,
        partValue: inv.partValue,
        totalValue: inv.totalValue
      };
    });

  const duplicateSerialSet = new Set();
  for (const [sn, count] of serialOccurrences.entries()) {
    if (count > 1) duplicateSerialSet.add(sn);
  }
  const reconciledInventory = rawReconciled.map(item => ({
    ...item,
    isDuplicate: duplicateSerialSet.has(item.transferredSerial)
  }));
  const duplicateReconciledRows = reconciledInventory.filter(r => r.isDuplicate);
  const undispatched2026 = reconciledInventory.filter(r => cleanStr(r.orderNumber) !== '');

  // Aging counts across unused DC Stock vs All Unused
  const unusedDcItems = reconciledInventory.filter(r => r.stockType === 'DC Stock' && !r.repairClosedDate);
  const agingSummary = {
    totalActive: reconciledInventory.filter(r => !r.repairClosedDate).length,
    dcUnusedTotal: unusedDcItems.length,
    inStock: reconciledInventory.filter(r => r.agingBucket === 'In Stock').length,
    slowMoving: reconciledInventory.filter(r => r.agingBucket === 'Slow-Moving').length,
    nonMoving: reconciledInventory.filter(r => r.agingBucket === 'Non-Moving').length,
    deadStock: reconciledInventory.filter(r => r.agingBucket === 'Dead Stock').length,
    dcSlowMoving: unusedDcItems.filter(r => r.agingBucket === 'Slow-Moving').length,
    dcNonMoving: unusedDcItems.filter(r => r.agingBucket === 'Non-Moving').length,
    dcDeadStock: unusedDcItems.filter(r => r.agingBucket === 'Dead Stock').length
  };

  // ── 5. Stock Transfer Analytics & Shipping Costs ────────────────────────────
  // Matches Google Sheets `'Stock Transfer'!M:AD` which aggregates the deduplicated DC Transfers set (`dcTransfers`).
  const dcRawTransfers = stockTransferRows.filter(r => /DC/i.test(r.fromStock || ''));
  const monthlyTransferMap = new Map();
  const destSiteMap = new Map();
  const productCountMap = new Map();
  let totalTransferValue = 0;

  for (const tr of dcTransfers) {
    totalTransferValue += tr.transferValue || 0;
    const mName = formatMonthNameFromIso(tr.transferReceivedDate) || 'Unknown';
    if (mName !== 'Unknown') {
      const mEntry = monthlyTransferMap.get(mName) || { month: mName, count: 0, value: 0 };
      mEntry.count += 1;
      mEntry.value += tr.transferValue || 0;
      monthlyTransferMap.set(mName, mEntry);
    }

    const destKey = cleanStr(tr.toStock) || 'Unknown';
    const dEntry = destSiteMap.get(destKey) || {
      toStock: destKey,
      siteName: normalizeDcSheetSiteName(destKey),
      count: 0,
      value: 0
    };
    dEntry.count += 1;
    dEntry.value += tr.transferValue || 0;
    destSiteMap.set(destKey, dEntry);

    if (tr.productCode && tr.productName) {
      const pKey = `${tr.productCode}::${tr.productName}`;
      const pEntry = productCountMap.get(pKey) || {
        productCode: tr.productCode,
        productName: tr.productName,
        quantity: 0,
        category: /battery/i.test(tr.productName) ? 'Battery' : (/display/i.test(tr.productName) ? 'Display' : 'Other')
      };
      pEntry.quantity += 1;
      productCountMap.set(pKey, pEntry);
    }
  }

  const monthlyTransferVolume = Array.from(monthlyTransferMap.values())
    .sort((a, b) => MONTH_NAMES.indexOf(a.month) - MONTH_NAMES.indexOf(b.month));
  const transferDestinationBreakdown = Array.from(destSiteMap.values())
    .sort((a, b) => b.count - a.count)
    .map(item => ({
      ...item,
      sharePct: dcTransfers.length > 0 ? (item.count / dcTransfers.length) * 100 : 0
    }));
  const topTransferredProducts = Array.from(productCountMap.values()).sort((a, b) => b.quantity - a.quantity);
  const topBatteries = topTransferredProducts.filter(p => p.category === 'Battery');
  const topDisplays = topTransferredProducts.filter(p => p.category === 'Display');

  const normalizedShipping = (shippingCosts || []).map(c => ({
    ...c,
    amount: cleanNum(c.amount)
  }));
  const totalShippingCost = normalizedShipping.reduce((sum, c) => sum + c.amount, 0);

  // ── 6. SDR Maps (Current 2026 & Baseline 2025) ──────────────────────────────
  const buildSdrIndex = (rows) => {
    const byOrder = new Map();
    const sdrOrderSet = new Set();
    let totalOrdersWithDates = 0;
    let openOrMissingDateOrders = 0;
    let negativeTatCount = 0;

    for (const r of rows) {
      const oid = cleanStr(r.orderId);
      if (!oid) continue;
      const days = diffIsoDays(r.receivedDate, r.closedDate);
      const hasValidDates = days !== null;
      if (hasValidDates) {
        totalOrdersWithDates++;
        if (days < 0) negativeTatCount++;
        if (r.receivedDate === r.closedDate) {
          sdrOrderSet.add(oid);
        }
      } else {
        openOrMissingDateOrders++;
      }
      if (!byOrder.has(oid)) {
        byOrder.set(oid, {
          ...r,
          tatDays: hasValidDates ? Math.max(0, days) : null,
          rawTatDays: days,
          isSdr: hasValidDates && r.receivedDate === r.closedDate,
          tatCategory: hasValidDates ? classifyTatCategory(days) : ''
        });
      }
    }
    return { byOrder, sdrOrderSet, totalOrdersWithDates, openOrMissingDateOrders, negativeTatCount };
  };

  const sdr2026Idx = buildSdrIndex(sdrCurrentRows);
  const sdr2025Idx = buildSdrIndex(sdrBaselineRows);

  // ── 7. DC Used Serials & Per-Order RepTAT Resolution ────────────────────────
  const dcUsedSerials = dcTransfers.map(tr => {
    const usage = lastUsedBySerial.get(tr.serialNumber);
    const repairClosedDate = usage?.repairClosedDate || '';
    const rawUsedBy = usage?.locationName || '';
    const standardToSite = normalizeDcSheetSiteName(tr.toStock);
    const serialUsedBy = !rawUsedBy
      ? ''
      : (isTransferredOutMismatch(standardToSite, rawUsedBy) ? `Transferred to ${rawUsedBy}` : rawUsedBy);
    const orderId = usage?.orderId || '';

    let repTat = '';
    let repTatDays = null;
    let repTatCategory = '';
    if (orderId) {
      if (sdr2026Idx.sdrOrderSet.has(orderId)) {
        repTat = 'SDR';
        repTatDays = 0;
        repTatCategory = 'SDR';
      } else if (sdr2026Idx.byOrder.has(orderId)) {
        const ord = sdr2026Idx.byOrder.get(orderId);
        if (ord.rawTatDays !== null) {
          repTat = `TAT: ${ord.rawTatDays} day(s)`;
          repTatDays = ord.rawTatDays;
          repTatCategory = classifyTatCategory(ord.rawTatDays);
        }
      }
    }

    return {
      transferReceivedDate: tr.transferReceivedDate,
      repairClosedDate,
      toStock: tr.toStock,
      serialUsedBy,
      partNumber: tr.productCode,
      partDescription: tr.productName,
      transferredSerial: tr.serialNumber,
      orderId,
      repTat,
      repTatDays,
      repTatCategory
    };
  }).sort((a, b) => (a.toStock || '').localeCompare(b.toStock || ''));

  // Build quick lookup from DC Masterlists `Line KGB` -> first matching row
  const masterlistByKgb = new Map();
  for (const row of dcMasterlistsRows) {
    const kgb = cleanStr(row.lineKgb);
    if (kgb && !masterlistByKgb.has(kgb)) {
      masterlistByKgb.set(kgb, row);
    }
  }

  // ── 8. DC-Stock SDR Analytics (`SDR (DC)`) vs Overall 2026 vs 2025 Baseline ──
  const dcUsedWithRepTat = dcUsedSerials.filter(r => r.repTat !== '');
  const dcSdrRows = dcUsedSerials.filter(r => r.repTat === 'SDR');

  const computeTatBreakdown = (items, getCatFn) => {
    const counts = Object.fromEntries(TAT_CATEGORY_ORDER.map(k => [k, 0]));
    for (const item of items) {
      const cat = getCatFn(item);
      if (cat && cat in counts) counts[cat]++;
    }
    const total = items.length;
    return TAT_CATEGORY_ORDER.map(cat => ({
      category: cat,
      count: counts[cat],
      percentage: total > 0 ? counts[cat] / total : 0
    }));
  };

  const dcTatBreakdown = computeTatBreakdown(dcUsedWithRepTat, r => r.repTatCategory);

  // DC Monthly SDR Breakdown
  const dcMonthlySdrMap = new Map();
  for (const r of dcSdrRows) {
    const mName = formatMonthNameFromIso(r.repairClosedDate);
    if (!mName) continue;
    dcMonthlySdrMap.set(mName, (dcMonthlySdrMap.get(mName) || 0) + 1);
  }
  const dcMonthlySdr = Array.from(dcMonthlySdrMap.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => MONTH_NAMES.indexOf(a.month) - MONTH_NAMES.indexOf(b.month));

  // DC SDR Warranty & Sites (matching 'DC Masterlists'!F against DC SDR Serials)
  const dcSdrWarrantyCounts = Object.fromEntries([...WARRANTY_TARGET_CATEGORIES, 'Others'].map(w => [w, 0]));
  let dcSdrWarrantyMatchedTotal = 0;
  const dcSdrSiteMap = new Map();

  for (const r of dcSdrRows) {
    const dm = masterlistByKgb.get(r.transferredSerial);
    if (!dm) continue;
    if (dm.deviceWarrantyName) {
      dcSdrWarrantyMatchedTotal++;
      const wb = normalizeWarrantyBucket(dm.deviceWarrantyName);
      dcSdrWarrantyCounts[wb.bucket] = (dcSdrWarrantyCounts[wb.bucket] || 0) + 1;
    }
    if (dm.locationName) {
      dcSdrSiteMap.set(dm.locationName, (dcSdrSiteMap.get(dm.locationName) || 0) + 1);
    }
  }
  const dcSdrWarrantyBreakdown = [...WARRANTY_TARGET_CATEGORIES, 'Others'].map(label => ({
    warranty: label,
    count: dcSdrWarrantyCounts[label] || 0,
    percentage: dcSdrWarrantyMatchedTotal > 0 ? (dcSdrWarrantyCounts[label] || 0) / dcSdrWarrantyMatchedTotal : 0
  }));
  const dcSdrTopSites = Array.from(dcSdrSiteMap.entries())
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count);

  // Historical Baseline 2025 (`SDR (2025)`) & Overall 2026 All-Orders SDR
  const computeRawSdrSheetStats = (rows, idx) => {
    const validOrders = [];
    const monthlyMap = new Map();
    const warrantyCounts = Object.fromEntries([...WARRANTY_TARGET_CATEGORIES, 'Others'].map(w => [w, 0]));
    const siteSdrMap = new Map();
    const siteTotalMap = new Map();
    const siteTatSumMap = new Map();
    const deviceMap = new Map();
    let sdrCount = 0;
    let totalTatDays = 0;

    for (const r of rows) {
      const days = diffIsoDays(r.receivedDate, r.closedDate);
      if (days === null) continue;
      const clamped = Math.max(0, days);
      const isSdr = r.receivedDate === r.closedDate;
      const cat = classifyTatCategory(days);
      totalTatDays += clamped;
      if (isSdr) sdrCount++;

      validOrders.push({
        ...r,
        tatDays: clamped,
        isSdr,
        tatCategory: cat
      });

      const site = r.locationName || 'Unknown';
      siteTotalMap.set(site, (siteTotalMap.get(site) || 0) + 1);
      siteTatSumMap.set(site, (siteTatSumMap.get(site) || 0) + clamped);

      const ymKey = r.closedDate ? r.closedDate.slice(0, 7) : '';
      if (ymKey) {
        const mEntry = monthlyMap.get(ymKey) || { ymKey, label: formatMonthYearFromIso(r.closedDate), total: 0, sdrCount: 0 };
        mEntry.total += 1;
        if (isSdr) mEntry.sdrCount += 1;
        monthlyMap.set(ymKey, mEntry);
      }

      const dev = r.deviceDescription || 'Unknown Device';
      const dEntry = deviceMap.get(dev) || { device: dev, total: 0, sdrCount: 0, tatSum: 0 };
      dEntry.total += 1;
      dEntry.tatSum += clamped;
      if (isSdr) dEntry.sdrCount += 1;
      deviceMap.set(dev, dEntry);

      if (isSdr) {
        siteSdrMap.set(site, (siteSdrMap.get(site) || 0) + 1);
        const wb = normalizeWarrantyBucket(r.deviceWarrantyName);
        warrantyCounts[wb.bucket] = (warrantyCounts[wb.bucket] || 0) + 1;
      }
    }

    const tatBreakdown = computeTatBreakdown(validOrders, o => o.tatCategory);
    const monthlyTrend = Array.from(monthlyMap.values())
      .sort((a, b) => a.ymKey.localeCompare(b.ymKey))
      .map(m => ({ ...m, sdrRate: m.total > 0 ? m.sdrCount / m.total : 0 }));
    const warrantyBreakdown = [...WARRANTY_TARGET_CATEGORIES, 'Others'].map(label => ({
      warranty: label,
      count: warrantyCounts[label] || 0,
      percentage: sdrCount > 0 ? (warrantyCounts[label] || 0) / sdrCount : 0
    }));
    const siteBreakdown = Array.from(siteTotalMap.entries()).map(([site, total]) => {
      const sCount = siteSdrMap.get(site) || 0;
      return {
        site,
        total,
        sdrCount: sCount,
        sdrRate: total > 0 ? sCount / total : 0,
        avgTatDays: total > 0 ? (siteTatSumMap.get(site) || 0) / total : 0
      };
    }).sort((a, b) => b.sdrCount - a.sdrCount || b.total - a.total);
    const deviceBreakdown = Array.from(deviceMap.values())
      .map(d => ({
        ...d,
        sdrRate: d.total > 0 ? d.sdrCount / d.total : 0,
        avgTatDays: d.total > 0 ? d.tatSum / d.total : 0
      }))
      .sort((a, b) => b.total - a.total);

    return {
      totalCompleted: validOrders.length,
      openOrMissingDates: idx.openOrMissingDateOrders,
      negativeTatAnomalies: idx.negativeTatCount,
      sdrCount,
      sdrRate: validOrders.length > 0 ? sdrCount / validOrders.length : 0,
      avgTatDays: validOrders.length > 0 ? totalTatDays / validOrders.length : 0,
      tatBreakdown,
      monthlyTrend,
      warrantyBreakdown,
      siteBreakdown,
      deviceBreakdown,
      validOrders
    };
  };

  const sdr2025Stats = computeRawSdrSheetStats(sdrBaselineRows, sdr2025Idx);
  const allOrders2026Stats = computeRawSdrSheetStats(sdrCurrentRows, sdr2026Idx);

  // `RepTAT Breakdown` Comparative 2025 Non-DC vs 2026 DC Stock
  const tatComparison = TAT_CATEGORY_ORDER.map(cat => {
    const r25 = sdr2025Stats.tatBreakdown.find(t => t.category === cat) || { count: 0, percentage: 0 };
    const r26 = dcTatBreakdown.find(t => t.category === cat) || { count: 0, percentage: 0 };
    return {
      category: cat,
      count2025: r25.count,
      pct2025: r25.percentage,
      count2026Dc: r26.count,
      pct2026Dc: r26.percentage,
      pctPointDiff: (r26.percentage - r25.percentage) * 100
    };
  });

  const combinedMonthlyTimeline = [
    ...sdr2025Stats.monthlyTrend.map(m => ({
      periodLabel: `${m.label} (Non-DC Stock)`,
      shortLabel: m.label,
      cohort: '2025 Non-DC Stock',
      sdrCount: m.sdrCount,
      totalCompleted: m.total,
      sdrRate: m.sdrRate
    })),
    ...dcMonthlySdr.map(m => ({
      periodLabel: `${m.month} 2026 (DC Stock)`,
      shortLabel: `${m.month} 2026`,
      cohort: '2026 DC Stock',
      sdrCount: m.count,
      totalCompleted: null,
      sdrRate: null
    }))
  ];

  const warrantyComparison = [...WARRANTY_TARGET_CATEGORIES, 'Others'].map(label => {
    const w25 = sdr2025Stats.warrantyBreakdown.find(w => w.warranty === label) || { count: 0, percentage: 0 };
    const w26 = dcSdrWarrantyBreakdown.find(w => w.warranty === label) || { count: 0, percentage: 0 };
    return {
      warranty: label,
      count2025: w25.count,
      pct2025: w25.percentage,
      count2026Dc: w26.count,
      pct2026Dc: w26.percentage
    };
  });

  const allSiteNamesForShift = new Set([
    ...sdr2025Stats.siteBreakdown.filter(s => s.sdrCount > 0).map(s => s.site),
    ...dcSdrTopSites.map(s => s.site)
  ]);
  const multiSiteShiftSummary = Array.from(allSiteNamesForShift).map(site => {
    const s25 = sdr2025Stats.siteBreakdown.find(x => x.site === site)?.sdrCount || 0;
    const s26 = dcSdrTopSites.find(x => x.site === site)?.count || 0;
    return {
      site,
      sdr2025: s25,
      sdr2026: s26,
      difference: s26 - s25
    };
  }).sort((a, b) => b.sdr2025 - a.sdr2025 || b.sdr2026 - a.sdr2026);

  // ── 9. Sales (DC) Analytics ─────────────────────────────────────────────────
  const salesRows = [];
  let totalDcSalesPhp = 0;
  const salesSiteMap = new Map();
  const salesMonthMap = new Map();
  const salesProductMap = new Map();

  for (const dm of dcMasterlistsRows) {
    const kgb = cleanStr(dm.lineKgb);
    if (!kgb || !dcOriginSerials.has(kgb)) continue;
    if (cleanStr(dm.status) !== 'Order Picked Up') continue;

    const monthName = formatMonthNameFromIso(dm.closedDate);
    const amount = dm.linePriceTotal || 0;
    totalDcSalesPhp += amount;

    salesRows.push({
      month: monthName,
      orderId: dm.orderId,
      closedDate: dm.closedDate,
      locationName: dm.locationName,
      lineProductCode: dm.lineProductCode,
      lineProductName: dm.lineProductName,
      lineKgb: kgb,
      lineKbb: dm.lineKbb,
      deviceWarrantyName: dm.deviceWarrantyName,
      status: dm.status,
      lineIsDispatched: dm.lineIsDispatched,
      linePriceTotal: amount
    });

    const siteKey = dm.locationName || 'Unknown';
    const sEntry = salesSiteMap.get(siteKey) || { site: siteKey, totalSales: 0, orderCount: 0 };
    sEntry.totalSales += amount;
    sEntry.orderCount += 1;
    salesSiteMap.set(siteKey, sEntry);

    if (monthName) {
      const mEntry = salesMonthMap.get(monthName) || { month: monthName, totalAmount: 0, orderCount: 0 };
      mEntry.totalAmount += amount;
      mEntry.orderCount += 1;
      salesMonthMap.set(monthName, mEntry);
    }

    if (dm.lineProductCode) {
      const pKey = `${dm.lineProductCode}::${dm.lineProductName}`;
      const pEntry = salesProductMap.get(pKey) || {
        productCode: dm.lineProductCode,
        productName: dm.lineProductName,
        totalSales: 0,
        units: 0
      };
      pEntry.totalSales += amount;
      pEntry.units += 1;
      salesProductMap.set(pKey, pEntry);
    }
  }

  const salesBySite = Array.from(salesSiteMap.values()).sort((a, b) => b.totalSales - a.totalSales);
  const salesByMonth = Array.from(salesMonthMap.values())
    .sort((a, b) => MONTH_NAMES.indexOf(a.month) - MONTH_NAMES.indexOf(b.month));
  const salesTopProducts = Array.from(salesProductMap.values()).sort((a, b) => b.totalSales - a.totalSales);

  // ── 10. Warranty Breakdown (DC Masterlists matched against DC Transfers) ────
  const warrantyDcMatchedRows = dcMasterlistsRows.filter(
    dm => cleanStr(dm.lineKgb) && dcOriginSerials.has(cleanStr(dm.lineKgb))
  );
  const warrantyDcCounts = Object.fromEntries([...WARRANTY_TARGET_CATEGORIES, 'Others'].map(w => [w, 0]));
  let redactedWarrantyCount = 0;
  for (const row of warrantyDcMatchedRows) {
    const wb = normalizeWarrantyBucket(row.deviceWarrantyName);
    warrantyDcCounts[wb.bucket] = (warrantyDcCounts[wb.bucket] || 0) + 1;
    if (wb.isRedacted) redactedWarrantyCount++;
  }
  const warrantyDcBreakdown = [...WARRANTY_TARGET_CATEGORIES, 'Others'].map(label => ({
    warranty: label,
    count: warrantyDcCounts[label] || 0,
    percentage: warrantyDcMatchedRows.length > 0 ? (warrantyDcCounts[label] || 0) / warrantyDcMatchedRows.length : 0
  }));

  // ── 11. Operational Exceptions & Action Queues ──────────────────────────────
  const doaAllRows = dcMasterlistsRows.filter(r => /^yes$/i.test(cleanStr(r.lineIsDoa)));
  const doaDcStockRows = doaAllRows.filter(r => cleanStr(r.lineKgb) && dcOriginSerials.has(cleanStr(r.lineKgb)));
  const gprRows = dcMasterlistsRows
    .filter(r => /gpr/i.test(cleanStr(r.lineStatusName)))
    .sort((a, b) => (a.locationName || '').localeCompare(b.locationName || ''));
  const undispatchedCinDc = dcMasterlistsRows
    .filter(r => /^no$/i.test(cleanStr(r.lineIsDispatched)))
    .sort((a, b) => (a.locationName || '').localeCompare(b.locationName || ''));

  // S2S Transfer (`From` does NOT contain DC AND LEFT(From, 3) != LEFT(To, 3))
  const s2sTransfers = dcTransfers
    .filter(tr => {
      const f = (tr.fromStock || '').toUpperCase();
      const t = (tr.toStock || '').toUpperCase();
      return !f.includes('DC') && f.slice(0, 3) !== t.slice(0, 3);
    })
    .map(tr => {
      const usage = firstUsedBySerial.get(tr.serialNumber);
      const standardTo = normalizeDcSheetSiteName(tr.toStock);
      const rawUsed = usage?.locationName || '';
      const serialUsedBy = !rawUsed
        ? ''
        : (isTransferredOutMismatch(standardTo, rawUsed) ? `Transferred to ${rawUsed}` : rawUsed);
      return {
        transferReceivedDate: tr.transferReceivedDate,
        repairClosedDate: usage?.repairClosedDate || '',
        fromStock: tr.fromStock,
        toStock: tr.toStock,
        serialUsedBy,
        partNumber: tr.productCode,
        partDescription: tr.productName,
        transferredSerial: tr.serialNumber,
        orderNumber: usage?.orderId || ''
      };
    });
  const unusedS2SSerials = s2sTransfers
    .filter(r => !r.repairClosedDate && !r.orderNumber)
    .sort((a, b) => (a.toStock || '').localeCompare(b.toStock || ''));

  // Non-Serial Repair + Automated Fixably Anomaly Cross-Check
  const siteStockByOrderOrPart = new Map();
  for (const s of siteStockRows) {
    if (s.partSerial) {
      siteStockByOrderOrPart.set(s.partSerial, s);
    }
  }
  const masterlistByOrderId = new Map();
  for (const dm of dcMasterlistsRows) {
    if (dm.orderId) {
      if (!masterlistByOrderId.has(dm.orderId)) masterlistByOrderId.set(dm.orderId, []);
      masterlistByOrderId.get(dm.orderId).push(dm);
    }
  }

  const nonSerialRepairs = iphoneKgbUsed
    .filter(r => cleanStr(r.productKgb) === '')
    .map(r => {
      const dmLines = masterlistByOrderId.get(r.orderId) || [];
      const matchingLine = dmLines.find(d => d.lineProductCode === r.productCode) || dmLines[0];
      const autoFlags = [];
      if (matchingLine?.lineIsDoa === 'Yes') autoFlags.push('Tagged DOA in Masterlist');
      if (matchingLine?.lineKgb) {
        autoFlags.push(`Masterlist KGB found: ${matchingLine.lineKgb}`);
        if (siteStockByOrderOrPart.has(matchingLine.lineKgb)) {
          autoFlags.push('Serial still in Site Stock');
        }
      }
      if (/gpr/i.test(matchingLine?.lineStatusName || '')) autoFlags.push('Marked GPR');
      if (/no/i.test(matchingLine?.lineIsDispatched || '')) autoFlags.push('Line Undispatched');
      return {
        ...r,
        inferredKgb: matchingLine?.lineKgb || '',
        inferredKbb: r.productKbb || matchingLine?.lineKbb || '',
        masterlistStatus: matchingLine?.status || '',
        autoDiagnostic: autoFlags.length > 0 ? autoFlags.join(' • ') : 'Missing KGB serial in Fixably GSX report'
      };
    })
    .sort((a, b) => (a.locationName || '').localeCompare(b.locationName || ''));

  // ── 12. Data Integrity & Reconciliation Audit Checks ────────────────────────
  const usedSerialsMissingSdr = dcUsedSerials.filter(r => r.orderId && !r.repTat);
  const dcUsedTotalWithOrder = dcUsedSerials.filter(r => cleanStr(r.orderId) !== '').length;
  const dcSdrRate = dcUsedWithRepTat.length > 0 ? dcSdrRows.length / dcUsedWithRepTat.length : 0;

  const reconciliationChecks = [
    {
      id: 'dc-transfer-coverage',
      title: 'DC Serial Reconciliation Coverage',
      status: dcTransfers.length > 0 ? 'pass' : 'info',
      detail: `${dcUsedSerials.filter(r => r.orderId).length.toLocaleString()} of ${dcTransfers.length.toLocaleString()} DC transferred serials matched to iPhone KGB repair consumption (${dcTransfers.length > 0 ? ((dcUsedSerials.filter(r => r.orderId).length / dcTransfers.length) * 100).toFixed(1) : '0.0'}%).`
    },
    {
      id: 'duplicate-serials',
      title: 'Site Stock Duplicate Serial Audit',
      status: duplicateReconciledRows.length > 0 ? 'warning' : 'pass',
      detail: duplicateReconciledRows.length > 0
        ? `${duplicateSerialSet.size} duplicate serial(s) (${duplicateReconciledRows.length} rows) detected in Site Stock — investigate duplicate scan-in or Fixably sync.`
        : 'Zero duplicate non-exempt serials in Reconciled Site Stock.'
    },
    {
      id: 'sdr-join-coverage',
      title: 'DC Used Serial -> SDR Order Linkage',
      status: usedSerialsMissingSdr.length > 0 ? 'warning' : 'pass',
      detail: `${dcUsedWithRepTat.length.toLocaleString()} / ${dcUsedTotalWithOrder.toLocaleString()} used DC orders linked to SDR timeline (${usedSerialsMissingSdr.length} orders missing from uploaded SDR export — e.g. still open or outside export date window).`
    },
    {
      id: 'warranty-masking',
      title: 'Fixably Masked Warranty Records (****)',
      status: redactedWarrantyCount > 0 ? 'warning' : 'pass',
      detail: `${redactedWarrantyCount.toLocaleString()} DC Masterlist records contain redacted asterisk warranties (categorized under Others — matches Google Sheets parity).`
    },
    {
      id: 'non-serial-repairs',
      title: 'Non-Serial & Improper KGB Reporting',
      status: nonSerialRepairs.length > 0 ? 'warning' : 'pass',
      detail: `${nonSerialRepairs.length.toLocaleString()} iPhone KGB Used line(s) lack a Product KGB serial (${nonSerialRepairs.filter(r => r.inferredKgb).length} auto-matched to Masterlist KGB for rapid resolution).`
    },
    {
      id: 'negative-tat-dates',
      title: 'SDR Closed < Received Date Anomaly',
      status: (allOrders2026Stats.negativeTatAnomalies + sdr2025Stats.negativeTatAnomalies) > 0 ? 'warning' : 'pass',
      detail: `${allOrders2026Stats.negativeTatAnomalies} current + ${sdr2025Stats.negativeTatAnomalies} baseline orders have Closed date earlier than Received date (clamped to 0 / SDR).`
    }
  ];

  // Order branches canonically for downstream charts/tables
  const branchOrderIndex = (siteName) => {
    const norm = normalizeSite(siteName);
    const idx = EXCEL_BRANCH_ORDER.indexOf(norm.code);
    return idx === -1 ? 999 : idx;
  };

  return {
    generatedAt: new Date().toISOString(),
    referenceDate,
    inventoryYearFilter,
    kpis: {
      siteStockRawCount: siteStockRows.length,
      reconciledCount: reconciledInventory.length,
      dcTransferSerialCount: dcTransfers.length,
      dcTransferRawCount: dcRawTransfers.length,
      dcUsedCount: dcUsedSerials.filter(r => r.orderId).length,
      dcUnusedOnHandCount: unusedDcItems.length,
      totalDcSalesPhp,
      salesOrderCount: salesRows.length,
      avgOrderValuePhp: salesRows.length > 0 ? totalDcSalesPhp / salesRows.length : 0,
      totalShippingCostPhp: totalShippingCost,
      shippingCostPctOfSales: totalDcSalesPhp > 0 ? (totalShippingCost / totalDcSalesPhp) * 100 : 0,
      costPerDcTransferPhp: dcRawTransfers.length > 0 ? totalShippingCost / dcRawTransfers.length : 0,
      dcSdrCount: dcSdrRows.length,
      dcRepTatMatchedCount: dcUsedWithRepTat.length,
      dcSdrRatePct: dcSdrRate * 100,
      baseline2025SdrCount: sdr2025Stats.sdrCount,
      baseline2025Total: sdr2025Stats.totalCompleted,
      baseline2025SdrRatePct: sdr2025Stats.sdrRate * 100,
      sdrRateLiftPctPoints: (dcSdrRate - sdr2025Stats.sdrRate) * 100,
      all2026SdrCount: allOrders2026Stats.sdrCount,
      all2026TotalCompleted: allOrders2026Stats.totalCompleted,
      all2026SdrRatePct: allOrders2026Stats.sdrRate * 100,
      all2026AvgTatDays: allOrders2026Stats.avgTatDays,
      doaAllCount: doaAllRows.length,
      doaDcCount: doaDcStockRows.length,
      gprCount: gprRows.length,
      undispatchedCinCount: undispatchedCinDc.length,
      unusedS2SCount: unusedS2SSerials.length,
      nonSerialRepairCount: nonSerialRepairs.length,
      duplicateSerialRowCount: duplicateReconciledRows.length
    },
    siteStocks: {
      iphoneKgbUsed,
      inventoryFiltered,
      dcTransfers,
      reconciledInventory,
      duplicateReconciledRows,
      undispatched2026,
      agingSummary
    },
    transferAnalytics: {
      totalTransferValue,
      monthlyTransferVolume,
      transferDestinationBreakdown,
      topTransferredProducts,
      topBatteries,
      topDisplays,
      shippingCosts: normalizedShipping,
      totalShippingCost
    },
    dcUsedSerials,
    sdrAndRepTat: {
      dcStock: {
        sdrCount: dcSdrRows.length,
        totalMatched: dcUsedWithRepTat.length,
        sdrRate: dcSdrRate,
        tatBreakdown: dcTatBreakdown,
        monthlySdr: dcMonthlySdr,
        warrantyBreakdown: dcSdrWarrantyBreakdown,
        warrantyMatchedTotal: dcSdrWarrantyMatchedTotal,
        topSites: dcSdrTopSites
      },
      baseline2025: sdr2025Stats,
      allOrders2026: allOrders2026Stats,
      repTatComparison: {
        tatComparison,
        combinedMonthlyTimeline,
        warrantyComparison,
        multiSiteShiftSummary: multiSiteShiftSummary.sort((a, b) =>
          (b.sdr2025 - a.sdr2025) || (branchOrderIndex(a.site) - branchOrderIndex(b.site))
        )
      }
    },
    salesDc: {
      totalSalesPhp: totalDcSalesPhp,
      rows: salesRows,
      bySite: salesBySite,
      byMonth: salesByMonth,
      topProducts: salesTopProducts
    },
    warrantyDc: {
      totalMatched: warrantyDcMatchedRows.length,
      redactedCount: redactedWarrantyCount,
      breakdown: warrantyDcBreakdown
    },
    exceptionsAndQueues: {
      doaAllRows,
      doaDcStockRows,
      gprRows,
      undispatchedCinDc,
      s2sTransfers,
      unusedS2SSerials,
      nonSerialRepairs,
      usedSerialsMissingSdr
    },
    reconciliationChecks
  };
}
