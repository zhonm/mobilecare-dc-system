import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import canonicalShares from '../data/canonicalShares.js';
import { calculateLinearRegressionForecast, calculateRecommendedOrder } from './forecastEngine.js';
import {
  calculateOptionAAllocation,
  calculateOptionBAllocation,
  calculate2DCumulativeAllocation,
  calculateWeeklySplit,
  getOrderRemark
} from './allocationEngine.js';
import { sanitizeForSpreadsheet } from './security.js';
import { resolvePartInfo, validateAppleSerialNumber } from './partResolver.js';

export function isForecastingMatrixSheet(rows) {
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    const str = (rows[r] || []).join(' ').toLowerCase();
    if (
      (str.includes('january') || str.includes('jan')) &&
      (str.includes('february') || str.includes('feb')) &&
      (str.includes('march') || str.includes('mar')) &&
      (str.includes('part') || str.includes('battery') || str.includes('display'))
    ) {
      return true;
    }
  }
  return false;
}

export function isAllocationMatrixSheet(rows) {
  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const str = (rows[r] || []).join(' ').toUpperCase();
    const hasBranchCodes = str.includes('BHS') || str.includes('GB3') || str.includes('PPM') || str.includes('GL5') || str.includes('CEB') || str.includes('MEG') || str.includes('APP ') || str.includes('ASP ') || str.includes('BONIFACIO') || str.includes('GREENBELT');
    const hasMatrixHeaders = str.includes('TOTAL') || str.includes('ALLOCATION') || str.includes('COMMODITY') || str.includes('FORECAST') || str.includes('P/N') || str.includes('PART NUMBER') || str.includes('PART DESCRIPTION');
    if (hasBranchCodes && hasMatrixHeaders) {
      return true;
    }
  }
  return false;
}

export function isRawUsageFile(sampleRows, fileName = '', sheetName = '') {
  if (/fixably|gsx|repairs|raw/i.test(fileName) || /repairs|raw/i.test(sheetName)) {
    return true;
  }
  for (let r = 0; r < Math.min(10, sampleRows.length); r++) {
    const rowStr = (sampleRows[r] || []).join(' ').toLowerCase();
    if (
      (rowStr.includes('repair') || rowStr.includes('case') || rowStr.includes('order')) &&
      (rowStr.includes('part') || rowStr.includes('description') || rowStr.includes('p/n')) &&
      (rowStr.includes('site') || rowStr.includes('branch') || rowStr.includes('location') || rowStr.includes('store') || rowStr.includes('asp'))
    ) {
      return true;
    }
  }
  return false;
}

export const CANONICAL_SITE_LIST = [
  { code: 'APP BHS', name: 'MOBILECARE - APP BONIFACIO HIGH STREET' },
  { code: 'APP GB3', name: 'MOBILECARE - APP GREENBELT 3' },
  { code: 'APP PPM', name: 'MOBILECARE - APP POWER PLANT MALL' },
  { code: 'ASP GL5', name: 'MOBILECARE - GLORIETTA 5' },
  { code: 'ASP SMS', name: "MOBILECARE - S'MAISON" },
  { code: 'APP MOA', name: 'MOBILECARE - APP MALL OF ASIA' },
  { code: 'ASP POD', name: 'MOBILECARE - THE PODIUM' },
  { code: 'APP MEG', name: 'MOBILECARE - APP MEGAMALL' },
  { code: 'APP ANX', name: 'MOBILECARE - APP THE ANNEX' },
  { code: 'APP TRI', name: 'MOBILECARE - APP TRINOMA' },
  { code: 'ASP VN', name: 'MOBILECARE - VERTIS NORTH' },
  { code: 'ASP NES', name: 'MOBILECARE - NORTHEAST SQUARE' },
  { code: 'APP FES', name: 'MOBILECARE - APP FESTIVAL MALL' },
  { code: 'ASP MRK', name: 'MOBILECARE - SM MARIKINA' },
  { code: 'APP RM', name: 'MOBILECARE - APP MAGNOLIA' },
  { code: 'ASP LIM', name: 'MOBILECARE - LIMA ESTATE' },
  { code: 'ASP NPM', name: 'MOBILECARE - NEWPOINT MALL' },
  { code: 'ASP NAG', name: 'MOBILECARE - NAGA' },
  { code: 'ASP LAU', name: 'MOBILECARE - LA UNION' },
  { code: 'ASP ILO', name: 'MOBILECARE - FESTIVE WALK ILOILO' },
  { code: 'APP ILO', name: 'MOBILECARE - APP SM ILOILO' },
  { code: 'ASP CEB', name: 'MOBILECARE - CEBU' },
  { code: 'ASP ZAM', name: 'MOBILECARE - ZAMBOANGA' },
  { code: 'ASP ABR', name: 'MOBILECARE - DAVAO' },
  { code: 'ASP COT', name: 'MOBILECARE SERVICES' },
  { code: 'ASP CDO', name: 'MOBILECARE - CAGAYAN DE ORO' },
  { code: 'APP LAN', name: 'MOBILECARE - APP SM LANANG' }
];

export const MASTER_PART_PRICING = {
  // Displays
  '661-21988': { stocking: 279, exchange: 234, desc: 'Display, iPhone 13', category: 'cat-display' },
  '661-21993': { stocking: 279, exchange: 234, desc: 'Display, iPhone 13 Pro', category: 'cat-display' },
  '661-22309': { stocking: 329, exchange: 276, desc: 'Display, iPhone 13 Pro Max', category: 'cat-display' },
  '661-30366': { stocking: 279, exchange: 234, desc: 'Display, iPhone 14', category: 'cat-display' },
  '661-30390': { stocking: 329, exchange: 276, desc: 'Display, iPhone 14 Plus', category: 'cat-display' },
  '661-29370': { stocking: 329, exchange: 276, desc: 'Display, iPhone 14 Pro', category: 'cat-display' },
  '661-30401': { stocking: 379, exchange: 318, desc: 'Display, iPhone 14 Pro Max', category: 'cat-display' },
  '661-36706': { stocking: 279, exchange: 234, desc: 'Display, iPhone 15', category: 'cat-display' },
  '661-37213': { stocking: 329, exchange: 276, desc: 'Display, iPhone 15 Plus', category: 'cat-display' },
  '661-35699': { stocking: 329, exchange: 276, desc: 'Display, iPhone 15 Pro', category: 'cat-display' },
  '661-36915': { stocking: 379, exchange: 318, desc: 'Display, iPhone 15 Pro Max', category: 'cat-display' },
  '661-44797': { stocking: 279, exchange: 246, desc: 'Display, iPhone 16', category: 'cat-display' },
  '661-42843': { stocking: 329, exchange: 290, desc: 'Display, iPhone 16 Plus', category: 'cat-display' },
  '661-42726': { stocking: 329, exchange: 290, desc: 'Display, iPhone 16 Pro', category: 'cat-display' },
  '661-44955': { stocking: 379, exchange: 334, desc: 'Display, iPhone 16 Pro Max', category: 'cat-display' },
  '661-49431': { stocking: 229, exchange: 202, desc: 'Display, iPhone 16e', category: 'cat-display' },
  '661-56065': { stocking: 329, exchange: 313, desc: 'Display, iPhone 17', category: 'cat-display' },
  '661-56125': { stocking: 329, exchange: 313, desc: 'Display, iPhone 17 Pro', category: 'cat-display' },
  '661-56050': { stocking: 379, exchange: 360, desc: 'Display, iPhone 17 Pro Max', category: 'cat-display' },
  '661-60211': { stocking: 229, exchange: 218, desc: 'Display, iPhone 17e', category: 'cat-display' },
  '661-55240': { stocking: 329, exchange: 313, desc: 'Display, iPhone Air', category: 'cat-display' },

  // Batteries
  '661-21991': { stocking: 89, exchange: 46, desc: 'Battery, iPhone 13', category: 'cat-battery' },
  '661-21996': { stocking: 89, exchange: 46, desc: 'Battery, iPhone 13 Pro', category: 'cat-battery' },
  '661-22294': { stocking: 89, exchange: 46, desc: 'Battery, iPhone 13 Pro Max', category: 'cat-battery' },
  '661-30373': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 14', category: 'cat-battery' },
  '661-30394': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 14 Plus', category: 'cat-battery' },
  '661-30382': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 14 Pro', category: 'cat-battery' },
  '661-30397': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 14 Pro Max', category: 'cat-battery' },
  '661-35885': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 15', category: 'cat-battery' },
  '661-37207': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 15 Plus', category: 'cat-battery' },
  '661-35694': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 15 Pro', category: 'cat-battery' },
  '661-36918': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 15 Pro Max', category: 'cat-battery' },
  '661-44796': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 16', category: 'cat-battery' },
  '661-42837': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 16 Plus', category: 'cat-battery' },
  '661-42720': { stocking: 119, exchange: 62, desc: 'Battery, iPhone 16 Pro', category: 'cat-battery' },
  '661-44954': { stocking: 119, exchange: 62, desc: 'Battery, iPhone 16 Pro Max', category: 'cat-battery' },
  '661-56064': { stocking: 99, exchange: 51, desc: 'Battery, iPhone 17', category: 'cat-battery' },
  '661-55235': { stocking: 119, exchange: 62, desc: 'Battery, iPhone Air', category: 'cat-battery' },
  '661-58121': { stocking: 119, exchange: 62, desc: 'Battery, pSIM, iPhone 17 Pro', category: 'cat-battery' },
  '661-56049': { stocking: 119, exchange: 62, desc: 'Battery, pSIM, iPhone 17 Pro Max', category: 'cat-battery' }
};

export const CANONICAL_DISPLAY_DESCS = [
  'Display, iPhone 13',
  'Display, iPhone 13 Pro',
  'Display, iPhone 13 Pro Max',
  'Display, iPhone 14',
  'Display, iPhone 14 Plus',
  'Display, iPhone 14 Pro',
  'Display, iPhone 14 Pro Max',
  'Display, iPhone 15',
  'Display, iPhone 15 Plus',
  'Display, iPhone 15 Pro',
  'Display, iPhone 15 Pro Max',
  'Display, iPhone 16',
  'Display, iPhone 16 Plus',
  'Display, iPhone 16 Pro',
  'Display, iPhone 16 Pro Max',
  'Display, iPhone 16e',
  'Display, iPhone 17',
  'Display, iPhone 17 Pro',
  'Display, iPhone 17 Pro Max',
  'Display, iPhone 17e',
  'Display, iPhone Air'
];

export const CANONICAL_BATTERY_DESCS = [
  'Battery, iPhone 13',
  'Battery, iPhone 13 Pro',
  'Battery, iPhone 13 Pro Max',
  'Battery, iPhone 14',
  'Battery, iPhone 14 Plus',
  'Battery, iPhone 14 Pro',
  'Battery, iPhone 14 Pro Max',
  'Battery, iPhone 15',
  'Battery, iPhone 15 Plus',
  'Battery, iPhone 15 Pro',
  'Battery, iPhone 15 Pro Max',
  'Battery, iPhone 16',
  'Battery, iPhone 16 Plus',
  'Battery, iPhone 16 Pro',
  'Battery, iPhone 16 Pro Max',
  'Battery, iPhone 17',
  'Battery, iPhone Air',
  'Battery, pSIM, iPhone 17 Pro',
  'Battery, pSIM, iPhone 17 Pro Max',
  'SVC,IPHONE 14 PRO MAX, BATTERY'
];

export const CANONICAL_BATTERY_SHARE_DESCS = [
  'Battery, iPhone 13',
  'Battery, iPhone 13 Pro',
  'Battery, iPhone 13 Pro Max',
  'Battery, iPhone 14',
  'Battery, iPhone 14 Plus',
  'Battery, iPhone 14 Pro',
  'Battery, iPhone 14 Pro Max',
  'Battery, iPhone 15',
  'Battery, iPhone 15 Plus',
  'Battery, iPhone 15 Pro',
  'Battery, iPhone 15 Pro Max',
  'Battery, iPhone 16',
  'Battery, iPhone 16 Pro',
  'Battery, iPhone 16 Pro Max',
  'Battery, iPhone 17',
  'Battery, iPhone Air',
  'Battery, pSIM, iPhone 17 Pro',
  'Battery, pSIM, iPhone 17 Pro Max'
];

export const CANONICAL_SEPTEMBER_2026_FORECASTS = {
  // Displays (21 Models -> Total: 149 units, $50,300.00)
  'Display, iPhone 13': 23,
  'Display, iPhone 13 Pro': 2,
  'Display, iPhone 13 Pro Max': 0,
  'Display, iPhone 14': 5,
  'Display, iPhone 14 Plus': 0,
  'Display, iPhone 14 Pro': 0,
  'Display, iPhone 14 Pro Max': 7,
  'Display, iPhone 15': 7,
  'Display, iPhone 15 Plus': 0,
  'Display, iPhone 15 Pro': 2,
  'Display, iPhone 15 Pro Max': 5,
  'Display, iPhone 16': 6,
  'Display, iPhone 16 Plus': 1,
  'Display, iPhone 16 Pro': 6,
  'Display, iPhone 16 Pro Max': 4,
  'Display, iPhone 16e': 2,
  'Display, iPhone 17': 14,
  'Display, iPhone 17 Pro': 18,
  'Display, iPhone 17 Pro Max': 45,
  'Display, iPhone 17e': 0,
  'Display, iPhone Air': 2,

  // Batteries (20 Models -> Total: 438 units, $40,899.00)
  'Battery, iPhone 13': 234,
  'Battery, iPhone 13 Pro': 24,
  'Battery, iPhone 13 Pro Max': 31,
  'Battery, iPhone 14': 9,
  'Battery, iPhone 14 Plus': 3,
  'Battery, iPhone 14 Pro': 25,
  'Battery, iPhone 14 Pro Max': 35,
  'Battery, iPhone 15': 15,
  'Battery, iPhone 15 Plus': 3,
  'Battery, iPhone 15 Pro': 25,
  'Battery, iPhone 15 Pro Max': 21,
  'Battery, iPhone 16': 1,
  'Battery, iPhone 16 Plus': 1,
  'Battery, iPhone 16 Pro': 0,
  'Battery, iPhone 16 Pro Max': 2,
  'Battery, iPhone 17': 6,
  'Battery, iPhone Air': 1,
  'Battery, pSIM, iPhone 17 Pro': 0,
  'Battery, pSIM, iPhone 17 Pro Max': 1,
  'SVC,IPHONE 14 PRO MAX, BATTERY': 1
};

export const CANONICAL_AUGUST_2026_FORECASTS = {
  // Displays (21 Models -> Total: 122 units, $41,238.00)
  'Display, iPhone 13': 16,
  'Display, iPhone 13 Pro': 2,
  'Display, iPhone 13 Pro Max': 0,
  'Display, iPhone 14': 1,
  'Display, iPhone 14 Plus': 0,
  'Display, iPhone 14 Pro': 3,
  'Display, iPhone 14 Pro Max': 7,
  'Display, iPhone 15': 7,
  'Display, iPhone 15 Plus': 0,
  'Display, iPhone 15 Pro': 2,
  'Display, iPhone 15 Pro Max': 6,
  'Display, iPhone 16': 4,
  'Display, iPhone 16 Plus': 1,
  'Display, iPhone 16 Pro': 10,
  'Display, iPhone 16 Pro Max': 7,
  'Display, iPhone 16e': 1,
  'Display, iPhone 17': 7,
  'Display, iPhone 17 Pro': 11,
  'Display, iPhone 17 Pro Max': 34,
  'Display, iPhone 17e': 0,
  'Display, iPhone Air': 3,

  // Batteries (18 Models -> Total: 339 units, $31,421.00)
  'Battery, iPhone 13': 175,
  'Battery, iPhone 13 Pro': 24,
  'Battery, iPhone 13 Pro Max': 23,
  'Battery, iPhone 14': 10,
  'Battery, iPhone 14 Plus': 0,
  'Battery, iPhone 14 Pro': 21,
  'Battery, iPhone 14 Pro Max': 30,
  'Battery, iPhone 15': 11,
  'Battery, iPhone 15 Plus': 2,
  'Battery, iPhone 15 Pro': 20,
  'Battery, iPhone 15 Pro Max': 14,
  'Battery, iPhone 16': 0,
  'Battery, iPhone 16 Pro': 0,
  'Battery, iPhone 16 Pro Max': 1,
  'Battery, iPhone 17': 5,
  'Battery, iPhone Air': 1,
  'Battery, pSIM, iPhone 17 Pro': 0,
  'Battery, pSIM, iPhone 17 Pro Max': 2
};

export function lookupPartPrice(pn, desc = '', existingParts = []) {
  const cleanPn = String(pn || '').trim().toUpperCase();
  const cleanDesc = String(desc || '').trim();

  // 1. Direct PN lookup in MASTER_PART_PRICING
  if (MASTER_PART_PRICING[cleanPn]) {
    return {
      stockingPrice: MASTER_PART_PRICING[cleanPn].stocking,
      exchangePrice: MASTER_PART_PRICING[cleanPn].exchange
    };
  }

  // 2. Lookup in existingParts catalog
  const foundPart = (existingParts || []).find(p => p.part_number === cleanPn || (cleanDesc && p.description === cleanDesc));
  if (foundPart && foundPart.stocking_price) {
    return {
      stockingPrice: parseFloat(foundPart.stocking_price) || 0,
      exchangePrice: parseFloat(foundPart.exchange_price) || 0
    };
  }

  // 3. Description search in MASTER_PART_PRICING
  for (const info of Object.values(MASTER_PART_PRICING)) {
    if (cleanDesc && info.desc.toLowerCase() === cleanDesc.toLowerCase()) {
      return {
        stockingPrice: info.stocking,
        exchangePrice: info.exchange
      };
    }
  }

  // 4. Default fallback by category
  const isDisplay = cleanDesc.toLowerCase().includes('display') || cleanDesc.toLowerCase().includes('screen');
  return {
    stockingPrice: isDisplay ? 279 : 99,
    exchangePrice: isDisplay ? 234 : 51
  };
}

export const EXCLUDED_BATTERY_DISPLAY_DESCS = new Set([
  // Battery Exclusions (13 models)
  'battery, iphone 11',
  'battery, iphone 8',
  'battery, iphone 11 pro',
  'battery, iphone 11 pro max',
  'battery, iphone 12 and 12 pro',
  'battery, iphone 12 mini',
  'battery, iphone 12 pro max',
  'battery, iphone 13 mini',
  'battery, iphone 8 plus',
  'battery, iphone se 2nd gen',
  'battery, iphone se 3rd generation',
  'battery, iphone x',
  'battery, iphone xr',
  // Display Exclusions (7 models)
  'display, iphone 11',
  'display, iphone 12',
  'display, iphone 12 mini',
  'display, iphone 12 pro',
  'display, iphone 12 pro max',
  'display, iphone 13 mini',
  'display, iphone xr'
].map(s => s.toLowerCase().trim()));

