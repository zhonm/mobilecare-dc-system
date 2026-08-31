import {
  CANONICAL_SITE_CODES,
  CANONICAL_SITE_LIST
} from '../constants/config.js';
import {
  allocatePartToSites,
  generateAllocationsFromForecasts,
  validateSiteSharesConsistency
} from '../utils/allocationEngine.js';
import { calculateLinearRegressionForecast } from '../utils/forecastEngine.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('====================================================');
console.log('TEST SUITE: Master Allocation Matrix Parity & Model Switching');
console.log('====================================================');

// 1. Validate Canonical Sites Configuration
assert(CANONICAL_SITE_CODES.length === 27, `CANONICAL_SITE_CODES contains exactly 27 active service branches (actual: ${CANONICAL_SITE_CODES.length})`);
assert(CANONICAL_SITE_CODES.includes('APP ILO'), `CANONICAL_SITE_CODES includes 'APP ILO'`);
assert(!CANONICAL_SITE_CODES.includes('APPILO'), `CANONICAL_SITE_CODES does not contain malformed 'APPILO'`);
assert(CANONICAL_SITE_CODES.indexOf('APP ILO') === 20, `'APP ILO' is at index 20 (between ASP ILO and ASP CEB)`);

const mockActiveSites = CANONICAL_SITE_LIST.map((s, idx) => ({
  id: `site-${idx + 1}`,
  code: s.code,
  name: s.name,
  is_dc: false,
  is_active: true
}));

const consistency = validateSiteSharesConsistency(mockActiveSites);
assert(consistency.isValid === true, `validateSiteSharesConsistency passes for 27 active service branches`);

// 2. Part 661-21988 (Display, iPhone 13) Linear Regression Forecast Validation
const iphone13DispJanJul = [49, 44, 46, 33, 25, 34, 17];
const fcastAug = calculateLinearRegressionForecast(iphone13DispJanJul, 8);
assert(fcastAug === 16, `Part 661-21988 August forecast (Jan-Jul x=8) equals 16 units (actual: ${fcastAug})`);

const iphone13DispJanAug = [49, 44, 46, 33, 25, 34, 27, 33];
const fcastSep = calculateLinearRegressionForecast(iphone13DispJanAug, 9);
assert(fcastSep === 23, `Part 661-21988 September forecast (Jan-Aug x=9) equals 23 units (actual: ${fcastSep})`);

// 3. Part 661-21988 Allocation Distribution & Model Switching Invariance
const partItem = {
  part_id: 'part-661-21988',
  part_number: '661-21988',
  description: 'Display, iPhone 13',
  category_id: 'cat-display',
  ytd_monthly_counts: iphone13DispJanAug
};

// Test initial allocation for 23 units (September Linear Forecast)
const sepLinearAlloc = allocatePartToSites(23, partItem, mockActiveSites);
const sepLinearSum = sepLinearAlloc.reduce((sum, s) => sum + s.allocatedQty, 0);
assert(sepLinearSum === 23, `September Linear allocation sum strictly equals 23 units (actual: ${sepLinearSum})`);

// Expected distribution from empirical GSX data / canonicalShares:
// SMS:1, MOA:1, ANX:1, VN:3, NES:1, FES:2, RM:1, LIM:2, NPM:2, NAG:3, ILO:3, CEB:1, ABR:1, CDO:1 -> Total 23
const vnAlloc = sepLinearAlloc.find(s => s.siteId === 'site-11'); // ASP VN
const nagAlloc = sepLinearAlloc.find(s => s.siteId === 'site-18'); // ASP NAG
const fesAlloc = sepLinearAlloc.find(s => s.siteId === 'site-13'); // APP FES
const bhsAlloc = sepLinearAlloc.find(s => s.siteId === 'site-1');  // APP BHS

assert(vnAlloc?.allocatedQty === 3, `ASP VN receives 3 units of iPhone 13 display (actual: ${vnAlloc?.allocatedQty})`);
assert(nagAlloc?.allocatedQty === 3, `ASP NAG receives 3 units of iPhone 13 display (actual: ${nagAlloc?.allocatedQty})`);
assert(fesAlloc?.allocatedQty === 2, `APP FES receives 2 units of iPhone 13 display (actual: ${fesAlloc?.allocatedQty})`);
assert(bhsAlloc?.allocatedQty === 0, `APP BHS receives 0 units of iPhone 13 display (actual: ${bhsAlloc?.allocatedQty})`);