export const LEGACY_EXCLUDE_REGEX = /^((Battery, iPhone (11|8|11 Pro|11 Pro Max|12 and 12 Pro|12 mini|12 Pro Max|13 mini|8 Plus|SE 2nd gen|SE 3rd generation|X|XR))|(Display, iPhone (11|12|12 mini|12 Pro|12 Pro Max|13 mini|XR)))$/i;

/**
 * Single source of truth predicate for in-scope genuine iPhone Battery & Display repair universe.
 * Exact Step 2 Rules:
 *   a. part_description ILIKE '%iphone%'
 *   b. part_description ILIKE '%battery%' OR part_description ILIKE '%display%'
 *   c. TRIM(part_description) does NOT case-insensitively equal any of the 20 legacy exclusions
 */
export function isTargetIPhonePart(desc, _pn = '', filterScope = 'IPHONE_13_PLUS_BATTERY_DISPLAY') {
  if (filterScope === 'ALL_PARTS') return true;

  const d = String(desc || '').trim();
  const dLower = d.toLowerCase();

  // Rule a: Must contain 'iphone'
  if (!dLower.includes('iphone')) {
    return false;
  }

  // Rule b: Must be Battery or Display
  const isBattery = dLower.includes('battery');
  const isDisplay = dLower.includes('display');
  if (!isBattery && !isDisplay) {
    return false;
  }

  // Rule c: Must not match any of the 20 excluded models
  if (EXCLUDED_BATTERY_DISPLAY_DESCS.has(dLower)) {
    return false;
  }

  return true;
}