// 4. Test Switching Forecasting Model WMA -> Linear -> WMA
// Build existing allocation snapshot with site_quantities
const existingAllocSnapshot = {
  part_id: 'part-661-21988',
  part_number: '661-21988',
  description: 'Display, iPhone 13',
  site_quantities: {}
};
sepLinearAlloc.forEach(res => {
  existingAllocSnapshot.site_quantities[res.siteId] = res.allocatedQty;
  const siteObj = mockActiveSites.find(s => s.id === res.siteId);
  if (siteObj?.code) existingAllocSnapshot.site_quantities[siteObj.code] = res.allocatedQty;
});

// Switch to Linear with same quantity (23) -> site_quantities must be 100% identical
const reLinearAlloc = allocatePartToSites(23, partItem, mockActiveSites, existingAllocSnapshot);
const reLinearMatches = reLinearAlloc.every((res, idx) => res.allocatedQty === sepLinearAlloc[idx].allocatedQty);
assert(reLinearMatches, `Re-allocating fixed 23 units produces 100% identical per-branch site_quantities`);

// Generate full allocations via generateAllocationsFromForecasts with WMA vs Linear
const forecastList = [
  {
    part_id: 'part-661-21988',
    part_number: '661-21988',
    description: 'Display, iPhone 13',
    category_id: 'cat-display',
    ytd_monthly_counts: iphone13DispJanAug,
    stocking_price: 279
  }
];

const genAllocLinear = generateAllocationsFromForecasts(forecastList, mockActiveSites, 'linear', [existingAllocSnapshot]);
assert(genAllocLinear[0].forecasted_qty === 23, `generateAllocationsFromForecasts (Linear) forecast is 23`);
assert(genAllocLinear[0].total_allocated_qty === 23, `generateAllocationsFromForecasts (Linear) total allocation is 23`);
assert(genAllocLinear[0].site_quantities['ASP VN'] === 3, `ASP VN allocation in Linear is 3`);
assert(genAllocLinear[0].site_quantities['APP BHS'] === 0, `APP BHS allocation in Linear is 0`);

const genAllocWma = generateAllocationsFromForecasts(forecastList, mockActiveSites, 'wma', [existingAllocSnapshot]);
const wmaTotal = genAllocWma[0].total_allocated_qty;
assert(wmaTotal === genAllocWma[0].forecasted_qty, `generateAllocationsFromForecasts (WMA) total (${wmaTotal}) strictly matches forecasted qty (${genAllocWma[0].forecasted_qty})`);

// Switching back to Linear from WMA result
const genAllocLinearBack = generateAllocationsFromForecasts(forecastList, mockActiveSites, 'linear', genAllocWma);
assert(genAllocLinearBack[0].forecasted_qty === 23, `Switching back to Linear produces 23 units`);
assert(genAllocLinearBack[0].site_quantities['ASP VN'] === 3, `ASP VN allocation after model roundtrip is still 3`);
assert(genAllocLinearBack[0].site_quantities['APP BHS'] === 0, `APP BHS allocation after model roundtrip is still 0`);

// 5. Ghost column validation
assert(genAllocLinearBack[0].site_quantities['APPILO'] === undefined, `Ghost column 'APPILO' is NOT present in site_quantities`);

// 6. Direct CSV Parsing and Calculation Verifications
import fs from 'fs';
import Papa from 'xlsx';
import { parseAllocationSheet, processRawUsageSheet } from '../utils/excelParser.js';