export async function parseUniversalExcel(file, currentSites = [], currentParts = [], options = {}) {
  const filterScope = options.filterScope || 'IPHONE_13_PLUS_BATTERY_DISPLAY';
  const selectedMonth = options.selectedMonth !== undefined ? options.selectedMonth : 'auto';

  return new Promise((resolve) => {
    const reader = new FileReader();
    const isCsv = file.name.toLowerCase().endsWith('.csv');

    reader.onload = (e) => {
      try {
        let wb;
        if (isCsv) {
          const text = new TextDecoder('utf-8').decode(e.target.result);
          wb = XLSX.read(text, { type: 'string' });
        } else {
          const data = new Uint8Array(e.target.result);
          wb = XLSX.read(data, { type: 'array' });
        }

        const sheetNames = wb.SheetNames || [];
        const ALL_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        let detectedMonthIdx = 8; // Default to September (Month index 8, 9th month)

        if (selectedMonth !== 'auto' && selectedMonth !== undefined && selectedMonth !== '') {
          const parsedM = parseInt(selectedMonth, 10);
          detectedMonthIdx = Math.max(0, Math.min(11, isNaN(parsedM) ? 8 : parsedM));
        } else {
          const nameToSearch = `${file.name} ${sheetNames.join(' ')}`.toLowerCase();
          const fIdx = ALL_MONTH_NAMES.findIndex(m => nameToSearch.includes(m.toLowerCase()));
          if (fIdx >= 0) {
            detectedMonthIdx = fIdx;
          }
        }

        const detectedPeriod = {
          month: detectedMonthIdx + 1,
          year: 2026,
          label: `${ALL_MONTH_NAMES[detectedMonthIdx]} 2026`
        };

        // Check for Multi-Tab Comprehensive Workbook (.xlsx)
        const rawSheetName = !isCsv ? sheetNames.find(s =>
          (/master.*list|iphones|iphone|repairs|raw/i.test(s))
        ) : null;

        const allocSheetName = !isCsv ? sheetNames.find(s =>
          (/master.*alloc|allocation|_alloc/i.test(s) || /july.*alloc|august.*alloc|september.*alloc/i.test(s)) && !/forecasting|forecast/i.test(s)
        ) : null;

        const forecastSheetName = !isCsv ? sheetNames.find(s =>
          /forecasting|forecast/i.test(s) && !/allocation|_alloc/i.test(s)
        ) : null;

        // A. Primary / Authoritative: Raw Masterlist Ingestion Pipeline
        if (rawSheetName) {
          const wsRaw = wb.Sheets[rawSheetName];
          const rawMasterRows = XLSX.utils.sheet_to_json(wsRaw, { header: 1, defval: '' });
          const usageResult = processRawUsageSheet(rawMasterRows, currentSites, currentParts, {
            filterScope,
            selectedMonth,
            fileName: file.name,
            allocationMode: options.allocationMode || 'OPTION_A'
          });

          resolve({
            success: true,
            type: 'RAW_USAGE_PIPELINE',
            sheetName: rawSheetName,
            detectedPeriod: usageResult.detectedPeriod || detectedPeriod,
            summary: {
              recordsCount: usageResult.records.length,
              partsCount: usageResult.forecastItems.length,
              sitesCount: usageResult.sites.length,
              totalForecastedUnits: usageResult.forecastItems.reduce((acc, f) => acc + (f.final_forecast || f.computed_forecast || 0), 0),
              totalAllocatedUnits: usageResult.allocations.reduce((acc, a) => acc + (a.total_allocated_qty || 0), 0),
              totalValuation: usageResult.allocations.reduce((acc, a) => acc + (a.total_stock_cost || 0), 0),
              description: `Ingested ${usageResult.records.length} in-scope repair logs from "${rawSheetName}", dynamically recomputed ${usageResult.forecastItems.length} demand forecasts and allocations across ${usageResult.sites.length} branches.`
            },
            payload: usageResult
          });
          return;
        }

        // B. Multi-Tab Workbook with Pre-Aggregated Allocation Sheet (fallback if no Masterlist tab)
        if (allocSheetName) {
          const wsAlloc = wb.Sheets[allocSheetName];
          const rawAllocRows = XLSX.utils.sheet_to_json(wsAlloc, { header: 1, defval: '' });
          const parsedAlloc = parseAllocationSheet(rawAllocRows, currentSites, filterScope);

          let parsedForecast = { forecastItems: [], parts: [] };
          if (forecastSheetName) {
            const wsForecast = wb.Sheets[forecastSheetName];
            const rawForecastRows = XLSX.utils.sheet_to_json(wsForecast, { header: 1, defval: '' });
            parsedForecast = parseForecastingSheet(rawForecastRows, filterScope);
            if (parsedAlloc.allocations.length > 0) {
              const fcastMap = new Map(parsedForecast.forecastItems.map(f => [f.part_number, f]));
              parsedForecast.forecastItems = parsedAlloc.allocations.map(a => {
                const f = fcastMap.get(a.part_number);
                const targetUnits = a.forecasted_qty || a.total_allocated_qty;
                return {
                  part_id: a.part_id,
                  part_number: a.part_number,
                  description: a.description,
                  category_id: a.category_id,
                  ytd_monthly_counts: f?.ytd_monthly_counts || [],
                  computed_forecast: targetUnits,
                  admin_override: null,
                  final_forecast: targetUnits,
                  safety_stock_units: Math.ceil(targetUnits * 0.05),
                  recommended_order: targetUnits + Math.ceil(targetUnits * 0.05)
                };
              });
            }
          } else {
            // Build fallback forecast items from allocation data
            parsedForecast.forecastItems = parsedAlloc.allocations.map(a => ({
              part_id: a.part_id,
              part_number: a.part_number,
              description: a.description,
              category_id: a.category_id,
              computed_forecast: a.forecasted_qty || a.total_allocated_qty,
              final_forecast: a.forecasted_qty || a.total_allocated_qty,
              safety_stock_units: Math.ceil((a.forecasted_qty || a.total_allocated_qty) * 0.05),
              recommended_order: (a.forecasted_qty || a.total_allocated_qty) + Math.ceil((a.forecasted_qty || a.total_allocated_qty) * 0.05),
              ytd_monthly_counts: []
            }));
          }

          resolve({
            success: true,
            type: 'WORKBOOK_BUNDLE',
            sheetName: forecastSheetName ? `${forecastSheetName} + ${allocSheetName}` : allocSheetName,
            detectedPeriod,
            summary: {
              forecastPartsCount: parsedForecast.forecastItems.length,
              allocPartsCount: parsedAlloc.allocations.length,
              sitesCount: parsedAlloc.sites.length,
              totalForecastedUnits: parsedAlloc.allocations.reduce((acc, a) => acc + (a.total_allocated_qty || 0), 0),
              description: `Extracted complete operational system data: ${parsedForecast.forecastItems.length} demand forecasts and ${parsedAlloc.allocations.length} master allocations across ${parsedAlloc.sites.length} service sites from "${allocSheetName}".`
            },
            payload: {
              forecastItems: parsedForecast.forecastItems,
              allocations: parsedAlloc.allocations,
              sites: parsedAlloc.sites,
              parts: parsedAlloc.parts.length > 0 ? parsedAlloc.parts : parsedForecast.parts
            }
          });
          return;
        }

        // B. Multi-Tab Forecasting Workbook (Demand Forecast Matrix + Raw Usage / Masterlist)
        if (forecastSheetName) {
          const wsForecast = wb.Sheets[forecastSheetName];
          const rawForecastRows = XLSX.utils.sheet_to_json(wsForecast, { header: 1, defval: '' });
          const parsedForecast = parseForecastingSheet(rawForecastRows, filterScope);

          // Extract branch site distribution from raw repair logs sheet if available
          const siteCountsPerDesc = new Map();
          if (rawSheetName) {
            const wsRaw = wb.Sheets[rawSheetName];
            const rawRows = XLSX.utils.sheet_to_json(wsRaw, { header: 1, defval: '' });
            let hIdx = 0;
            for (let i = 0; i < Math.min(6, rawRows.length); i++) {
              const s = (rawRows[i] || []).join(' ').toLowerCase();
              if (s.includes('location') || s.includes('site') || s.includes('product code') || s.includes('part') || s.includes('description')) {
                hIdx = i; break;
              }
            }
            const headers = (rawRows[hIdx] || []).map(h => String(h).toLowerCase());
            const siteCol = headers.findIndex(h => /location|site|branch/i.test(h));
            const descCol = headers.findIndex(h => /description|desc|product\s*name/i.test(h));
            const pnCol = headers.findIndex(h => /product\s*code|part\s*number|p\/n|code/i.test(h));

            for (let r = hIdx + 1; r < rawRows.length; r++) {
              const row = rawRows[r];
              if (!row) continue;
              const rawDesc = descCol >= 0 ? String(row[descCol] || '').trim() : '';
              const rawPn = pnCol >= 0 ? String(row[pnCol] || '').trim() : '';
              const loc = siteCol >= 0 ? String(row[siteCol] || '').trim() : '';
              if (!loc || (!rawDesc && !rawPn)) continue;

              const matchedSite = CANONICAL_SITE_LIST.find(s =>
                loc.toUpperCase().includes(s.code.toUpperCase()) ||
                loc.toUpperCase().includes(s.name.toUpperCase()) ||
                s.name.toUpperCase().includes(loc.toUpperCase())
              );
              if (!matchedSite) continue;

              const matchedDesc = CANONICAL_DISPLAY_DESCS.find(d => d === rawDesc || (rawPn && MASTER_PART_PRICING[rawPn.toUpperCase()]?.desc === d))
                || CANONICAL_BATTERY_SHARE_DESCS.find(d => d === rawDesc || (rawPn && MASTER_PART_PRICING[rawPn.toUpperCase()]?.desc === d));

              if (matchedDesc) {
                if (!siteCountsPerDesc.has(matchedDesc)) siteCountsPerDesc.set(matchedDesc, {});
                const sCounts = siteCountsPerDesc.get(matchedDesc);
                sCounts[matchedSite.name] = (sCounts[matchedSite.name] || 0) + 1;
              }
            }
          }

          // Generate 2D Cumulative Box Quota allocations matching Google Sheet Master Allocation
          const activeServiceSites = CANONICAL_SITE_LIST.map((cs) => {
            const existing = (currentSites || []).find(s => s.code === cs.code || cs.name.includes(s.name) || s.name.includes(cs.name));
            return existing || {
              id: `site-${cs.code.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
              code: cs.code,
              name: cs.name,
              region: /cebu|davao|iloilo|naga|la union|zamboanga|cagayan|lanang|lima|newpoint/i.test(cs.name) ? 'Provincial' : 'Metro Manila',
              address: `${cs.name} Service Branch, Philippines`,
              is_dc: false,
              is_active: true
            };
          });

          function buildCatShares(descList) {
            return descList.map(desc => {
              let totalCount = 0;
              const countsPerSite = activeServiceSites.map(s => {
                const sCounts = siteCountsPerDesc.get(desc) || {};
                const count = sCounts[s.name] || 0;
                totalCount += count;
                return count;
              });
              return countsPerSite.map(count => totalCount > 0 ? (count / totalCount) : (1 / activeServiceSites.length));
            });
          }

          const dispShares = siteCountsPerDesc.size > 0 ? buildCatShares(CANONICAL_DISPLAY_DESCS) : (canonicalShares?.displayShares || CANONICAL_DISPLAY_DESCS.map(() => activeServiceSites.map(() => 1 / activeServiceSites.length)));
          const battShares = siteCountsPerDesc.size > 0 ? buildCatShares(CANONICAL_BATTERY_SHARE_DESCS) : (canonicalShares?.batteryShares || CANONICAL_BATTERY_SHARE_DESCS.map(() => activeServiceSites.map(() => 1 / activeServiceSites.length)));

          const generatedAllocations = [];
          let curRow = 3;

          // Displays
          CANONICAL_DISPLAY_DESCS.forEach((desc, mIdx) => {
            const f = parsedForecast.forecastItems.find(item => item.description === desc) || {
              part_id: `part-${desc}`,
              part_number: Object.entries(MASTER_PART_PRICING).find(([, v]) => v.desc === desc)?.[0] || `PART-${desc}`,
              description: desc,
              category_id: 'cat-display',
              computed_forecast: 0,
              final_forecast: 0
            };
            const targetQty = f.final_forecast || f.computed_forecast || 0;
            const allocatedBranchQuantities = calculate2DCumulativeAllocation(targetQty, dispShares, mIdx);
            const siteQuantities = {};
            let totalAlloc = 0;
            activeServiceSites.forEach((s, sIdx) => {
              const q = allocatedBranchQuantities[sIdx] || 0;
              siteQuantities[s.id] = q;
              siteQuantities[s.code] = q;
              totalAlloc += q;
            });
            const pricing = lookupPartPrice(f.part_number, desc, currentParts);
            const totalCost = totalAlloc * pricing.stockingPrice;
            const split = calculateWeeklySplit(totalAlloc, totalCost, curRow);

            generatedAllocations.push({
              part_id: f.part_id,
              part_number: f.part_number,
              description: desc,
              category_id: 'cat-display',
              forecasted_qty: targetQty,
              stocking_price: pricing.stockingPrice,
              exchange_price: pricing.exchangePrice,
              total_allocated_qty: totalAlloc,
              total_stock_cost: totalCost,
              w1_qty: split.w1_qty,
              w2_qty: split.w2_qty,
              w3_qty: split.w3_qty,
              w4_qty: split.w4_qty,
              w1_cost: split.w1_cost,
              w2_cost: split.w2_cost,
              w3_cost: split.w3_cost,
              w4_cost: split.w4_cost,
              site_quantities: siteQuantities
            });
            curRow++;
          });

          curRow++; // Row parity for Batteries

          // Batteries
          CANONICAL_BATTERY_DESCS.forEach((desc, mIdx) => {
            const f = parsedForecast.forecastItems.find(item => item.description === desc) || {
              part_id: `part-${desc}`,
              part_number: Object.entries(MASTER_PART_PRICING).find(([, v]) => v.desc === desc)?.[0] || `PART-${desc}`,
              description: desc,
              category_id: 'cat-battery',
              computed_forecast: 0,
              final_forecast: 0
            };
            const targetQty = f.final_forecast || f.computed_forecast || 0;
            const allocatedBranchQuantities = calculate2DCumulativeAllocation(targetQty, battShares, mIdx);
            const siteQuantities = {};
            let totalAlloc = 0;
            activeServiceSites.forEach((s, sIdx) => {
              const q = allocatedBranchQuantities[sIdx] || 0;
              siteQuantities[s.id] = q;
              siteQuantities[s.code] = q;
              totalAlloc += q;
            });
            const pricing = lookupPartPrice(f.part_number, desc, currentParts);
            const totalCost = totalAlloc * pricing.stockingPrice;
            const split = calculateWeeklySplit(totalAlloc, totalCost, curRow);

            generatedAllocations.push({
              part_id: f.part_id,
              part_number: f.part_number,
              description: desc,
              category_id: 'cat-battery',
              forecasted_qty: targetQty,
              stocking_price: pricing.stockingPrice,
              exchange_price: pricing.exchangePrice,
              total_allocated_qty: totalAlloc,
              total_stock_cost: totalCost,
              w1_qty: split.w1_qty,
              w2_qty: split.w2_qty,
              w3_qty: split.w3_qty,
              w4_qty: split.w4_qty,
              w1_cost: split.w1_cost,
              w2_cost: split.w2_cost,
              w3_cost: split.w3_cost,
              w4_cost: split.w4_cost,
              site_quantities: siteQuantities
            });
            curRow++;
          });

          resolve({
            success: true,
            type: 'WORKBOOK_BUNDLE',
            sheetName: rawSheetName ? `${forecastSheetName} + ${rawSheetName}` : forecastSheetName,
            detectedPeriod,
            summary: {
              forecastPartsCount: parsedForecast.forecastItems.length,
              allocPartsCount: generatedAllocations.length,
              sitesCount: activeServiceSites.length,
              totalForecastedUnits: generatedAllocations.reduce((acc, a) => acc + (a.total_allocated_qty || 0), 0),
              description: `Extracted ${parsedForecast.forecastItems.length} demand forecasts from "${forecastSheetName}" and generated 2D Cumulative Box allocations across ${activeServiceSites.length} service sites.`
            },
            payload: {
              forecastItems: parsedForecast.forecastItems,
              allocations: generatedAllocations,
              sites: activeServiceSites,
              parts: parsedForecast.parts
            }
          });
          return;
        }

        // C. Single Sheet or CSV Inspection
        const firstWs = wb.Sheets[sheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(firstWs, { header: 1, defval: '' });

        // 1. Is it a Pre-Aggregated Allocation Matrix Sheet or Allocation CSV?
        if (isAllocationMatrixSheet(rawRows)) {
          const parsedAlloc = parseAllocationSheet(rawRows, currentSites, filterScope);
          const fallbackForecastItems = parsedAlloc.allocations.map(a => ({
            part_id: a.part_id,
            part_number: a.part_number,
            description: a.description,
            category_id: a.category_id,
            computed_forecast: a.forecasted_qty || a.total_allocated_qty,
            final_forecast: a.forecasted_qty || a.total_allocated_qty,
            safety_stock_units: Math.ceil((a.forecasted_qty || a.total_allocated_qty) * 0.05),
            recommended_order: (a.forecasted_qty || a.total_allocated_qty) + Math.ceil((a.forecasted_qty || a.total_allocated_qty) * 0.05),
            ytd_monthly_counts: []
          }));

          resolve({
            success: true,
            type: 'ALLOCATION',
            sheetName: sheetNames[0],
            detectedPeriod,
            summary: {
              partsCount: parsedAlloc.allocations.length,
              sitesCount: parsedAlloc.sites.length,
              totalForecastedUnits: parsedAlloc.allocations.reduce((acc, a) => acc + (a.total_allocated_qty || 0), 0),
              description: `Extracted ${parsedAlloc.allocations.length} allocated parts across ${parsedAlloc.sites.length} service sites from "${sheetNames[0]}".`
            },
            payload: {
              ...parsedAlloc,
              forecastItems: fallbackForecastItems
            }
          });
          return;
        }

        // 2. Is it a Pre-Aggregated Forecasting Sheet?
        if (isForecastingMatrixSheet(rawRows)) {
          const parsedForecast = parseForecastingSheet(rawRows, filterScope);
          const activeServiceSites = CANONICAL_SITE_LIST.map((cs) => {
            const existing = (currentSites || []).find(s => s.code === cs.code || cs.name.includes(s.name) || s.name.includes(cs.name));
            return existing || {
              id: `site-${cs.code.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
              code: cs.code,
              name: cs.name,
              region: /cebu|davao|iloilo|naga|la union|zamboanga|cagayan|lanang|lima|newpoint/i.test(cs.name) ? 'Provincial' : 'Metro Manila',
              address: `${cs.name} Service Branch, Philippines`,
              is_dc: false,
              is_active: true
            };
          });

          // Build canonical share baseline
          const uniformShares = activeServiceSites.map(() => 1 / activeServiceSites.length);
          const dispShareMatrix = canonicalShares?.displayShares || CANONICAL_DISPLAY_DESCS.map(() => uniformShares);
          const battShareMatrix = canonicalShares?.batteryShares || CANONICAL_BATTERY_SHARE_DESCS.map(() => uniformShares);

          const generatedAllocations = [];
          let curRow = 3;

          CANONICAL_DISPLAY_DESCS.forEach((desc, mIdx) => {
            const f = parsedForecast.forecastItems.find(item => item.description === desc) || {
              part_id: `part-${desc}`,
              part_number: Object.entries(MASTER_PART_PRICING).find(([, v]) => v.desc === desc)?.[0] || `PART-${desc}`,
              description: desc,
              category_id: 'cat-display',
              computed_forecast: 0,
              final_forecast: 0
            };
            const targetQty = f.final_forecast || f.computed_forecast || 0;
            const allocatedBranchQuantities = calculate2DCumulativeAllocation(targetQty, dispShareMatrix, mIdx);
            const siteQuantities = {};
            let totalAlloc = 0;
            activeServiceSites.forEach((s, sIdx) => {
              const q = allocatedBranchQuantities[sIdx] || 0;
              siteQuantities[s.id] = q;
              siteQuantities[s.code] = q;
              totalAlloc += q;
            });
            const pricing = lookupPartPrice(f.part_number, desc, currentParts);
            const totalCost = totalAlloc * pricing.stockingPrice;
            const split = calculateWeeklySplit(totalAlloc, totalCost, curRow);

            generatedAllocations.push({
              part_id: f.part_id,
              part_number: f.part_number,
              description: desc,
              category_id: 'cat-display',
              forecasted_qty: targetQty,
              stocking_price: pricing.stockingPrice,
              exchange_price: pricing.exchangePrice,
              total_allocated_qty: totalAlloc,
              total_stock_cost: totalCost,
              w1_qty: split.w1_qty,
              w2_qty: split.w2_qty,
              w3_qty: split.w3_qty,
              w4_qty: split.w4_qty,
              w1_cost: split.w1_cost,
              w2_cost: split.w2_cost,
              w3_cost: split.w3_cost,
              w4_cost: split.w4_cost,
              site_quantities: siteQuantities
            });
            curRow++;
          });

          curRow++;

          CANONICAL_BATTERY_DESCS.forEach((desc, mIdx) => {
            const f = parsedForecast.forecastItems.find(item => item.description === desc) || {
              part_id: `part-${desc}`,
              part_number: Object.entries(MASTER_PART_PRICING).find(([, v]) => v.desc === desc)?.[0] || `PART-${desc}`,
              description: desc,
              category_id: 'cat-battery',
              computed_forecast: 0,
              final_forecast: 0
            };
            const targetQty = f.final_forecast || f.computed_forecast || 0;
            const allocatedBranchQuantities = calculate2DCumulativeAllocation(targetQty, battShareMatrix, mIdx);
            const siteQuantities = {};
            let totalAlloc = 0;
            activeServiceSites.forEach((s, sIdx) => {
              const q = allocatedBranchQuantities[sIdx] || 0;
              siteQuantities[s.id] = q;
              siteQuantities[s.code] = q;
              totalAlloc += q;
            });
            const pricing = lookupPartPrice(f.part_number, desc, currentParts);
            const totalCost = totalAlloc * pricing.stockingPrice;
            const split = calculateWeeklySplit(totalAlloc, totalCost, curRow);

            generatedAllocations.push({
              part_id: f.part_id,
              part_number: f.part_number,
              description: desc,
              category_id: 'cat-battery',
              forecasted_qty: targetQty,
              stocking_price: pricing.stockingPrice,
              exchange_price: pricing.exchangePrice,
              total_allocated_qty: totalAlloc,
              total_stock_cost: totalCost,
              w1_qty: split.w1_qty,
              w2_qty: split.w2_qty,
              w3_qty: split.w3_qty,
              w4_qty: split.w4_qty,
              w1_cost: split.w1_cost,
              w2_cost: split.w2_cost,
              w3_cost: split.w3_cost,
              w4_cost: split.w4_cost,
              site_quantities: siteQuantities
            });
            curRow++;
          });

          resolve({
            success: true,
            type: 'FORECAST',
            sheetName: sheetNames[0],
            summary: {
              partsCount: parsedForecast.forecastItems.length,
              totalForecastedUnits: parsedForecast.forecastItems.reduce((acc, f) => acc + (f.final_forecast || f.computed_forecast || 0), 0),
              description: `Extracted demand matrix and linear forecasts for ${parsedForecast.forecastItems.length} genuine parts from "${sheetNames[0]}".`
            },
            payload: {
              ...parsedForecast,
              allocations: generatedAllocations
            }
          });
          return;
        }

        // 3. Default: Process as Raw Repair Logs
        const usageResult = processRawUsageSheet(rawRows, currentSites, currentParts, filterScope, selectedMonth, file.name);
        resolve({
          success: true,
          type: 'RAW_USAGE_PIPELINE',
          sheetName: sheetNames[0],
          detectedPeriod: usageResult.detectedPeriod || detectedPeriod,
          summary: {
            recordsCount: usageResult.records.length,
            partsCount: usageResult.forecastItems.length,
            sitesCount: usageResult.sites.length,
            totalForecastedUnits: usageResult.forecastItems.reduce((acc, f) => acc + (f.computed_forecast || 0), 0),
            description: `Extracted ${usageResult.records.length} in-scope repair logs for iPhone 13+ Battery & Display parts across ${usageResult.sites.length} branches.`
          },
          payload: usageResult
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    };

    reader.onerror = () => resolve({ success: false, error: 'Failed to read file buffer' });
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Sub-parser: Pre-Aggregated Forecasting Sheet (Matches Google Sheet Screenshot 3 & 4)
 * Handles both dual side-by-side Battery & Display tables and single table formats.
 */
export function parseForecastingSheet(rawRows, filterScope = 'IPHONE_13_PLUS_BATTERY_DISPLAY') {
  const forecastItems = [];
  const parts = [];

  const ALL_MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Find the header row containing month names
  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(8, rawRows.length); r++) {
    const rowStr = (rawRows[r] || []).join(' ').toLowerCase();
    if (rowStr.includes('january') || rowStr.includes('jan')) {
      headerRowIndex = r;
      break;
    }
  }

  const headerRow = rawRows[headerRowIndex] || [];
  const rowStr = headerRow.join(' ').toLowerCase();

  // Check if it's dual side-by-side (Battery on Left, Display on Right)
  const isDualTable = (rowStr.match(/january|jan/g) || []).length >= 2 || rawRows.some(r => (r[0] === 'Battery' || r[11] === 'Display'));

  if (isDualTable) {
    // Find dual month columns
    const leftMonthCols = [];
    const rightMonthCols = [];
    headerRow.forEach((h, colIdx) => {
      const hStr = String(h || '').trim().toLowerCase();
      const mIdx = ALL_MONTH_KEYS.findIndex(m => hStr.startsWith(m));
      if (mIdx >= 0) {
        if (colIdx < 11) leftMonthCols.push({ colIdx, monthIdx: mIdx, name: FULL_MONTHS[mIdx] });
        else rightMonthCols.push({ colIdx, monthIdx: mIdx, name: FULL_MONTHS[mIdx] });
      }
    });

    for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || row.length === 0) continue;

      // 1. Left Table: Battery
      const pnBat = String(row[0] || '').trim();
      const descBat = String(row[1] || '').trim();
      if (pnBat && descBat && isTargetIPhonePart(descBat, pnBat, filterScope)) {
        const rawVals = leftMonthCols.map(mc => parseInt(row[mc.colIdx]) || 0);
        let targetValue = 0;
        let historyCounts = [];
        if (rawVals.length > 0) {
          if (rawVals.length > 7) {
            historyCounts = rawVals.slice(0, rawVals.length - 1);
            targetValue = rawVals[rawVals.length - 1] > 0 ? rawVals[rawVals.length - 1] : calculateLinearRegressionForecast(historyCounts, historyCounts.length + 1);
          } else {
            historyCounts = rawVals;
            targetValue = calculateLinearRegressionForecast(historyCounts, historyCounts.length + 1);
          }
        }
        const rec = calculateRecommendedOrder(targetValue, 0.05);

        forecastItems.push({
          part_id: `part-${pnBat}`,
          part_number: pnBat,
          description: descBat,
          category_id: 'cat-battery',
          ytd_monthly_counts: historyCounts,
          computed_forecast: targetValue,
          admin_override: null,
          final_forecast: targetValue,
          safety_stock_units: rec.safetyUnits,
          recommended_order: rec.recommendedOrder
        });

        parts.push({
          id: `part-${pnBat}`,
          part_number: pnBat,
          description: descBat,
          category_id: 'cat-battery',
          iphone_model: descBat.replace(/^(Battery),?\s*/i, ''),
          stocking_price: 150,
          is_active: true
        });
      }

      // 2. Right Table: Display
      const pnDisp = String(row[11] || '').trim();
      const descDisp = String(row[12] || '').trim();
      if (pnDisp && descDisp && isTargetIPhonePart(descDisp, pnDisp, filterScope)) {
        const rawVals = rightMonthCols.map(mc => parseInt(row[mc.colIdx]) || 0);
        let targetValue = 0;
        let historyCounts = [];
        if (rawVals.length > 0) {
          if (rawVals.length > 7) {
            historyCounts = rawVals.slice(0, rawVals.length - 1);
            targetValue = rawVals[rawVals.length - 1] > 0 ? rawVals[rawVals.length - 1] : calculateLinearRegressionForecast(historyCounts, historyCounts.length + 1);
          } else {
            historyCounts = rawVals;
            targetValue = calculateLinearRegressionForecast(historyCounts, historyCounts.length + 1);
          }
        }
        const rec = calculateRecommendedOrder(targetValue, 0.05);

        forecastItems.push({
          part_id: `part-${pnDisp}`,
          part_number: pnDisp,
          description: descDisp,
          category_id: 'cat-display',
          ytd_monthly_counts: historyCounts,
          computed_forecast: targetValue,
          admin_override: null,
          final_forecast: targetValue,
          safety_stock_units: rec.safetyUnits,
          recommended_order: rec.recommendedOrder
        });

        parts.push({
          id: `part-${pnDisp}`,
          part_number: pnDisp,
          description: descDisp,
          category_id: 'cat-display',
          iphone_model: descDisp.replace(/^(Display),?\s*/i, ''),
          stocking_price: 280,
          is_active: true
        });
      }
    }
  } else {
    // Single Table parser (e.g. Battery & Display Forecasting stacked tables)
    const pnCol = headerRow.findIndex(h => /part\s*number|p\/n|part\s*#/i.test(String(h))) >= 0 ? headerRow.findIndex(h => /part\s*number|p\/n|part\s*#/i.test(String(h))) : 0;
    const descCol = headerRow.findIndex(h => /description|desc|part\s*name/i.test(String(h))) >= 0 ? headerRow.findIndex(h => /description|desc|part\s*name/i.test(String(h))) : 1;

    // Detect all month columns
    const monthCols = [];
    headerRow.forEach((h, colIdx) => {
      const hStr = String(h || '').trim().toLowerCase();
      const mIdx = ALL_MONTH_KEYS.findIndex(m => hStr.startsWith(m));
      if (mIdx >= 0 && colIdx !== pnCol && colIdx !== descCol) {
        monthCols.push({ colIdx, monthIdx: mIdx, name: FULL_MONTHS[mIdx] });
      }
    });

    for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || row.length === 0) continue;

      const pn = String(row[pnCol] || '').trim();
      const desc = String(row[descCol] || '').trim();
      if (!pn && !desc) continue;

      if (!isTargetIPhonePart(desc, pn, filterScope)) continue;

      const rawVals = monthCols.map(mc => parseInt(row[mc.colIdx]) || 0);
      let targetValue = 0;
      let historyCounts = [];

      if (rawVals.length > 0) {
        // If sheet has a projected target month column (e.g. September, which is 9th column after Jan-Aug)
        if (rawVals.length > 7) {
          historyCounts = rawVals.slice(0, rawVals.length - 1);
          const sheetTargetVal = rawVals[rawVals.length - 1];
          targetValue = sheetTargetVal !== undefined ? sheetTargetVal : calculateLinearRegressionForecast(historyCounts, historyCounts.length + 1);
        } else {
          historyCounts = rawVals;
          targetValue = calculateLinearRegressionForecast(historyCounts, historyCounts.length + 1);
        }
      }

      const isDisplay = desc.toLowerCase().includes('display') || desc.toLowerCase().includes('screen');
      const catId = isDisplay ? 'cat-display' : 'cat-battery';
      const rec = calculateRecommendedOrder(targetValue, 0.05);

      forecastItems.push({
        part_id: `part-${pn}`,
        part_number: pn,
        description: desc,
        category_id: catId,
        ytd_monthly_counts: historyCounts,
        computed_forecast: targetValue,
        admin_override: null,
        final_forecast: targetValue,
        safety_stock_units: rec.safetyUnits,
        recommended_order: rec.recommendedOrder
      });

      parts.push({
        id: `part-${pn}`,
        part_number: pn,
        description: desc,
        category_id: catId,
        iphone_model: desc.replace(/^(Battery|Display),?\s*/i, ''),
        stocking_price: isDisplay ? 279 : 99,
        is_active: true
      });
    }
  }

  return { forecastItems, parts };
}

/**
 * Sub-parser: Master Allocation Matrix Sheet (Matches Google Sheet Screenshot 1 & MasterList)
 * Dynamically identifies all 26 branch columns.
 */
export function parseAllocationSheet(rawRows, existingSites = [], existingPartsOrFilterScope = [], maybeFilterScope = null) {
  const existingParts = Array.isArray(existingPartsOrFilterScope) ? existingPartsOrFilterScope : [];
  const filterScope = typeof existingPartsOrFilterScope === 'string'
    ? existingPartsOrFilterScope
    : (maybeFilterScope || 'IPHONE_13_PLUS_BATTERY_DISPLAY');

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(8, rawRows.length); r++) {
    const rowStr = (rawRows[r] || []).join(' ').toUpperCase();
    if (rowStr.includes('BHS') || rowStr.includes('GB3') || rowStr.includes('PPM') || rowStr.includes('P/N') || rowStr.includes('PART DESCRIPTION')) {
      headerRowIndex = r;
      break;
    }
  }

  const headerRow = (rawRows[headerRowIndex] || []).map(h => String(h).trim());
  const pnCol = headerRow.findIndex(h => /part\s*number|p\/n|part\s*#|code/i.test(h)) >= 0 ? headerRow.findIndex(h => /part\s*number|p\/n|part\s*#|code/i.test(h)) : 5;
  const descCol = headerRow.findIndex(h => /description|desc|part\s*name/i.test(h)) >= 0 ? headerRow.findIndex(h => /description|desc|part\s*name/i.test(h)) : 6;
  const forecastQtyCol = headerRow.findIndex(h => /forecasted\s*qty|forecast/i.test(h));
  const stockPriceCol = headerRow.findIndex(h => /stocking\s*price|price/i.test(h));
  const exchangePriceCol = headerRow.findIndex(h => /exchange\s*price/i.test(h));
  const totalAllocCol = headerRow.findIndex(h => /total\s*parts|total\s*alloc|total/i.test(h));

  // Map site columns
  const siteCodeMap = {}; // colIdx -> siteObj
  const sites = [...existingSites];

  headerRow.forEach((h, colIdx) => {
    const cleanH = h.toUpperCase().replace(/^MOBILECARE\s*-\s*/i, '').trim();
    if (!cleanH || /commodity|forecast|price|exchange|part|p\/n|desc|total|w1|w2|w3|w4|remark/i.test(cleanH)) {
      return;
    }

    let siteObj = sites.find(s => cleanH.includes(s.code.toUpperCase()) || s.code.toUpperCase().includes(cleanH) || cleanH.includes(s.name.toUpperCase()) || s.name.toUpperCase().includes(cleanH));
    if (!siteObj) {
      const canonicalMatch = CANONICAL_SITE_LIST.find(cs => cs.code === cleanH || cleanH.includes(cs.code) || cs.name.includes(cleanH));
      const code = canonicalMatch ? canonicalMatch.code : (cleanH.replace(/[^A-Z0-9]/g, '').substring(0, 7) || `SITE-${colIdx}`);
      const name = canonicalMatch ? canonicalMatch.name : cleanH;
      siteObj = {
        id: `site-${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        code: code,
        name: name,
        region: /cebu|davao|iloilo|naga|la union|zamboanga|cagayan|lanang|lima|newpoint/i.test(cleanH) ? 'Provincial' : 'Metro Manila',
        address: `${name} Service Branch, Philippines`,
        is_dc: false,
        is_active: true
      };
      sites.push(siteObj);
    }
    siteCodeMap[colIdx] = siteObj;
  });

  const allocations = [];
  const parts = [];
  const seenPns = new Set();

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const rowStr = row.join(' ').toLowerCase();
    // Stop at bottom summary/footer rows and percentage share tables
    if (
      rowStr.includes('total parts per site') ||
      rowStr.includes('total cost breakdown') ||
      rowStr.includes('repair parts usage report') ||
      rowStr.includes('stockprice')
    ) {
      break;
    }

    const pn = String(row[pnCol] || '').trim();
    const desc = String(row[descCol] || '').trim();
    if (!pn && !desc) continue;
    if (seenPns.has(pn)) continue; // Avoid duplicate parts from lower share tables

    if (!isTargetIPhonePart(desc, pn, filterScope)) continue;
    seenPns.add(pn);

    const siteQuantities = {};
    let rowSum = 0;
    Object.keys(siteCodeMap).forEach(colIdx => {
      const sObj = siteCodeMap[colIdx];
      const qty = parseInt(row[colIdx]) || 0;
      siteQuantities[sObj.id] = qty;
      rowSum += qty;
    });

    const totalAlloc = totalAllocCol >= 0 && row[totalAllocCol] !== '' ? (parseInt(row[totalAllocCol]) || 0) : rowSum;
    const forecastQty = forecastQtyCol >= 0 && row[forecastQtyCol] !== '' ? (parseInt(row[forecastQtyCol]) || 0) : totalAlloc;
    
    // Exact price lookup with fallback to master price map
    const defaultPricing = lookupPartPrice(pn, desc, existingParts);
    const parsedStockPrice = stockPriceCol >= 0 && row[stockPriceCol] !== '' ? (parseFloat(String(row[stockPriceCol]).replace(/[^0-9.]/g, '')) || 0) : 0;
    const parsedExchangePrice = exchangePriceCol >= 0 && row[exchangePriceCol] !== '' ? (parseFloat(String(row[exchangePriceCol]).replace(/[^0-9.]/g, '')) || 0) : 0;

    const finalStockPrice = parsedStockPrice > 0 ? parsedStockPrice : defaultPricing.stockingPrice;
    const finalExchangePrice = parsedExchangePrice > 0 ? parsedExchangePrice : defaultPricing.exchangePrice;

    const isDisplay = desc.toLowerCase().includes('display') || desc.toLowerCase().includes('screen');
    const isBattery = desc.toLowerCase().includes('battery') || desc.toLowerCase().includes('batt');
    const isCamera = desc.toLowerCase().includes('camera');
    const isBackGlass = desc.toLowerCase().includes('back glass') || desc.toLowerCase().includes('rear system');

    const catId = isDisplay ? 'cat-display' : isBattery ? 'cat-battery' : isCamera ? 'cat-camera' : isBackGlass ? 'cat-backglass' : 'cat-other';
    const totalCost = totalAlloc * finalStockPrice;
    const split = calculateWeeklySplit(totalAlloc, totalCost, r + 1);

    allocations.push({
      part_id: `part-${pn}`,
      part_number: pn,
      description: desc,
      category_id: catId,
      forecasted_qty: forecastQty,
      stocking_price: finalStockPrice,
      exchange_price: finalExchangePrice,
      total_allocated_qty: totalAlloc,
      total_stock_cost: totalCost,
      w1_qty: split.w1_qty,
      w2_qty: split.w2_qty,
      w3_qty: split.w3_qty,
      w4_qty: split.w4_qty,
      w1_cost: split.w1_cost,
      w2_cost: split.w2_cost,
      w3_cost: split.w3_cost,
      w4_cost: split.w4_cost,
      site_quantities: siteQuantities
    });

    parts.push({
      id: `part-${pn}`,
      part_number: pn,
      description: desc,
      category_id: catId,
      iphone_model: desc.replace(/^(Battery|Display|Camera|Back Glass),?\s*/i, ''),
      stocking_price: finalStockPrice,
      exchange_price: finalExchangePrice,
      is_active: true
    });
  }

  return { allocations, sites, parts };
}

/**
 * Sub-parser: Raw Fixably / GSX repair logs & Masterlist Ingestion Pipeline
 * Step 1: Parses raw repair records (Location Name, GSX Repair Number, Repair Closed Date, Product Code, Product Description).
 * Step 2: Applies exact in-scope filter predicate (Rules a, b, c).
 * Step 3: Derives monthly usage counts across all trailing months & linear regression forecasts.
 * Step 4: Calculates all-time per-site historical shares for every part across 27 canonical sites.
 * Step 5: Computes multi-site allocation using Option A (Excel bit-for-bit parity) or Option B (self-consistent).
 * Step 6: Generates alternating row-parity 4-week split, order remarks, and summary totals.
 */
export function processRawUsageSheet(
  rawRows,
  existingSites = [],
  existingParts = [],
  optionsOrFilterScope = 'IPHONE_13_PLUS_BATTERY_DISPLAY',
  maybeSelectedMonth = 'auto',
  maybeFileName = ''
) {
  const options = typeof optionsOrFilterScope === 'object' && optionsOrFilterScope !== null
    ? optionsOrFilterScope
    : {
        filterScope: optionsOrFilterScope || 'IPHONE_13_PLUS_BATTERY_DISPLAY',
        selectedMonth: maybeSelectedMonth || 'auto',
        fileName: maybeFileName || '',
        allocationMode: 'OPTION_A'
      };

  const filterScope = options.filterScope || 'IPHONE_13_PLUS_BATTERY_DISPLAY';
  const selectedMonth = options.selectedMonth !== undefined ? options.selectedMonth : 'auto';
  const fileName = options.fileName || '';
  const allocationMode = options.allocationMode || 'OPTION_A';

  // 1. Identify header row
  let headerIndex = 0;
  for (let i = 0; i < Math.min(12, rawRows.length); i++) {
    const str = (rawRows[i] || []).map(c => String(c).toLowerCase()).join(' ');
    if (
      (str.includes('product') || str.includes('part') || str.includes('p/n') || str.includes('code') || str.includes('desc')) &&
      (str.includes('location') || str.includes('site') || str.includes('branch') || str.includes('repair') || str.includes('date') || str.includes('closed'))
    ) {
      headerIndex = i;
      break;
    }
  }

  const headers = (rawRows[headerIndex] || []).map(h => String(h).trim().toLowerCase());
  const colIndices = {
    site: headers.findIndex(h => /location\s*name|site|branch|location|asp|store/i.test(h)),
    repairId: headers.findIndex(h => /gsx\s*repair\s*number|repair\s*number|repair|order|case|ticket/i.test(h)),
    date: headers.findIndex(h => /repair\s*closed\s*date|closed\s*date|date|month|period/i.test(h)),
    partNumber: headers.findIndex(h => /product\s*code|part\s*number|p\/n|part\s*#|part_code|sku|item\s*code/i.test(h)),
    partDesc: headers.findIndex(h => /product\s*description|description|part\s*name|item\s*name|desc/i.test(h)),
    orderId: headers.findIndex(h => /order\s*id|order_id|order/i.test(h)),
    kgb: headers.findIndex(h => /product\s*kgb|kgb/i.test(h)),
    kbb: headers.findIndex(h => /product\s*kbb|kbb/i.test(h)),
    qty: headers.findIndex(h => /quantity|qty|count/i.test(h))
  };

  if (colIndices.site === -1) colIndices.site = 0;
  if (colIndices.repairId === -1) colIndices.repairId = 1;
  if (colIndices.date === -1) colIndices.date = 2;
  if (colIndices.partNumber === -1) colIndices.partNumber = 3;
  if (colIndices.partDesc === -1) colIndices.partDesc = 4;

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTH_ABBRS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Helper: parse date to UTC Date object
  function parseRepairDate(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number' && val > 20000 && val < 60000) {
      return new Date((val - 25569) * 86400 * 1000);
    }
    const strVal = String(val).trim();
    const numVal = parseFloat(strVal);
    if (!isNaN(numVal) && numVal > 20000 && numVal < 60000) {
      return new Date((numVal - 25569) * 86400 * 1000);
    }
    const parsed = new Date(strVal);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2020) {
      return parsed;
    }
    return null;
  }

  // Build canonical site index for all 27 sites
  const activeServiceSites = CANONICAL_SITE_LIST.map((cs) => {
    const existing = (existingSites || []).find(s => s.code === cs.code || (s.name && cs.name.includes(s.name)) || (s.name && s.name.includes(cs.name)));
    const siteId = existing?.id || `site-${cs.code.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    return {
      id: siteId,
      code: cs.code,
      name: cs.name,
      region: existing?.region || (/cebu|davao|iloilo|naga|la union|zamboanga|cagayan|lanang|lima|newpoint/i.test(cs.name) ? 'Provincial' : 'Metro Manila'),
      address: existing?.address || `${cs.name} Service Branch, Philippines`,
      is_dc: false,
      is_active: true
    };
  });

  const rawRepairRows = [];
  let totalRawRowsRead = 0;
  let filteredOutCount = 0;

  for (let r = headerIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const rawSite = String(row[colIndices.site] || '').trim();
    const rawRepairNo = colIndices.repairId >= 0 ? String(row[colIndices.repairId] || '').trim() : `RPR-${r}`;
    const rawDateVal = colIndices.date >= 0 ? row[colIndices.date] : null;
    const rawPn = String(row[colIndices.partNumber] || '').trim();
    const rawDesc = String(row[colIndices.partDesc] || '').trim();
    const rawOrderId = colIndices.orderId >= 0 ? String(row[colIndices.orderId] || '').trim() : '';
    const rawKgb = colIndices.kgb >= 0 ? String(row[colIndices.kgb] || '').trim() : '';
    const rawKbb = colIndices.kbb >= 0 ? String(row[colIndices.kbb] || '').trim() : '';
    const rawQty = colIndices.qty >= 0 ? Math.max(1, parseInt(row[colIndices.qty]) || 1) : 1;

    if (!rawPn && !rawDesc && !rawSite) continue;
    totalRawRowsRead++;

    // Step 2: Exact Filter Predicate
    if (!isTargetIPhonePart(rawDesc, rawPn, filterScope)) {
      filteredOutCount++;
      continue;
    }

    const cleanPn = rawPn ? rawPn.toUpperCase() : `PART-${r}`;
    const cleanDesc = rawDesc.trim();

    // Site matching
    const matchedSite = activeServiceSites.find(s =>
      rawSite.toUpperCase().includes(s.code.toUpperCase()) ||
      rawSite.toUpperCase().includes(s.name.toUpperCase()) ||
      s.name.toUpperCase().includes(rawSite.toUpperCase()) ||
      s.code.toUpperCase().includes(rawSite.toUpperCase())
    ) || activeServiceSites[0];

    // Date & Month Bucketing
    const parsedDate = parseRepairDate(rawDateVal);
    let monthIdx = -1;
    let isoDate = null;
    if (parsedDate) {
      monthIdx = parsedDate.getUTCMonth();
      isoDate = parsedDate.toISOString().split('T')[0];
    } else if (rawDateVal) {
      const dateStr = String(rawDateVal).toLowerCase();
      const mIdx = MONTH_NAMES.findIndex(m => dateStr.includes(m.toLowerCase())) !== -1
        ? MONTH_NAMES.findIndex(m => dateStr.includes(m.toLowerCase()))
        : MONTH_ABBRS.findIndex(m => dateStr.includes(m.toLowerCase()));
      if (mIdx >= 0) monthIdx = mIdx;
    }

    const isDisplay = cleanDesc.toLowerCase().includes('display') || cleanDesc.toLowerCase().includes('screen');
    const catId = isDisplay ? 'cat-display' : 'cat-battery';

    rawRepairRows.push({
      rawRowRef: r,
      repairNumber: rawRepairNo,
      orderId: rawOrderId,
      kgbKbb: rawKgb || rawKbb,
      repairClosedDate: isoDate,
      monthIndex: monthIdx,
      monthName: monthIdx >= 0 && monthIdx < 12 ? MONTH_NAMES[monthIdx] : 'Unknown',
      partNumber: cleanPn,
      description: cleanDesc,
      siteId: matchedSite.id,
      siteCode: matchedSite.code,
      rawSiteName: rawSite,
      siteName: matchedSite.name,
      quantity: rawQty,
      category_id: catId,
      matchedSite
    });
  }

  // Determine trailing months present in the dataset
  const validMonthIndices = rawRepairRows.filter(r => r.monthIndex >= 0).map(r => r.monthIndex);
  let maxMonthIdx = validMonthIndices.length > 0 ? Math.max(...validMonthIndices) : 7;
  let targetMonthIdx = Math.min(11, maxMonthIdx + 1);

  if (validMonthIndices.length === 0 && fileName) {
    const fnLower = fileName.toLowerCase();
    const fnMonthIdx = MONTH_NAMES.findIndex(m => fnLower.includes(m.toLowerCase()));
    if (fnMonthIdx >= 0) {
      targetMonthIdx = fnMonthIdx;
      maxMonthIdx = Math.max(0, fnMonthIdx - 1);
    }
  }

  if (selectedMonth !== 'auto' && selectedMonth !== undefined && selectedMonth !== '') {
    const parsedM = parseInt(selectedMonth, 10);
    if (!isNaN(parsedM)) targetMonthIdx = Math.max(0, Math.min(11, parsedM));
  }

  // Trailing window length N (e.g. 8 for Jan-Aug -> historyLength = 8, regressionTargetX = 9)
  const historyLength = maxMonthIdx + 1;
  const regressionTargetX = historyLength + 1;

  // Accumulate monthly counts and all-time site usage per part description
  const partDataMap = new Map();

  rawRepairRows.forEach(r => {
    if (!partDataMap.has(r.description)) {
      partDataMap.set(r.description, {
        partNumber: r.partNumber,
        description: r.description,
        category_id: r.category_id,
        months: new Array(historyLength).fill(0),
        siteCounts: {}
      });
    }
    const pEntry = partDataMap.get(r.description);
    if (r.monthIndex >= 0 && r.monthIndex < historyLength) {
      pEntry.months[r.monthIndex] = (pEntry.months[r.monthIndex] || 0) + r.quantity;
    }
    pEntry.siteCounts[r.siteId] = (pEntry.siteCounts[r.siteId] || 0) + r.quantity;
  });

  // Helper: Build all-time per-site empirical share matrix for a list of part descriptions
  function buildEmpiricalShareMatrix(descList, catId) {
    // 1. Calculate overall commodity-level site distribution fallback
    const catSiteCounts = new Array(activeServiceSites.length).fill(0);
    let catTotal = 0;
    rawRepairRows.filter(r => r.category_id === catId).forEach(r => {
      const sIdx = activeServiceSites.findIndex(s => s.id === r.siteId);
      if (sIdx >= 0) {
        catSiteCounts[sIdx] += r.quantity;
        catTotal += r.quantity;
      }
    });

    const fallbackShares = catTotal > 0
      ? catSiteCounts.map(c => c / catTotal)
      : activeServiceSites.map(() => 1 / activeServiceSites.length);

    // 2. Model-level share vector: (filtered repairs for this part at site) / (filtered repairs for this part, all sites)
    return descList.map(desc => {
      const pEntry = partDataMap.get(desc);
      let modelTotal = 0;
      const counts = activeServiceSites.map(s => {
        const c = pEntry?.siteCounts[s.id] || 0;
        modelTotal += c;
        return c;
      });

      if (modelTotal > 0) {
        return counts.map(c => c / modelTotal);
      }
      return [...fallbackShares];
    });
  }

  const displayShareMatrix = buildEmpiricalShareMatrix(CANONICAL_DISPLAY_DESCS, 'cat-display');
  const batteryShareMatrix = buildEmpiricalShareMatrix(CANONICAL_BATTERY_DESCS, 'cat-battery');

  const forecastItems = [];
  const allocations = [];
  const parts = [];

  let currentRowNumber = 3; // Displays start at Excel Row 3

  // 1. Process Displays
  CANONICAL_DISPLAY_DESCS.forEach((desc, matrixRowIdx) => {
    const pEntry = partDataMap.get(desc) || {
      partNumber: Object.entries(MASTER_PART_PRICING).find(([, v]) => v.desc === desc)?.[0] || `PART-${desc}`,
      description: desc,
      category_id: 'cat-display',
      months: new Array(historyLength).fill(0),
      siteCounts: {}
    };

    const pn = pEntry.partNumber;
    const computedForecast = calculateLinearRegressionForecast(pEntry.months, regressionTargetX);
    const recOrder = calculateRecommendedOrder(computedForecast, 0.05);

    forecastItems.push({
      part_id: `part-${pn}`,
      part_number: pn,
      description: desc,
      category_id: 'cat-display',
      ytd_monthly_counts: pEntry.months,
      computed_forecast: computedForecast,
      admin_override: null,
      final_forecast: computedForecast,
      safety_stock_units: recOrder.safetyUnits,
      recommended_order: recOrder.recommendedOrder
    });

    const pricing = lookupPartPrice(pn, desc, existingParts);
    const allocatedBranchQuantities = allocationMode === 'OPTION_B'
      ? calculateOptionBAllocation(computedForecast, displayShareMatrix, matrixRowIdx)
      : calculateOptionAAllocation(computedForecast, displayShareMatrix, matrixRowIdx);

    const siteQuantities = {};
    let totalAlloc = 0;
    activeServiceSites.forEach((s, sIdx) => {
      const q = allocatedBranchQuantities[sIdx] || 0;
      siteQuantities[s.id] = q;
      siteQuantities[s.code] = q;
      totalAlloc += q;
    });

    const totalCost = totalAlloc * pricing.stockingPrice;
    const split = calculateWeeklySplit(totalAlloc, totalCost, currentRowNumber);

    allocations.push({
      part_id: `part-${pn}`,
      part_number: pn,
      description: desc,
      category_id: 'cat-display',
      forecasted_qty: computedForecast,
      stocking_price: pricing.stockingPrice,
      exchange_price: pricing.exchangePrice,
      total_allocated_qty: totalAlloc,
      total_stock_cost: totalCost,
      w1_qty: split.w1_qty,
      w2_qty: split.w2_qty,
      w3_qty: split.w3_qty,
      w4_qty: split.w4_qty,
      w1_cost: split.w1_cost,
      w2_cost: split.w2_cost,
      w3_cost: split.w3_cost,
      w4_cost: split.w4_cost,
      site_quantities: siteQuantities,
      remarks: getOrderRemark(totalAlloc)
    });

    parts.push({
      id: `part-${pn}`,
      part_number: pn,
      description: desc,
      category_id: 'cat-display',
      iphone_model: desc.replace(/^(Display),?\s*/i, ''),
      stocking_price: pricing.stockingPrice,
      exchange_price: pricing.exchangePrice,
      safety_stock_pct: 0.05,
      is_active: true
    });

    currentRowNumber++;
  });

  currentRowNumber++; // Row parity: skip subtotal row to match Excel Batteries at Row 25

  // 2. Process Batteries
  CANONICAL_BATTERY_DESCS.forEach((desc, matrixRowIdx) => {
    const pEntry = partDataMap.get(desc) || {
      partNumber: Object.entries(MASTER_PART_PRICING).find(([, v]) => v.desc === desc)?.[0] || `PART-${desc}`,
      description: desc,
      category_id: 'cat-battery',
      months: new Array(historyLength).fill(0),
      siteCounts: {}
    };

    const pn = pEntry.partNumber;
    const computedForecast = calculateLinearRegressionForecast(pEntry.months, regressionTargetX);
    const recOrder = calculateRecommendedOrder(computedForecast, 0.05);

    forecastItems.push({
      part_id: `part-${pn}`,
      part_number: pn,
      description: desc,
      category_id: 'cat-battery',
      ytd_monthly_counts: pEntry.months,
      computed_forecast: computedForecast,
      admin_override: null,
      final_forecast: computedForecast,
      safety_stock_units: recOrder.safetyUnits,
      recommended_order: recOrder.recommendedOrder
    });

    const pricing = lookupPartPrice(pn, desc, existingParts);
    const allocatedBranchQuantities = allocationMode === 'OPTION_B'
      ? calculateOptionBAllocation(computedForecast, batteryShareMatrix, matrixRowIdx)
      : calculateOptionAAllocation(computedForecast, batteryShareMatrix, matrixRowIdx);

    const siteQuantities = {};
    let totalAlloc = 0;
    activeServiceSites.forEach((s, sIdx) => {
      const q = allocatedBranchQuantities[sIdx] || 0;
      siteQuantities[s.id] = q;
      siteQuantities[s.code] = q;
      totalAlloc += q;
    });

    const totalCost = totalAlloc * pricing.stockingPrice;
    const split = calculateWeeklySplit(totalAlloc, totalCost, currentRowNumber);

    allocations.push({
      part_id: `part-${pn}`,
      part_number: pn,
      description: desc,
      category_id: 'cat-battery',
      forecasted_qty: computedForecast,
      stocking_price: pricing.stockingPrice,
      exchange_price: pricing.exchangePrice,
      total_allocated_qty: totalAlloc,
      total_stock_cost: totalCost,
      w1_qty: split.w1_qty,
      w2_qty: split.w2_qty,
      w3_qty: split.w3_qty,
      w4_qty: split.w4_qty,
      w1_cost: split.w1_cost,
      w2_cost: split.w2_cost,
      w3_cost: split.w3_cost,
      w4_cost: split.w4_cost,
      site_quantities: siteQuantities,
      remarks: getOrderRemark(totalAlloc)
    });

    parts.push({
      id: `part-${pn}`,
      part_number: pn,
      description: desc,
      category_id: 'cat-battery',
      iphone_model: desc.replace(/^(Battery),?\s*/i, ''),
      stocking_price: pricing.stockingPrice,
      exchange_price: pricing.exchangePrice,
      safety_stock_pct: 0.05,
      is_active: true
    });

    currentRowNumber++;
  });

  const detectedPeriod = {
    month: targetMonthIdx + 1,
    year: 2026,
    label: `${MONTH_NAMES[targetMonthIdx]} 2026`
  };

  return {
    records: rawRepairRows,
    forecastItems,
    allocations,
    parts,
    sites: activeServiceSites,
    displayShares: displayShareMatrix,
    batteryShares: batteryShareMatrix,
    allocationMode,
    detectedMonth: targetMonthIdx,
    detectedPeriod,
    summary: {
      totalRecords: rawRepairRows.length,
      filteredOut: filteredOutCount,
      partsCount: parts.length,
      sitesCount: activeServiceSites.length,
      totalForecastedUnits: forecastItems.reduce((acc, f) => acc + (f.final_forecast || f.computed_forecast || 0), 0),
      totalAllocatedUnits: allocations.reduce((acc, a) => acc + (a.total_allocated_qty || 0), 0),
      totalValuation: allocations.reduce((acc, a) => acc + (a.total_stock_cost || 0), 0)
    },
    totalRawRowsRead,
    filteredOutCount
  };
}

export async function exportAllocationToExcel(allocations, sites, period = 'August 2026') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mobile Care Services Phils. Inc.';
  workbook.lastModifiedBy = 'MDC DC System 2';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Master Allocation', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }, // A4 Landscape
    views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }]
  });

  // Calculate high-level summary metrics
  const totalPartsAll = allocations.reduce((sum, it) => sum + (it.total_allocated_qty || 0), 0);
  let totalValueAll = 0;
  allocations.forEach(it => {
    const price = it.stocking_price || (it.description?.toLowerCase().includes('display') ? 279 : 99);
    totalValueAll += (it.total_allocated_qty || 0) * price;
  });

  function getExcelColLetter(colIndex) {
    let temp, letter = '';
    while (colIndex > 0) {
      temp = (colIndex - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      colIndex = Math.floor((colIndex - temp - 1) / 26);
    }
    return letter;
  }

  const lastColNum = 5 + sites.length + 11;
  const lastColLetter = getExcelColLetter(lastColNum);

  // 1. Title Banner (Row 1)
  worksheet.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `MOBILE CARE SERVICES PHILS. INC. — Master Allocation Matrix & Weekly Batches (${period})`;
  titleCell.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Dark Navy
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 28;

  // 2. Subtitle / Metadata (Row 2)
  worksheet.mergeCells(`A2:${lastColLetter}2`);
  const subTitleCell = worksheet.getCell('A2');
  subTitleCell.value = `Multi-Site Proportional Allocation across ${sites.length} Branches • 4-Week Delivery Schedules • Valuation Grand Totals`;
  subTitleCell.font = { name: 'Arial', size: 9.5, italic: true, color: { argb: 'FF94A3B8' } };
  subTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  subTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(2).height = 18;

  // 3. KPI Highlights Banner (Row 3)
  worksheet.mergeCells('A3:D3');
  const kpi1 = worksheet.getCell('A3');
  kpi1.value = `TOTAL PARTS: ${totalPartsAll.toLocaleString()} units`;
  kpi1.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  kpi1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } }; // Blue
  kpi1.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells('E3:J3');
  const kpi2 = worksheet.getCell('E3');
  kpi2.value = `ACTIVE SERVICE BRANCHES: ${sites.length} sites`;
  kpi2.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  kpi2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  kpi2.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells(`K3:${lastColLetter}3`);
  const kpi3 = worksheet.getCell('K3');
  kpi3.value = `TOTAL MASTER VALUATION: $${totalValueAll.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  kpi3.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  kpi3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } }; // Green
  kpi3.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(3).height = 22;

  // 4. Main Table Header (Row 4)
  const headers = [
    'Commodity',
    'Part Number',
    'Description',
    'Stock Price',
    'Exchange Price',
    ...sites.map(s => s.code),
    'Total Parts',
    'Total Stock Price',
    'W1 Qty',
    'W1 Total ($)',
    'W2 Qty',
    'W2 Total ($)',
    'W3 Qty',
    'W3 Total ($)',
    'W4 Qty',
    'W4 Total ($)',
    'Remarks'
  ];

  const headerRow = worksheet.addRow(headers);
  headerRow.height = 28;

  headerRow.eachCell((cell, colNum) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'medium', color: { argb: 'FF0284C7' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } }
    };

    if (colNum <= 3) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    } else if (colNum === 4 || colNum === 5) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    } else if (colNum > 5 && colNum <= 5 + sites.length) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF38BDF8' } };
    } else if (colNum === 5 + sites.length + 1) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
    } else if (colNum === 5 + sites.length + 2) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0369A1' } };
    } else if (colNum >= 5 + sites.length + 3 && colNum <= 5 + sites.length + 10) {
      const isQty = (colNum - (5 + sites.length + 3)) % 2 === 0;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isQty ? 'FF334155' : 'FF1E293B' } };
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: isQty ? 'FFFFFFFF' : 'FF38BDF8' } };
    } else {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    }
  });

  const displayItems = allocations.filter(it => it.category_id === 'cat-display' || it.description?.toLowerCase().includes('display'));
  const batteryItems = allocations.filter(it => it.category_id === 'cat-battery' || it.description?.toLowerCase().includes('battery') || !displayItems.includes(it));

  const addCategorySection = (items, catLabel, catColor, catText) => {
    let subtotalQty = 0;
    let subtotalCost = 0;
    let subtotalW1 = 0, subtotalW1Cost = 0;
    let subtotalW2 = 0, subtotalW2Cost = 0;
    let subtotalW3 = 0, subtotalW3Cost = 0;
    let subtotalW4 = 0, subtotalW4Cost = 0;
    const subtotalSites = {};

    items.forEach((item, idx) => {
      const stockPrice = item.stocking_price || 0;
      const exchangePrice = item.exchange_price || 0;
      const totalQty = item.total_allocated_qty || 0;
      const totalCost = item.total_stock_cost || (totalQty * stockPrice);
      const split = calculateWeeklySplit(totalQty, totalCost, idx + 3);

      subtotalQty += totalQty;
      subtotalCost += totalCost;
      subtotalW1 += split.w1_qty; subtotalW1Cost += split.w1_cost;
      subtotalW2 += split.w2_qty; subtotalW2Cost += split.w2_cost;
      subtotalW3 += split.w3_qty; subtotalW3Cost += split.w3_cost;
      subtotalW4 += split.w4_qty; subtotalW4Cost += split.w4_cost;

      const rowValues = [
        sanitizeForSpreadsheet(catLabel),
        sanitizeForSpreadsheet(item.part_number),
        sanitizeForSpreadsheet(item.description),
        stockPrice,
        exchangePrice
      ];

      sites.forEach(s => {
        const q = item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0;
        subtotalSites[s.id] = (subtotalSites[s.id] || 0) + q;
        rowValues.push(q);
      });

      rowValues.push(
        totalQty,
        totalCost,
        split.w1_qty,
        split.w1_cost,
        split.w2_qty,
        split.w2_cost,
        split.w3_qty,
        split.w3_cost,
        split.w4_qty,
        split.w4_cost,
        totalQty > 0 ? 'ORDER REQUIRED' : 'NO NEED TO ORDER'
      );

      const dRow = worksheet.addRow(rowValues);
      dRow.height = 20;

      const isOrderRequired = totalQty > 0;

      dRow.eachCell({ includeEmpty: true }, (cell, cNum) => {
        cell.font = { name: 'Arial', size: 9 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        if (cNum === 1) {
          cell.font = { name: 'Arial', size: 8.5, bold: true, color: { argb: catText } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: catColor } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (cNum === 2) {
          cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (cNum === 3) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else if (cNum === 4 || cNum === 5) {
          cell.numFmt = '$#,##0.00';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (cNum > 5 && cNum <= 5 + sites.length) {
          const val = Number(cell.value) || 0;
          if (val > 0) {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF15803D' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
          } else {
            cell.font = { name: 'Arial', size: 9, color: { argb: 'FF94A3B8' } };
          }
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (cNum === 5 + sites.length + 1) {
          cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (cNum === 5 + sites.length + 2) {
          cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
          cell.numFmt = '$#,##0.00';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (cNum >= 5 + sites.length + 3 && cNum <= 5 + sites.length + 10) {
          const isQty = (cNum - (5 + sites.length + 3)) % 2 === 0;
          if (isQty) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else {
            cell.numFmt = '$#,##0.00';
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          }
        } else if (cNum === lastColNum) {
          if (isOrderRequired) {
            cell.font = { name: 'Arial', size: 8, bold: true, color: { argb: 'FF15803D' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
          } else {
            cell.font = { name: 'Arial', size: 8, bold: true, color: { argb: 'FF64748B' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          }
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    const subtotalValues = [
      catLabel,
      'SUB-TOTAL',
      `${items.length} Parts Sub-Total`,
      '',
      ''
    ];
    sites.forEach(s => {
      subtotalValues.push(subtotalSites[s.id] || 0);
    });
    subtotalValues.push(
      subtotalQty,
      subtotalCost,
      subtotalW1,
      subtotalW1Cost,
      subtotalW2,
      subtotalW2Cost,
      subtotalW3,
      subtotalW3Cost,
      subtotalW4,
      subtotalW4Cost,
      ''
    );

    const subRow = worksheet.addRow(subtotalValues);
    subRow.height = 22;
    subRow.eachCell((cell, cNum) => {
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: catText } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: catColor } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
      };

      if (cNum === 4 || cNum === 5 || cNum === 5 + sites.length + 2 || cNum === 5 + sites.length + 4 || cNum === 5 + sites.length + 6 || cNum === 5 + sites.length + 8 || cNum === 5 + sites.length + 10) {
        cell.numFmt = '$#,##0.00';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });

    return {
      qty: subtotalQty,
      cost: subtotalCost,
      w1: subtotalW1, w1Cost: subtotalW1Cost,
      w2: subtotalW2, w2Cost: subtotalW2Cost,
      w3: subtotalW3, w3Cost: subtotalW3Cost,
      w4: subtotalW4, w4Cost: subtotalW4Cost,
      sites: subtotalSites
    };
  };

  const displaySummary = addCategorySection(displayItems, 'DISPLAY', 'FFE0F2FE', 'FF0369A1');
  const batterySummary = addCategorySection(batteryItems, 'BATTERY', 'FFDCFCE7', 'FF15803D');

  // 5. Grand Total Rows
  const grandUnits = [
    'TOTAL',
    'PARTS',
    'TOTAL PARTS PER SITE',
    '',
    ''
  ];
  sites.forEach(s => {
    grandUnits.push((displaySummary.sites[s.id] || 0) + (batterySummary.sites[s.id] || 0));
  });
  grandUnits.push(
    totalPartsAll,
    '',
    displaySummary.w1 + batterySummary.w1,
    '',
    displaySummary.w2 + batterySummary.w2,
    '',
    displaySummary.w3 + batterySummary.w3,
    '',
    displaySummary.w4 + batterySummary.w4,
    '',
    'TOTAL PLAN'
  );

  const gUnitsRow = worksheet.addRow(grandUnits);
  gUnitsRow.height = 24;
  gUnitsRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF38BDF8' } },
      bottom: { style: 'thin', color: { argb: 'FF334155' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } }
    };
  });

  const grandCosts = [
    'COST',
    'VALUATION',
    'TOTAL COST BREAKDOWN',
    '',
    ''
  ];
  sites.forEach(s => {
    let siteCost = 0;
    allocations.forEach(item => {
      const p = item.stocking_price || 0;
      const q = item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0;
      siteCost += q * p;
    });
    grandCosts.push(siteCost);
  });
  grandCosts.push(
    '',
    totalValueAll,
    '',
    displaySummary.w1Cost + batterySummary.w1Cost,
    '',
    displaySummary.w2Cost + batterySummary.w2Cost,
    '',
    displaySummary.w3Cost + batterySummary.w3Cost,
    '',
    displaySummary.w4Cost + batterySummary.w4Cost,
    ''
  );

  const gCostRow = worksheet.addRow(grandCosts);
  gCostRow.height = 24;
  gCostRow.eachCell((cell, cNum) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF38BDF8' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'double', color: { argb: 'FF38BDF8' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } }
    };

    if ((cNum > 5 && cNum <= 5 + sites.length) || cNum === 5 + sites.length + 2 || cNum === 5 + sites.length + 4 || cNum === 5 + sites.length + 6 || cNum === 5 + sites.length + 8 || cNum === 5 + sites.length + 10) {
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    } else {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  });

  worksheet.getColumn(1).width = 12;
  worksheet.getColumn(2).width = 15;
  worksheet.getColumn(3).width = 30;
  worksheet.getColumn(4).width = 13;
  worksheet.getColumn(5).width = 13;
  sites.forEach((s, idx) => {
    worksheet.getColumn(6 + idx).width = 9;
  });
  const offset = 6 + sites.length;
  worksheet.getColumn(offset).width = 12;
  worksheet.getColumn(offset + 1).width = 16;
  worksheet.getColumn(offset + 2).width = 9;
  worksheet.getColumn(offset + 3).width = 13;
  worksheet.getColumn(offset + 4).width = 9;
  worksheet.getColumn(offset + 5).width = 13;
  worksheet.getColumn(offset + 6).width = 9;
  worksheet.getColumn(offset + 7).width = 13;
  worksheet.getColumn(offset + 8).width = 9;
  worksheet.getColumn(offset + 9).width = 13;
  worksheet.getColumn(offset + 10).width = 18;

  // Add Weekly Worksheets (Week 1, Week 2, Week 3, Week 4) matching Google Sheets multi-tab structure
  for (let w = 1; w <= 4; w++) {
    const wSheet = workbook.addWorksheet(`Week ${w}`, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      views: [{ state: 'frozen', xSplit: 6, ySplit: 3 }]
    });

    const wLastColNum = 6 + sites.length;
    const wLastColLetter = getExcelColLetter(wLastColNum);

    // 1. Title Banner
    wSheet.mergeCells(`A1:${wLastColLetter}1`);
    const wTitle = wSheet.getCell('A1');
    wTitle.value = `MOBILE CARE SERVICES PHILS. INC. — Week ${w} Allocation Matrix (${period})`;
    wTitle.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    wTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    wTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    wSheet.getRow(1).height = 28;

    // 2. Subtitle Banner
    wSheet.mergeCells(`A2:${wLastColLetter}2`);
    const wSub = wSheet.getCell('A2');
    wSub.value = `Week ${w} Proportional Branch Allocations across ${sites.length} Service Centers`;
    wSub.font = { name: 'Arial', size: 9.5, italic: true, color: { argb: 'FF94A3B8' } };
    wSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    wSub.alignment = { horizontal: 'center', vertical: 'middle' };
    wSheet.getRow(2).height = 18;

    // 3. Header Row (Matching Google Sheets: Product Category, Forecasted Quantity, Stocking Price, Exchange Price, P/N, Part Description, Branches)
    const wHeaders = [
      'Product Category',
      'Forecasted Quantity',
      'Stocking Price',
      'Exchange Price',
      'P/N',
      'Part Description',
      ...sites.map(s => s.code)
    ];

    const wHeadRow = wSheet.addRow(wHeaders);
    wHeadRow.height = 26;
    wHeadRow.eachCell((cell, cIdx) => {
      cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cIdx <= 6 ? 'FF0F172A' : 'FF1E293B' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'medium', color: { argb: 'FF0284C7' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        right: { style: 'thin', color: { argb: 'FF334155' } }
      };
    });

    const addWeeklyCategorySection = (items, catLabel) => {
      let subtotalWQty = 0;
      const subtotalWSites = {};

      items.forEach((item, rIdx) => {
        const stockPrice = item.stocking_price || (catLabel === 'DISPLAY' ? 279 : 99);
        const exchPrice = item.exchange_price || (stockPrice * 0.84);
        const split = calculateWeeklySplit(item.total_allocated_qty, (item.total_allocated_qty || 0) * stockPrice, rIdx + 3);
        const rowWQty = split[`w${w}_qty`] || 0;
        subtotalWQty += rowWQty;

        const rowValues = [
          sanitizeForSpreadsheet(catLabel),
          rowWQty,
          stockPrice,
          exchPrice,
          sanitizeForSpreadsheet(item.part_number),
          sanitizeForSpreadsheet(item.description)
        ];

        sites.forEach(s => {
          const bMonthly = item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0;
          const bSplit = calculateWeeklySplit(bMonthly, bMonthly * stockPrice, rIdx + 3);
          const bWQty = bSplit[`w${w}_qty`] || 0;
          subtotalWSites[s.id] = (subtotalWSites[s.id] || 0) + bWQty;
          rowValues.push(bWQty);
        });

        const dRow = wSheet.addRow(rowValues);
        dRow.height = 20;
        const isZeroRow = rowWQty === 0;
        const rowBgArgb = isZeroRow ? 'FFFEF2F2' : 'FFFFFFFF';

        dRow.eachCell({ includeEmpty: true }, (cell, cIdx) => {
          cell.font = { name: 'Arial', size: 9, color: { argb: isZeroRow ? 'FF991B1B' : 'FF0F172A' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBgArgb } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };

          if (cIdx === 3 || cIdx === 4) {
            cell.numFmt = '$#,##0.00';
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          } else if (cIdx === 1 || cIdx === 2 || cIdx === 5 || cIdx > 6) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (cIdx > 6 && cell.value > 0) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
              cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF15803D' } };
            }
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });
      });

      // Category Subtotal Row (Matching Google Sheets Row 26 black banner)
      const subRowValues = [
        catLabel,
        subtotalWQty,
        '',
        '',
        'SUB-TOTAL',
        `${items.length} Parts Sub-Total`
      ];
      sites.forEach(s => {
        subRowValues.push(subtotalWSites[s.id] || 0);
      });

      const sRow = wSheet.addRow(subRowValues);
      sRow.height = 22;
      sRow.eachCell((cell) => {
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      return { qty: subtotalWQty, sites: subtotalWSites };
    };

    const dispW = addWeeklyCategorySection(displayItems, 'DISPLAY');
    const battW = addWeeklyCategorySection(batteryItems, 'BATTERY');

    // Grand Total Row
    const grandWRowValues = [
      'TOTAL',
      dispW.qty + battW.qty,
      '',
      '',
      'GRAND TOTAL',
      `Week ${w} Total`
    ];
    sites.forEach(s => {
      grandWRowValues.push((dispW.sites[s.id] || 0) + (battW.sites[s.id] || 0));
    });

    const gRow = wSheet.addRow(grandWRowValues);
    gRow.height = 24;
    gRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF38BDF8' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF38BDF8' } },
        bottom: { style: 'double', color: { argb: 'FF38BDF8' } }
      };
    });

    wSheet.getColumn(1).width = 14;
    wSheet.getColumn(2).width = 16;
    wSheet.getColumn(3).width = 13;
    wSheet.getColumn(4).width = 13;
    wSheet.getColumn(5).width = 15;
    wSheet.getColumn(6).width = 30;
    sites.forEach((s, idx) => {
      wSheet.getColumn(7 + idx).width = 9;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Master_Allocation_${period.replace(/\s+/g, '_')}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportForecastToExcel(forecastItems, period = 'September 2026') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mobile Care Services Phils. Inc.';
  workbook.lastModifiedBy = 'MDC DC System 2';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(`${period} Forecast`, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let maxHistoryLength = 0;
  forecastItems.forEach(item => {
    if (Array.isArray(item.ytd_monthly_counts)) {
      maxHistoryLength = Math.max(maxHistoryLength, item.ytd_monthly_counts.length);
    }
  });
  if (maxHistoryLength === 0) maxHistoryLength = 8;
  const months = MONTH_NAMES.slice(0, maxHistoryLength);

  function getColLetter(colIndex) {
    let temp, letter = '';
    while (colIndex > 0) {
      temp = (colIndex - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      colIndex = Math.floor((colIndex - temp - 1) / 26);
    }
    return letter;
  }

  const lastColLetter = getColLetter(3 + months.length + 3);

  // Title Banner
  worksheet.mergeCells(`A1:${lastColLetter}1`);
  const tCell = worksheet.getCell('A1');
  tCell.value = `MOBILE CARE SERVICES PHILS. INC. — Demand Forecasting Engine (${period})`;
  tCell.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  tCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 28;

  // Header Row
  const headers = [
    'Commodity',
    'Part Number',
    'Description',
    ...months.map(m => `${m} 2026`),
    'Computed Forecast',
    'Admin Override',
    'Final Recommended Order'
  ];

  const headerRow = worksheet.addRow(headers);
  headerRow.height = 26;
  headerRow.eachCell((cell, colNum) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNum > 3 + months.length ? 'FF0284C7' : 'FF1E293B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'medium', color: { argb: 'FF0284C7' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } }
    };
  });

  // Data Rows
  forecastItems.forEach((item, rIdx) => {
    const isEven = rIdx % 2 === 0;
    const rowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';
    const isDisplay = item.category_id === 'cat-display' || item.description?.toLowerCase().includes('display');
    const commodity = isDisplay ? 'DISPLAY' : 'BATTERY';

    const historyCounts = item.ytd_monthly_counts || [];
    const monthlySlice = months.map((_, mIdx) => historyCounts[mIdx] || 0);
    const computedVal = item.computed_forecast !== undefined ? item.computed_forecast : calculateLinearRegressionForecast(monthlySlice, monthlySlice.length + 1);

    const rowData = [
      sanitizeForSpreadsheet(commodity),
      sanitizeForSpreadsheet(item.part_number),
      sanitizeForSpreadsheet(item.description),
      ...monthlySlice,
      computedVal,
      item.admin_override !== null && item.admin_override !== undefined ? item.admin_override : '',
      item.final_forecast || computedVal
    ];

    const row = worksheet.addRow(rowData);
    row.height = 20;

    row.eachCell((cell, cNum) => {
      cell.font = { name: 'Arial', size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      if (cNum === 1 || cNum === 2) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 9, bold: true };
      } else if (cNum === 3) {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      } else if (cNum > 3 && cNum <= 3 + months.length) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 3 + months.length + 1) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0284C7' } };
      } else if (cNum === 3 + months.length + 2) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 3 + months.length + 3) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF15803D' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
      }
    });
  });

  worksheet.getColumn(1).width = 14;
  worksheet.getColumn(2).width = 16;
  worksheet.getColumn(3).width = 32;
  months.forEach((_, idx) => {
    worksheet.getColumn(4 + idx).width = 11;
  });
  const fOffset = 4 + months.length;
  worksheet.getColumn(fOffset).width = 18;
  worksheet.getColumn(fOffset + 1).width = 16;
  worksheet.getColumn(fOffset + 2).width = 24;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Demand_Forecast_${period.replace(/\s+/g, '_')}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadSampleGsxFixablyCsv() {
  const sampleRecords = [
    {
      'Repair Number': 'RPR-2026-00101',
      'Closed Date': '2026-08-01',
      'Site Name': 'MOBILECARE - APP BONIFACIO HIGH STREET',
      'Part Number': '661-21991',
      'Part Description': 'Battery, iPhone 13',
      'Quantity': 1,
      'Serial Number': 'F8Y6276C0DF18FKBQ',
      'Order ID': 'GSX-ORD-99101'
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRecords);
  const csvContent = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'Fixably_GSX_Raw_Usage_Template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Download a sample XLSX or CSV template specifically for Receive Scan-In parts intake
 */
export function downloadScanInTemplate(format = 'xlsx', purchaseOrders = []) {
  const defaultPoNumber = purchaseOrders[0]?.po_number || 'PO-2026-08-001';
  
  const sampleRows = [
    {
      'Part Number': '661-21991',
      'Serial Number': `F8Y${Math.floor(100000 + Math.random() * 900000)}13XCB`,
      'Description': 'Battery, iPhone 13',
      'PO Number': defaultPoNumber,
      'Box Number': 1
    },
    {
      'Part Number': '661-21996',
      'Serial Number': `DNM${Math.floor(100000 + Math.random() * 900000)}33817`,
      'Description': 'Battery, iPhone 13 Pro',
      'PO Number': defaultPoNumber,
      'Box Number': 1
    },
    {
      'Part Number': '661-22294',
      'Serial Number': `DN8${Math.floor(100000 + Math.random() * 900000)}MCN3R`,
      'Description': 'Battery, iPhone 13 Pro Max',
      'PO Number': defaultPoNumber,
      'Box Number': 1
    },
    {
      'Part Number': '661-30401',
      'Serial Number': `GH3${Math.floor(100000 + Math.random() * 900000)}00MUZ`,
      'Description': 'Display, iPhone 14 Pro Max',
      'PO Number': defaultPoNumber,
      'Box Number': 2
    },
    {
      'Part Number': '661-31422',
      'Serial Number': `CK9${Math.floor(100000 + Math.random() * 900000)}449KL`,
      'Description': 'Display, iPhone 15 Pro',
      'PO Number': defaultPoNumber,
      'Box Number': 2
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  // Set nice column widths
  ws['!cols'] = [
    { wch: 16 }, // Part Number
    { wch: 24 }, // Serial Number
    { wch: 32 }, // Description
    { wch: 20 }, // PO Number
    { wch: 12 }  // Box Number
  ];

  if (format === 'csv') {
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'MDC_Receive_Parts_Import_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Parts Intake');
    XLSX.writeFile(wb, 'MDC_Receive_Parts_Import_Template.xlsx');
  }
}

/**
 * Parse an uploaded XLSX or CSV file for batch parts receiving into DC inventory
 */
export async function parseScanInPartsFile(file, existingParts = [], existingUnits = [], purchaseOrders = []) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    
    // Pick the best sheet by scoring content (prefers sheets with actual parts and serial data)
    let targetSheetName = workbook.SheetNames[0];
    let maxScore = -1;

    for (const sName of workbook.SheetNames) {
      const ws = workbook.Sheets[sName];
      if (!ws) continue;
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!data || data.length === 0) continue;

      let score = 0;
      if (/parts|intake|receive|inventory|scan|stock|dc|sheet1/i.test(sName)) score += 10;

      for (let r = 0; r < Math.min(25, data.length); r++) {
        const row = data[r] || [];
        for (const cell of row) {
          const val = String(cell || '').trim();
          if (/(?:ZP|PP|Z)?661-\d{4,6}/i.test(val)) score += 5;
          if (/^[A-Z0-9]{10,20}$/i.test(val) && !/(?:ZP|PP|Z)?661-\d{4,6}/i.test(val) && !/^\d{4,8}$/.test(val)) score += 3;
        }
      }

      if (score > maxScore) {
        maxScore = score;
        targetSheetName = sName;
      }
    }

    const worksheet = workbook.Sheets[targetSheetName];
    if (!worksheet) {
      return { success: false, error: 'No readable sheets found in file.' };
    }

    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rawRows || rawRows.length < 2) {
      return { success: false, error: 'File is empty or contains no data rows.' };
    }

    // Find header row: row with at least 2 non-empty cells and relevant column headers
    let headerIdx = 0;
    for (let i = 0; i < Math.min(15, rawRows.length); i++) {
      const row = rawRows[i] || [];
      const nonEmpty = row.filter(c => String(c).trim().length > 0);
      if (nonEmpty.length < 2) continue; // Skip single-cell banner/title rows
      const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
      if (/(part|product|serial|kgb|kbb|code|item|s\/n|p\/n|imei|desc|order|box)/i.test(rowStr)) {
        headerIdx = i;
        break;
      }
    }

    const headers = (rawRows[headerIdx] || []).map(h => String(h || '').trim());
    const headerMap = {
      pnCols: [],
      serialCols: [],
      descCols: [],
      poCols: [],
      boxCols: [],
      qtyCols: []
    };

    headers.forEach((h, colIdx) => {
      const clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (/^(partnumber|partno|partnum|partcode|pn|p\/n)$/.test(clean)) {
        headerMap.pnCols.unshift(colIdx);
      } else if (/^(productcode|itemnumber|itemno|itemcode|code|part)$/.test(clean)) {
        headerMap.pnCols.push(colIdx);
      } else if (/^(productkgb|kgbserial|kgb|serialnumber|serialno|serialnum|serial|sn|s\/n|serials|imei|barcode|scannedserial)$/.test(clean)) {
        headerMap.serialCols.unshift(colIdx);
      } else if (/^(productkbb|kbbserial|kbb)$/.test(clean)) {
        headerMap.serialCols.push(colIdx);
      } else if (/^(productdescription|partdescription|itemdescription|description|desc|productname|partname|itemname|name|title)$/.test(clean)) {
        headerMap.descCols.push(colIdx);
      } else if (/^(orderid|ordernumber|ponumber|pono|po|purchaseorder)$/.test(clean)) {
        headerMap.poCols.push(colIdx);
      } else if (/^(boxnumber|boxno|box|carton|package)$/.test(clean)) {
        headerMap.boxCols.push(colIdx);
      } else if (/^(quantity|qty|count|units)$/.test(clean)) {
        headerMap.qtyCols.push(colIdx);
      }
    });

    const parsedItems = [];
    const seenSerialsInBatch = new Set();
    const existingSerialsSet = new Set((existingUnits || []).map(u => String(u.serial_number || '').trim().toUpperCase()));

    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || row.length === 0 || row.every(cell => String(cell || '').trim() === '')) {
        continue; // Skip empty rows
      }

      // Extract Part Number from mapped columns
      let rawPn = '';
      for (const col of headerMap.pnCols) {
        const val = String(row[col] || '').trim();
        if (val) { rawPn = val; break; }
      }

      // Extract Serial Number from mapped columns
      let rawSerial = '';
      for (const col of headerMap.serialCols) {
        const val = String(row[col] || '').trim();
        if (val && !/^(n\/?a|none|null|-)$/i.test(val)) { rawSerial = val; break; }
      }

      // Extract Description
      let rawDesc = '';
      for (const col of headerMap.descCols) {
        const val = String(row[col] || '').trim();
        if (val) { rawDesc = val; break; }
      }

      // Extract PO Number
      let rawPo = '';
      for (const col of headerMap.poCols) {
        const val = String(row[col] || '').trim();
        if (val) { rawPo = val; break; }
      }

      // Extract Box Number
      let rawBox = 1;
      for (const col of headerMap.boxCols) {
        const parsed = parseInt(row[col], 10);
        if (!isNaN(parsed) && parsed > 0) { rawBox = parsed; break; }
      }

      // Per-row intelligent data-driven scan if Part Number or Serial is missing
      if (!rawPn || !rawSerial) {
        row.forEach((cell, cellIdx) => {
          const val = String(cell || '').trim();
          if (!val) return;

          // Check if cell is an Apple Part Number
          if (!rawPn && (/(?:ZP|PP|Z)?661-\d{4,6}/i.test(val) || existingParts.some(p => p.part_number.toUpperCase() === val.toUpperCase()))) {
            rawPn = val;
          }
          // Check if cell is an Apple Serial Number (alphanumeric 10-20 chars, not PN, not short number)
          else if (!rawSerial && /^[A-Z0-9]{10,20}$/i.test(val) && !/(?:ZP|PP|Z)?661-\d{4,6}/i.test(val) && !/^\d{4,8}$/.test(val) && !headerMap.poCols.includes(cellIdx)) {
            rawSerial = val;
          }
        });
      }

      // Skip Excel summary, total, subtotal, and count footer rows (e.g. "80 TOTAL" or "GRAND TOTAL")
      const isSummaryRow = row.some(cell => {
        const str = String(cell || '').trim();
        return /^(total|totals|grand total|grandtotal|subtotal|sub-total|count|total count|summary|all totals|report total|end of report|page \d+.*)$/i.test(str);
      });
      if (isSummaryRow && (!rawSerial || /^(total|subtotal|count)$/i.test(rawSerial))) {
        continue;
      }
      if (/^(total|totals|grand total|subtotal|count|summary|end of report)$/i.test(rawPn)) {
        continue;
      }
      if (/^\d{1,4}$/.test(rawPn) && !existingParts.some(p => p.part_number.toUpperCase() === rawPn.toUpperCase())) {
        if (!rawSerial || /^(total|subtotal|count)$/i.test(rawDesc) || !rawDesc) {
          continue;
        }
      }

      if (!rawPn && !rawSerial) {
        continue;
      }

      // Intelligent Part Resolution (matches 661-xxxxx, descriptions, models)
      const resolvedPart = resolvePartInfo(rawPn, existingParts) || resolvePartInfo(rawDesc, existingParts);
      const cleanPN = resolvedPart ? resolvedPart.part_number : (rawPn || rawDesc).toUpperCase();
      const existingPart = resolvedPart || existingParts.find(p => p.part_number.toUpperCase() === cleanPN);
      const partDesc = resolvedPart?.description || rawDesc || existingPart?.description || `Replacement Part (${cleanPN || 'Custom'})`;
      
      // Match PO if specified
      let matchedPoId = null;
      let matchedPoNumber = null;
      if (rawPo) {
        const foundPo = purchaseOrders.find(po => 
          po.po_number.toLowerCase() === rawPo.toLowerCase() || 
          po.id.toLowerCase() === rawPo.toLowerCase()
        );
        if (foundPo) {
          matchedPoId = foundPo.id;
          matchedPoNumber = foundPo.po_number;
        } else {
          matchedPoNumber = rawPo;
        }
      }

      // If serial is completely missing in file row, auto-generate fallback
      let currentSerial = rawSerial;
      let isAutoGeneratedSerial = false;
      if (!currentSerial) {
        currentSerial = `AUTO-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        isAutoGeneratedSerial = true;
      }
      
      const cleanSerial = currentSerial.toUpperCase();
      const serialValidation = !isAutoGeneratedSerial ? validateAppleSerialNumber(cleanSerial, cleanPN, existingParts) : { isValid: true };

      let status = 'VALID';
      let statusMessage = isAutoGeneratedSerial ? 'Auto-assigned Serial (Missing from file)' : 'Ready to Import';

      if (!cleanPN) {
        status = 'ERROR';
        statusMessage = 'Missing Part Number';
      } else if (!isAutoGeneratedSerial && !serialValidation.isValid) {
        status = 'ERROR';
        statusMessage = serialValidation.error || 'Invalid Serial Number';
      } else if (seenSerialsInBatch.has(cleanSerial)) {
        // True duplicate: the exact same serial number is repeated across multiple rows within this spreadsheet
        status = 'DUPLICATE';
        statusMessage = 'Repeated serial in spreadsheet';
      } else if (existingSerialsSet.has(cleanSerial)) {
        // Already registered in DC inventory: safe to re-import / update
        status = 'EXISTING_INVENTORY';
        statusMessage = 'Already in DC Stock (Will re-sync/update details)';
      } else if (!existingPart) {
        status = 'NEW_PART';
        statusMessage = 'New Part (will auto-register in catalog)';
      }

      seenSerialsInBatch.add(cleanSerial);

      parsedItems.push({
        id: `batch-${i}-${Math.random().toString(36).substr(2, 5)}`,
        rowNumber: i + 1,
        partNumber: cleanPN,
        description: partDesc,
        serialNumber: cleanSerial,
        poId: matchedPoId,
        poNumber: matchedPoNumber || rawPo || null,
        boxNumber: rawBox,
        status,
        statusMessage,
        isExistingPart: !!existingPart
      });
    }

    if (parsedItems.length === 0) {
      return { success: false, error: 'No valid part records found in the uploaded file.' };
    }

    const validCount = parsedItems.filter(it => it.status === 'VALID' || it.status === 'NEW_PART' || it.status === 'EXISTING_INVENTORY').length;
    const duplicateCount = parsedItems.filter(it => it.status === 'DUPLICATE').length;
    const existingInStockCount = parsedItems.filter(it => it.status === 'EXISTING_INVENTORY').length;
    const newPartsCount = parsedItems.filter(it => it.status === 'NEW_PART').length;
    const errorCount = parsedItems.filter(it => it.status === 'ERROR').length;

    return {
      success: true,
      fileName: file.name,
      items: parsedItems,
      summary: {
        total: parsedItems.length,
        valid: validCount,
        duplicates: duplicateCount,
        existingInStock: existingInStockCount,
        newParts: newPartsCount,
        errors: errorCount
      }
    };
  } catch (err) {
    console.error('Error parsing scan-in file:', err);
    return { success: false, error: `Failed to parse file: ${err.message}` };
  }
}

/**
 * Download a sample XLSX or CSV template for Pack Scan-Out
 */
export function downloadScanOutTemplate(format = 'xlsx', existingSites = [], existingInventory = []) {
  const serviceSites = (existingSites || []).filter(s => !s.is_dc);
  const sampleSiteCode = serviceSites[0]?.code || 'APP BHS';
  const availableStock = (existingInventory || []).filter(u => u.status === 'in_stock');

  const sampleRows = [
    {
      'Part Number': availableStock[0]?.part_number || '661-21991',
      'Serial Number': availableStock[0]?.serial_number || 'F8Y12345613XCB',
      'Box Number': 1,
      'Destination Site': sampleSiteCode,
      'Notes': 'iPhone 13 Battery'
    },
    {
      'Part Number': availableStock[1]?.part_number || '661-21996',
      'Serial Number': availableStock[1]?.serial_number || 'DNM65432133817',
      'Box Number': 1,
      'Destination Site': sampleSiteCode,
      'Notes': 'iPhone 13 Pro Battery'
    },
    {
      'Part Number': availableStock[2]?.part_number || '661-30401',
      'Serial Number': availableStock[2]?.serial_number || 'GH398765400MUZ',
      'Box Number': 2,
      'Destination Site': sampleSiteCode,
      'Notes': 'iPhone 14 Pro Max Display'
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 16 }, // Part Number
    { wch: 24 }, // Serial Number
    { wch: 12 }, // Box Number
    { wch: 20 }, // Destination Site
    { wch: 28 }  // Notes
  ];

  if (format === 'csv') {
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'MDC_Pack_ScanOut_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pack ScanOut');
    XLSX.writeFile(wb, 'MDC_Pack_ScanOut_Template.xlsx');
  }
}