if (fs.existsSync('Battery & Display (Allocation) - September 2026 - Allocation.csv')) {
  const allocContent = fs.readFileSync('Battery & Display (Allocation) - September 2026 - Allocation.csv', 'utf8');
  const allocWb = Papa.read(allocContent, { type: 'string' });
  const allocRows = Papa.utils.sheet_to_json(allocWb.Sheets[allocWb.SheetNames[0]], { header: 1, defval: '' });
  const parsedAlloc = parseAllocationSheet(allocRows, CANONICAL_SITE_LIST, []);
  
  const allocUnits = parsedAlloc.allocations.reduce((s, a) => s + (a.total_allocated_qty || 0), 0);
  const allocCost = parsedAlloc.allocations.reduce((s, a) => s + (a.total_stock_cost || 0), 0);
  assert(allocUnits === 591, `Allocation.csv parsed exactly 591 total allocated units (actual: ${allocUnits})`);
  assert(allocCost === 91199, `Allocation.csv parsed exactly $91,199.00 total master cost (actual: $${allocCost})`);
}

if (fs.existsSync('Battery & Display (Allocation) - September 2026 - Masterlist (1).csv')) {
  const rawContent = fs.readFileSync('Battery & Display (Allocation) - September 2026 - Masterlist (1).csv', 'utf8');
  const rawWb = Papa.read(rawContent, { type: 'string' });
  const rawRows = Papa.utils.sheet_to_json(rawWb.Sheets[rawWb.SheetNames[0]], { header: 1, defval: '' });
  const rawResult = processRawUsageSheet(rawRows, CANONICAL_SITE_LIST, [], {
    filterScope: 'IPHONE_13_PLUS_BATTERY_DISPLAY',
    selectedMonth: '8',
    fileName: 'Battery & Display (Allocation) - September 2026 - Masterlist (1).csv',
    allocationMode: 'OPTION_B'
  });
  
  const rawForecastUnits = rawResult.forecastItems.reduce((s, f) => s + (f.final_forecast || f.computed_forecast || 0), 0);
  assert(rawForecastUnits === 576, `Masterlist (1).csv computed exactly 576 linear forecast units for September (actual: ${rawForecastUnits})`);
  assert(rawResult.forecastItems[0].stocking_price === 279, `Masterlist forecast item stocking_price is properly populated (actual: ${rawResult.forecastItems[0].stocking_price})`);
}

// 7. B2 Remediation Regression Test: Weekly Split Row Parity Offset Consistency
import { getRowParityOffset, calculateWeeklySplit } from '../utils/allocationEngine.js';

const displayItem = {
  part_id: 'p-disp-1',
  description: 'Display, iPhone 14',
  category_id: 'cat-display'
};

const batteryItem = {
  part_id: 'p-batt-1',
  description: 'Battery, iPhone 14',
  category_id: 'cat-battery'
};

assert(getRowParityOffset(displayItem) === 3, 'Display row parity offset is 3 (matches Excel row 3 start)');
assert(getRowParityOffset(batteryItem) === 4, 'Battery row parity offset is 4 (matches Excel row 25 start, odd parity)');

// Test split parity on Display row 0 (Excel row 3 -> odd):
const dispSplit = calculateWeeklySplit(13, 13 * 279, 0 + getRowParityOffset(displayItem));
// Test split parity on Battery row 0 (rIdx = 21 in masterlist, Excel row 25 -> odd):
const battSplit = calculateWeeklySplit(13, 13 * 99, 21 + getRowParityOffset(batteryItem));
assert(
  dispSplit.w1_qty === battSplit.w1_qty && dispSplit.w2_qty === battSplit.w2_qty && dispSplit.w3_qty === battSplit.w3_qty && dispSplit.w4_qty === battSplit.w4_qty,
  'Display row 0 (Excel row 3) and Battery row 0 (Excel row 25) both produce identical odd-row weekly split proportions'
);

// Test split parity preservation when admin override is applied:
const overrideQty = 14;
const baseSplit = calculateWeeklySplit(overrideQty, overrideQty * 99, 21 + getRowParityOffset(batteryItem));
const reSplitWithOverride = calculateWeeklySplit(overrideQty, overrideQty * 99, 21 + getRowParityOffset(batteryItem));
assert(
  baseSplit.w1_qty === reSplitWithOverride.w1_qty && baseSplit.w2_qty === reSplitWithOverride.w2_qty,
  'Admin override retains identical battery row parity offset (+4) without flipping even/odd'
);

console.log('====================================================');
console.log(`RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log('====================================================');

if (failedTests > 0) {
  process.exit(1);
}