/**
 * Parse an uploaded XLSX or CSV file for Pack Scan-Out
 */
export async function parseScanOutPartsFile(file, inventoryUnits = [], sites = [], defaultSiteId = null) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    
    // Pick the best sheet by scoring content
    let targetSheetName = workbook.SheetNames[0];
    let maxScore = -1;
    for (const sName of workbook.SheetNames) {
      const ws = workbook.Sheets[sName];
      if (!ws) continue;
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!data || data.length === 0) continue;

      let score = 0;
      if (/pack|out|ship|manifest|scan|parts|inventory/i.test(sName)) score += 10;
      for (let r = 0; r < Math.min(25, data.length); r++) {
        for (const cell of (data[r] || [])) {
          const val = String(cell || '').trim();
          if (/^[A-Z0-9]{10,20}$/i.test(val)) score += 3;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        targetSheetName = sName;
      }
    }

    const worksheet = workbook.Sheets[targetSheetName];
    if (!worksheet) {
      return { success: false, error: 'No readable sheets found in file.' };
    }

    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rawRows || rawRows.length < 2) {
      return { success: false, error: 'File is empty or contains no data rows.' };
    }

    let headerIdx = 0;
    for (let i = 0; i < Math.min(15, rawRows.length); i++) {
      const row = rawRows[i] || [];
      const nonEmpty = row.filter(c => String(c).trim().length > 0);
      if (nonEmpty.length < 2) continue;
      const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
      if (/(part|serial|box|site|p\/n|s\/n|kgb|kbb|code|branch)/i.test(rowStr)) {
        headerIdx = i;
        break;
      }
    }

    const headers = (rawRows[headerIdx] || []).map(h => String(h || '').trim());
    const headerMap = {
      pnCols: [],
      serialCols: [],
      boxCols: [],
      siteCols: [],
      notesCols: []
    };

    headers.forEach((h, colIdx) => {
      const lower = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (/^(partnumber|partno|partnum|partcode|pn|p\/n)$/.test(lower)) {
        headerMap.pnCols.unshift(colIdx);
      } else if (/^(productcode|itemnumber|itemno|code|part)$/.test(lower)) {
        headerMap.pnCols.push(colIdx);
      } else if (/^(productkgb|kgbserial|kgb|serialnumber|serialno|serial|sn|s\/n|barcode|imei)$/.test(lower)) {
        headerMap.serialCols.unshift(colIdx);
      } else if (/^(productkbb|kbbserial|kbb)$/.test(lower)) {
        headerMap.serialCols.push(colIdx);
      } else if (/^(boxnumber|boxno|box|carton|pkg)$/.test(lower)) {
        headerMap.boxCols.push(colIdx);
      } else if (/^(destinationsite|destination|site|branch|location|asp)$/.test(lower)) {
        headerMap.siteCols.push(colIdx);
      } else if (/^(notes|description|desc|remarks|name|title)$/.test(lower)) {
        headerMap.notesCols.push(colIdx);
      }
    });

    const parsedItems = [];
    const seenSerials = new Set();

    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || row.length === 0 || row.every(cell => String(cell || '').trim() === '')) {
        continue;
      }

      let rawPn = '';
      for (const col of headerMap.pnCols) {
        const val = String(row[col] || '').trim();
        if (val) { rawPn = val; break; }
      }

      let rawSerial = '';
      for (const col of headerMap.serialCols) {
        const val = String(row[col] || '').trim();
        if (val && !/^(n\/?a|none|null|-)$/i.test(val)) { rawSerial = val; break; }
      }

      let rawBox = 1;
      for (const col of headerMap.boxCols) {
        const parsed = parseInt(row[col], 10);
        if (!isNaN(parsed) && parsed > 0) { rawBox = parsed; break; }
      }

      let rawSite = '';
      for (const col of headerMap.siteCols) {
        const val = String(row[col] || '').trim();
        if (val) { rawSite = val; break; }
      }

      // Per-row intelligent scan if Serial or PN is missing
      if (!rawSerial || !rawPn) {
        row.forEach((cell) => {
          const val = String(cell || '').trim();
          if (!val) return;
          if (!rawPn && /(?:ZP|PP|Z)?661-\d{4,6}/i.test(val)) {
            rawPn = val;
          } else if (!rawSerial && /^[A-Z0-9]{10,20}$/i.test(val) && !/(?:ZP|PP|Z)?661-\d{4,6}/i.test(val) && !/^\d{4,8}$/.test(val)) {
            rawSerial = val;
          }
        });
      }

      // Skip Excel summary, total, subtotal, and count footer rows
      const isSummaryRow = row.some(cell => {
        const str = String(cell || '').trim();
        return /^(total|totals|grand total|grandtotal|subtotal|sub-total|count|total count|summary|all totals|report total|end of report|page \d+.*)$/i.test(str);
      });
      if (isSummaryRow && (!rawSerial || /^(total|subtotal|count)$/i.test(rawSerial))) {
        continue;
      }
      if (/^(total|totals|grand total|subtotal|count|summary|end of report)$/i.test(rawPn)) {
        continue;
      }

      if (!rawPn && !rawSerial) continue;

      const cleanPN = rawPn.toUpperCase();
      const cleanSerial = rawSerial.toUpperCase();

      let status = 'VALID';
      let statusMessage = 'In Stock (Ready to Pack)';
      let matchedUnit = null;

      // Check against inventoryUnits in DC
      if (cleanSerial) {
        matchedUnit = inventoryUnits.find(u =>
          u.serial_number.toUpperCase() === cleanSerial &&
          (!cleanPN || u.part_number.toUpperCase() === cleanPN)
        );

        if (!matchedUnit) {
          matchedUnit = inventoryUnits.find(u => u.serial_number.toUpperCase() === cleanSerial);
        }
      }

      if (!matchedUnit) {
        status = 'NOT_FOUND';
        statusMessage = 'Serial not found in DC inventory';
      } else if (matchedUnit.status !== 'in_stock' && matchedUnit.status !== 'allocated') {
        status = 'ALREADY_PACKED';
        statusMessage = `Unit already has status "${matchedUnit.status}"`;
      } else if (cleanSerial && seenSerials.has(cleanSerial)) {
        status = 'DUPLICATE';
        statusMessage = 'Duplicate Serial in file';
      }

      if (cleanSerial) {
        seenSerials.add(cleanSerial);
      }

      // Match destination site if specified
      let matchedSiteId = defaultSiteId;
      let matchedSiteName = null;

      if (rawSite) {
        const foundSite = sites.find(s =>
          s.code.toLowerCase() === rawSite.toLowerCase() ||
          s.name.toLowerCase() === rawSite.toLowerCase() ||
          s.id.toLowerCase() === rawSite.toLowerCase()
        );
        if (foundSite) {
          matchedSiteId = foundSite.id;
          matchedSiteName = foundSite.name;
        }
      }

      parsedItems.push({
        id: `scanout-${i}-${Math.random().toString(36).substr(2, 5)}`,
        rowNumber: i + 1,
        partNumber: cleanPN || matchedUnit?.part_number || '',
        serialNumber: cleanSerial,
        description: matchedUnit?.description || cleanPN,
        boxNumber: rawBox,
        destinationSiteId: matchedSiteId,
        destinationSiteName: matchedSiteName || rawSite || 'Unassigned',
        status,
        statusMessage,
        matchedUnit
      });
    }

    if (parsedItems.length === 0) {
      return { success: false, error: 'No valid part serial records found in the uploaded file.' };
    }

    return {
      success: true,
      fileName: file.name,
      items: parsedItems,
      summary: {
        total: parsedItems.length,
        valid: parsedItems.filter(it => it.status === 'VALID').length,
        notFound: parsedItems.filter(it => it.status === 'NOT_FOUND').length,
        duplicates: parsedItems.filter(it => it.status === 'DUPLICATE').length,
        alreadyPacked: parsedItems.filter(it => it.status === 'ALREADY_PACKED').length
      }
    };
  } catch (err) {
    console.error('Error parsing scan-out file:', err);
    return { success: false, error: `Failed to parse file: ${err.message}` };
  }
}

/**
 * Download a sample XLSX or CSV template for Shipment Manifests
 */
export function downloadShipmentManifestTemplate(format = 'xlsx', existingSites = []) {
  const serviceSites = (existingSites || []).filter(s => !s.is_dc);
  const sampleSiteCode = serviceSites[0]?.code || 'APP BHS';

  const sampleRows = [
    {
      'Invoice Ref': 'DCMSPIOWNED#20260810A',
      'Shipment Number': 'SHIP-202608-001',
      'Destination Site': sampleSiteCode,
      'Shipment Date': '2026-08-10',
      'Carrier': 'Lite Express',
      'Tracking Number': '20227258',
      'Total Boxes': 1,
      'Status': 'shipped',
      'Prepared By': 'Joshua Juvida',
      'Verified By': 'Zhon Manaois',
      'Part Number': '661-21991',
      'Serial Number': 'F8Y6276C1UQ13XCB1',
      'Description': 'Battery, iPhone 13',
      'Box Number': 1
    },
    {
      'Invoice Ref': 'DCMSPIOWNED#20260810A',
      'Shipment Number': 'SHIP-202608-001',
      'Destination Site': sampleSiteCode,
      'Shipment Date': '2026-08-10',
      'Carrier': 'Lite Express',
      'Tracking Number': '20227258',
      'Total Boxes': 1,
      'Status': 'shipped',
      'Prepared By': 'Joshua Juvida',
      'Verified By': 'Zhon Manaois',
      'Part Number': '661-21996',
      'Serial Number': 'DNM6276C1UQ133817',
      'Description': 'Battery, iPhone 13 Pro',
      'Box Number': 1
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 22 }, // Invoice Ref
    { wch: 18 }, // Shipment Number
    { wch: 18 }, // Destination Site
    { wch: 14 }, // Shipment Date
    { wch: 16 }, // Carrier
    { wch: 16 }, // Tracking Number
    { wch: 12 }, // Total Boxes
    { wch: 12 }, // Status
    { wch: 16 }, // Prepared By
    { wch: 16 }, // Verified By
    { wch: 16 }, // Part Number
    { wch: 22 }, // Serial Number
    { wch: 26 }, // Description
    { wch: 12 }  // Box Number
  ];

  if (format === 'csv') {
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'MDC_Shipment_Manifest_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Shipments');
    XLSX.writeFile(wb, 'MDC_Shipment_Manifest_Template.xlsx');
  }
}

/**
 * Parse an uploaded XLSX or CSV file for Batch Shipments & Manifests
 */
export async function parseShipmentManifestFile(file, sites = [], parts = []) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!worksheet) return { success: false, error: 'No readable sheets found.' };

    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    if (!rawRows || rawRows.length === 0) {
      return { success: false, error: 'File is empty.' };
    }

    const shipmentsMap = new Map();

    rawRows.forEach((row, idx) => {
      const invoiceRef = row['Invoice Ref'] || row['invoice_ref'] || row['Invoice'] || row['Reference'] || `MANUAL-${Date.now()}`;
      const shipmentNum = row['Shipment Number'] || row['shipment_number'] || row['Shipment #'] || `SHIP-${Date.now()}-${idx}`;
      const siteStr = row['Destination Site'] || row['Destination'] || row['Site'] || row['Branch'] || '';
      const carrier = row['Carrier'] || 'Lite Express';
      const tracking = row['Tracking Number'] || row['Tracking'] || 'N/A';
      const status = (row['Status'] || 'shipped').toLowerCase();
      const prepBy = row['Prepared By'] || 'Warehouse Staff';
      const verBy = row['Verified By'] || 'Admin Staff';
      const shipDate = row['Shipment Date'] || new Date().toISOString().split('T')[0];
      const pn = row['Part Number'] || row['Part #'] || row['P/N'] || '';
      const sn = row['Serial Number'] || row['Serial #'] || row['S/N'] || '';
      const partObj = (parts || []).find(p => p.part_number === pn);
      const desc = row['Description'] || partObj?.description || `Part (${pn})`;
      const box = parseInt(row['Box Number'] || row['Box'], 10) || 1;

      const key = `${invoiceRef}__${shipmentNum}`;

      if (!shipmentsMap.has(key)) {
        let destSite = sites.find(s => s.code?.toLowerCase() === siteStr.toLowerCase() || s.name?.toLowerCase() === siteStr.toLowerCase());
        if (!destSite) destSite = sites.find(s => !s.is_dc) || sites[0];

        shipmentsMap.set(key, {
          id: `ship-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          shipment_number: shipmentNum,
          invoice_ref: invoiceRef,
          site_id: destSite?.id,
          site_name: destSite?.name,
          shipment_date: shipDate,
          carrier,
          tracking_number: tracking,
          total_boxes: box,
          status,
          prepared_by_name: prepBy,
          verified_by_name: verBy,
          receiving_signature: destSite?.code || 'ASP',
          remarks: 'KGB PARTS',
          items: []
        });
      }

      const sh = shipmentsMap.get(key);
      if (box > sh.total_boxes) sh.total_boxes = box;

      if (pn && sn) {
        sh.items.push({
          part_number: pn,
          description: desc,
          serial_number: sn,
          box_number: box
        });
      }
    });

    const parsedShipments = Array.from(shipmentsMap.values());
    return {
      success: true,
      fileName: file.name,
      shipments: parsedShipments,
      totalItems: parsedShipments.reduce((acc, s) => acc + s.items.length, 0)
    };
  } catch (err) {
    console.error('Error parsing shipment manifest file:', err);
    return { success: false, error: `Failed to parse file: ${err.message}` };
  }
}

/**
 * Parse Fixably Stock Transfers Report XLSX or CSV file
 */
export async function parseStockTransfersReportFile(file) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    
    let targetSheetName = workbook.SheetNames[0];
    for (const name of workbook.SheetNames) {
      if (/transfer|stock|report/i.test(name)) {
        targetSheetName = name;
        break;
      }
    }

    const worksheet = workbook.Sheets[targetSheetName];
    if (!worksheet) {
      return { success: false, error: 'No readable worksheet found in the uploaded file.' };
    }

    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rawRows || rawRows.length < 2) {
      return { success: false, error: 'The uploaded file is empty or missing data rows.' };
    }

    // Locate header row
    let headerIdx = -1;
    for (let r = 0; r < Math.min(10, rawRows.length); r++) {
      const rowStr = (rawRows[r] || []).join(' ').toLowerCase();
      if (
        (rowStr.includes('from stock') || rowStr.includes('from')) &&
        (rowStr.includes('to stock') || rowStr.includes('to')) &&
        (rowStr.includes('product') || rowStr.includes('part') || rowStr.includes('serial'))
      ) {
        headerIdx = r;
        break;
      }
    }

    if (headerIdx === -1) {
      headerIdx = rawRows.length > 1 && rawRows[0].filter(c => String(c).trim()).length <= 2 ? 1 : 0;
    }

    const headers = (rawRows[headerIdx] || []).map(h => String(h || '').trim());
    
    let dateCol = -1, fromCol = -1, toCol = -1, codeCol = -1, nameCol = -1, qtyCol = -1, snCol = -1, imeiCol = -1, valCol = -1;
    
    headers.forEach((h, idx) => {
      const clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (/receiveddate|transferreceiveddate|transferdate|date|received/.test(clean)) dateCol = idx;
      else if (/fromstock|fromlocation|fromsite|source|from/.test(clean)) fromCol = idx;
      else if (/tostock|tolocation|tosite|destination|dest|to/.test(clean)) toCol = idx;
      else if (/productcode|partnumber|partno|partcode|itemcode|pn|code/.test(clean)) codeCol = idx;
      else if (/productname|partdescription|description|itemname|product|desc|name/.test(clean)) nameCol = idx;
      else if (/transferquantity|quantity|qty|count/.test(clean)) qtyCol = idx;
      else if (/serialnumber|serialno|serial|sn/.test(clean)) snCol = idx;
      else if (/imeinumber|imei/.test(clean)) imeiCol = idx;
      else if (/transfervalue|totalvalue|value|price|cost|amount/.test(clean)) valCol = idx;
    });

    if (dateCol === -1) dateCol = 0;
    if (fromCol === -1) fromCol = 1;
    if (toCol === -1) toCol = 2;
    if (codeCol === -1) codeCol = 3;
    if (nameCol === -1) nameCol = 4;
    if (qtyCol === -1) qtyCol = 5;
    if (snCol === -1) snCol = 6;
    if (imeiCol === -1) imeiCol = 7;
    if (valCol === -1) valCol = 8;

    const records = [];
    const fromSet = new Set();
    const toSet = new Set();
    let totalQty = 0;
    let totalVal = 0;

    for (let r = headerIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r] || [];
      const fromVal = String(row[fromCol] || '').trim();
      const toVal = String(row[toCol] || '').trim();
      const codeVal = String(row[codeCol] || '').trim();
      const nameVal = String(row[nameCol] || '').trim();
      const snVal = String(row[snCol] || '').trim();

      if (!fromVal && !toVal && !codeVal && !snVal) continue;
      if (fromVal.toLowerCase().includes('total') || codeVal.toLowerCase().includes('total')) continue;

      let dateRaw = row[dateCol];
      let formattedDate = '';
      if (typeof dateRaw === 'number') {
        const d = new Date((dateRaw - 25569) * 86400 * 1000);
        formattedDate = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : String(dateRaw);
      } else if (dateRaw) {
        const d = new Date(dateRaw);
        formattedDate = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : String(dateRaw).trim();
      }

      const qty = Number(row[qtyCol]) || 1;
      let val = 0;
      if (valCol >= 0 && row[valCol] !== undefined && row[valCol] !== null && row[valCol] !== '') {
        const cleanVal = String(row[valCol]).replace(/[^0-9.-]/g, '');
        val = parseFloat(cleanVal) || 0;
      }
      if (!val || val <= 0) {
        const desc = (nameVal || '').toLowerCase();
        const isDisplay = desc.includes('display') || desc.includes('screen');
        const isBattery = desc.includes('battery');
        const isCamera = desc.includes('camera');
        const isBackGlass = desc.includes('back glass') || desc.includes('rear system') || desc.includes('mid');
        const resolved = resolvePartInfo(codeVal);
        if (resolved && Number(resolved.stocking_price) > 0) {
          val = Number(resolved.stocking_price) * qty;
        } else if (isDisplay) {
          val = 279 * qty;
        } else if (isBattery) {
          val = 99 * qty;
        } else if (isCamera) {
          val = 149 * qty;
        } else if (isBackGlass) {
          val = 129 * qty;
        } else {
          val = 89 * qty;
        }
      }

      if (fromVal) fromSet.add(fromVal);
      if (toVal) toSet.add(toVal);
      totalQty += qty;
      totalVal += val;

      records.push({
        id: `trf-${Date.now()}-${r}`,
        transfer_received_date: formattedDate,
        from_stock: fromVal || 'DC_MSPI-Owned',
        to_stock: toVal || 'SERVICE_HUB',
        product_code: codeVal || 'UNKNOWN',
        product_name: nameVal || 'Service Part',
        transfer_quantity: qty,
        serial_number: snVal,
        imei_number: String(row[imeiCol] || '').trim(),
        transfer_value: val
      });
    }

    if (records.length === 0) {
      return { success: false, error: 'No valid transfer records found in file.' };
    }

    const metadata = {
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      totalRows: records.length,
      totalQty,
      totalVal,
      uniqueFromCount: fromSet.size,
      uniqueToCount: toSet.size
    };

    return {
      success: true,
      records,
      metadata
    };
  } catch (err) {
    console.error('Error parsing Fixably stock transfers file:', err);
    return { success: false, error: `Failed to parse file: ${err.message}` };
  }
}

/**
 * Exports Stock Transfers records to a beautifully styled Excel workbook using ExcelJS
 */
export async function exportStockTransfersToExcel(records, metadata = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mobile Care Services Phils. Inc.';
  workbook.lastModifiedBy = 'MDC DC System 2';
  workbook.created = new Date();
  if (metadata?.fileName) {
    workbook.title = metadata.fileName;
  }

  const worksheet = workbook.addWorksheet('Stock Transfers Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  const totalQty = records.reduce((sum, r) => sum + (r.transfer_quantity || 0), 0);
  const totalVal = records.reduce((sum, r) => sum + (r.transfer_value || 0), 0);

  // Title Banner
  worksheet.mergeCells('A1:I1');
  const tCell = worksheet.getCell('A1');
  tCell.value = 'MOBILE CARE SERVICES PHILS. INC. — Fixably Stock Transfers Report';
  tCell.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  tCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 28;

  // KPI Row
  worksheet.mergeCells('A2:C2');
  const k1 = worksheet.getCell('A2');
  k1.value = `TOTAL RECORDS: ${records.length.toLocaleString()} transfers`;
  k1.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  k1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
  k1.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells('D2:F2');
  const k2 = worksheet.getCell('D2');
  k2.value = `TOTAL QUANTITY: ${totalQty.toLocaleString()} units`;
  k2.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF334155' } };
  k2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  k2.alignment = { horizontal: 'center', vertical: 'middle' };

  worksheet.mergeCells('G2:I2');
  const k3 = worksheet.getCell('G2');
  k3.value = `TOTAL TRANSFER VALUATION: $${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  k3.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  k3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
  k3.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(2).height = 22;

  // Header Row
  const headers = [
    'Transfer Received Date',
    'From Stock',
    'To Stock',
    'Product Code',
    'Product Name',
    'Transfer Quantity',
    'Serial Number',
    'IMEI Number',
    'Transfer Value ($)'
  ];

  const headerRow = worksheet.addRow(headers);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'medium', color: { argb: 'FF0284C7' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } }
    };
  });

  records.forEach((r) => {
    const dRow = worksheet.addRow([
      sanitizeForSpreadsheet(r.transfer_received_date || ''),
      sanitizeForSpreadsheet(r.from_stock || ''),
      sanitizeForSpreadsheet(r.to_stock || ''),
      sanitizeForSpreadsheet(r.product_code || ''),
      sanitizeForSpreadsheet(r.product_name || ''),
      r.transfer_quantity || 1,
      sanitizeForSpreadsheet(r.serial_number || ''),
      sanitizeForSpreadsheet(r.imei_number || ''),
      r.transfer_value || 0
    ]);
    dRow.height = 20;

    dRow.eachCell({ includeEmpty: true }, (cell, cNum) => {
      cell.font = { name: 'Arial', size: 9 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      if (cNum === 1) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 2) {
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF92400E' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 3) {
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF15803D' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 4) {
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 5) {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      } else if (cNum === 6) {
        cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0369A1' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 7 || cNum === 8) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum === 9) {
        cell.numFmt = '$#,##0.00';
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  });

  // Footer Row
  const footerRow = worksheet.addRow(['TOTAL', '', '', '', `${records.length} Total Records`, totalQty, '', '', totalVal]);
  footerRow.height = 24;
  footerRow.eachCell((cell, cNum) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    if (cNum === 9) {
      cell.numFmt = '$#,##0.00';
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    } else {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  });

  worksheet.getColumn(1).width = 16;
  worksheet.getColumn(2).width = 20;
  worksheet.getColumn(3).width = 20;
  worksheet.getColumn(4).width = 16;
  worksheet.getColumn(5).width = 30;
  worksheet.getColumn(6).width = 12;
  worksheet.getColumn(7).width = 24;
  worksheet.getColumn(8).width = 18;
  worksheet.getColumn(9).width = 16;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Stock_Transfers_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a sample template for Fixably Stock Transfers
 */
export function downloadSampleStockTransfersTemplate(format = 'xlsx') {
  const sample = [
    {
      'Transfer Received Date': '2026-06-08',
      'From Stock': 'VER_Repair',
      'To Stock': 'VER_MSPI-Owned',
      'Product Code': '661-21996',
      'Product Name': 'Battery, iPhone 13 Pro',
      'Transfer Quantity': 1,
      'Serial Number': 'F8Y5286C0GP13RHCF',
      'IMEI Number': '',
      'Transfer Value': 46
    },
    {
      'Transfer Received Date': '2026-06-08',
      'From Stock': 'GL5_MSPI-Owned',
      'To Stock': 'NES_MSPI-Owned',
      'Product Code': '661-05755',
      'Product Name': 'Battery, iPhone 7 Plus',
      'Transfer Quantity': 1,
      'Serial Number': 'F8Y416202VFH86CBA',
      'IMEI Number': '',
      'Transfer Value': 69
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sample);
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Reports_Stock_Transfers_Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock Transfers');
    XLSX.writeFile(wb, 'Reports_Stock_Transfers_Template.xlsx');
  }
}

/**
 * Export Comprehensive Multi-Tab Forecasting Report to Excel
 */
export async function exportForecastingReportToExcel(forecastItems = [], siteAllocations = [], metadata = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mobile Care Services Phils. Inc.';
  workbook.lastModifiedBy = 'MDC DC System 2';
  workbook.created = new Date();
  const periodLabel = metadata?.periodLabel || 'September 2026';

  // 1. Sheet 1: Master Forecast Ledger
  const ws1 = workbook.addWorksheet('Forecast Master Ledger', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  const resolveStockPrice = (item) => {
    if (!item) return 100;
    if (typeof item.stocking_price === 'number' && item.stocking_price > 0) return item.stocking_price;
    const desc = String(item.description || item.part_name || '').toLowerCase();
    if (desc.includes('display')) return 279;
    if (desc.includes('battery')) return 89;
    if (desc.includes('camera')) return 129;
    if (desc.includes('glass') || desc.includes('back')) return 99;
    if (desc.includes('rear') || desc.includes('mid')) return 119;
    return 100;
  };

  const totalForecastUnits = forecastItems.reduce((s, it) => s + (it.final_forecast ?? it.computed_forecast ?? 0), 0);
  const totalValuation = forecastItems.reduce((s, it) => {
    const qty = it.final_forecast ?? it.computed_forecast ?? 0;
    const price = resolveStockPrice(it);
    return s + (qty * price);
  }, 0);

  // Title Banner
  ws1.mergeCells('A1:L1');
  const tCell = ws1.getCell('A1');
  tCell.value = `MOBILE CARE SERVICES PHILS. INC. — Fixably Demand Forecasting Report (${periodLabel})`;
  tCell.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  tCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(1).height = 28;

  // KPI Row
  ws1.mergeCells('A2:D2');
  const k1 = ws1.getCell('A2');
  k1.value = `TOTAL PART MODELS: ${forecastItems.length} SKUs`;
  k1.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  k1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
  k1.alignment = { horizontal: 'center', vertical: 'middle' };

  ws1.mergeCells('E2:H2');
  const k2 = ws1.getCell('E2');
  k2.value = `TOTAL RECOMMENDED FORECAST: ${totalForecastUnits.toLocaleString()} units`;
  k2.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  k2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  k2.alignment = { horizontal: 'center', vertical: 'middle' };

  ws1.mergeCells('I2:L2');
  const k3 = ws1.getCell('I2');
  k3.value = `PROJECTED STOCK VALUATION: $${totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  k3.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
  k3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
  k3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(2).height = 22;

  const headers1 = [
    'Part Number',
    'Description',
    'iPhone Model',
    'Commodity',
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
    'Base Forecast',
    'Admin Override',
    'Final Forecast',
    'Stocking Price ($)',
    'Total Cost ($)'
  ];

  const headerRow1 = ws1.addRow(headers1);
  headerRow1.height = 26;
  headerRow1.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  forecastItems.forEach((it) => {
    const monthly = it.ytd_monthly_counts || [];
    const base = it.computed_forecast ?? 0;
    const override = it.admin_override ?? '';
    const finalVal = it.final_forecast ?? base;
    const price = resolveStockPrice(it);
    const cost = finalVal * price;

    const row = ws1.addRow([
      sanitizeForSpreadsheet(it.part_number || ''),
      sanitizeForSpreadsheet(it.description || ''),
      sanitizeForSpreadsheet(it.iphone_model || ''),
      sanitizeForSpreadsheet(it.category_name || (it.part_number?.startsWith('661-') ? 'Apple Part' : 'General')),
      monthly[0] || 0,
      monthly[1] || 0,
      monthly[2] || 0,
      monthly[3] || 0,
      monthly[4] || 0,
      monthly[5] || 0,
      monthly[6] || 0,
      monthly[7] || 0,
      base,
      override,
      finalVal,
      price,
      cost
    ]);
    row.height = 20;

    row.eachCell({ includeEmpty: true }, (cell, cNum) => {
      cell.font = { name: 'Arial', size: 9 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
      if (cNum >= 5 && cNum <= 15) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (cNum >= 16) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '$#,##0.00';
      }
    });
  });

  ws1.columns = [
    { width: 14 }, // PN
    { width: 28 }, // Desc
    { width: 20 }, // Model
    { width: 14 }, // Commodity
    { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }, // Months
    { width: 14 }, // Base
    { width: 14 }, // Override
    { width: 14 }, // Final
    { width: 16 }, // Price
    { width: 18 }  // Cost
  ];

  // 2. Sheet 2: Branch Demand Distribution
  if (siteAllocations && siteAllocations.length > 0) {
    const ws2 = workbook.addWorksheet('Branch Demand Matrix', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    ws2.mergeCells('A1:F1');
    const tCell2 = ws2.getCell('A1');
    tCell2.value = `MOBILE CARE SERVICES PHILS. INC. — Service Branch Demand Distribution (${periodLabel})`;
    tCell2.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    tCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    tCell2.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(1).height = 28;

    const headers2 = ['Branch Code', 'Branch Name', 'Region', 'Total Forecast Units', 'Projected Stock Value ($)', '% Share of DC Demand'];
    const hRow2 = ws2.addRow(headers2);
    hRow2.height = 26;
    hRow2.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    siteAllocations.forEach(site => {
      const row = ws2.addRow([
        sanitizeForSpreadsheet(site.code || ''),
        sanitizeForSpreadsheet(site.name || ''),
        sanitizeForSpreadsheet(site.region || 'Metro Manila'),
        site.totalUnits || 0,
        site.totalVal || 0,
        ((site.pct || 0) / 100)
      ]);
      row.height = 20;
      row.eachCell({ includeEmpty: true }, (cell, cNum) => {
        cell.font = { name: 'Arial', size: 9 };
        if (cNum === 4) cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (cNum === 5) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '$#,##0.00';
        }
        if (cNum === 6) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '0.0%';
        }
      });
    });

    ws2.columns = [
      { width: 14 },
      { width: 34 },
      { width: 18 },
      { width: 20 },
      { width: 24 },
      { width: 22 }
    ];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Fixably_Forecasting_Report_${periodLabel.replace(/\s+/g, '_')}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a sample template for Fixably Forecasting
 */
export function downloadSampleFixablyForecastingTemplate(format = 'xlsx') {
  const sample = [
    {
      'Part Number': '661-21991',
      'Description': 'Battery, iPhone 13',
      'Model': 'iPhone 13',
      'Commodity': 'Battery',
      'Jan': 42,
      'Feb': 38,
      'Mar': 45,
      'Apr': 50,
      'May': 48,
      'Jun': 52,
      'Jul': 55,
      'Aug': 58,
      'Stocking Price': 49.00
    },
    {
      'Part Number': '661-21988',
      'Description': 'Display, iPhone 13',
      'Model': 'iPhone 13',
      'Commodity': 'Display',
      'Jan': 28,
      'Feb': 24,
      'Mar': 30,
      'Apr': 32,
      'May': 31,
      'Jun': 35,
      'Jul': 34,
      'Aug': 38,
      'Stocking Price': 149.00
    },
    {
      'Part Number': '661-56050',
      'Description': 'Display, iPhone 17 Pro Max',
      'Model': 'iPhone 17 Pro Max',
      'Commodity': 'Display',
      'Jan': 10,
      'Feb': 15,
      'Mar': 20,
      'Apr': 25,
      'May': 30,
      'Jun': 35,
      'Jul': 42,
      'Aug': 48,
      'Stocking Price': 329.00
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sample);
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Fixably_Forecasting_Masterlist_Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Forecasting Masterlist');
    XLSX.writeFile(wb, 'Fixably_Forecasting_Masterlist_Template.xlsx');
  }
}


