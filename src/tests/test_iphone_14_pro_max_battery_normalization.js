import assert from 'assert';
import {
  CANONICAL_BATTERY_DESCS as CONFIG_BATTERY_DESCS,
  CANONICAL_SITE_LIST,
  normalizeCanonicalPartDescription
} from '../constants/config.js';
import {
  CANONICAL_BATTERY_DESCS as PARSER_BATTERY_DESCS,
  processRawUsageSheet,
  parseForecastingSheet,
  parseAllocationSheet
} from '../utils/excelParser.js';
import {
  sanitizeForecastItems,
  sanitizeAllocations
} from '../utils/allocationEngine.js';

console.log('====================================================================');
console.log('TEST SUITE: iPhone 14 Pro Max Battery SVC Removal & Allocation Fix');
console.log('====================================================================\n');

// 1. Canonical battery lists must exclude SVC,IPHONE 14 PRO MAX, BATTERY and include Battery, iPhone 14 Pro Max
assert.strictEqual(CONFIG_BATTERY_DESCS.includes('SVC,IPHONE 14 PRO MAX, BATTERY'), false, 'config.js must not include SVC,IPHONE 14 PRO MAX, BATTERY');
assert.strictEqual(PARSER_BATTERY_DESCS.includes('SVC,IPHONE 14 PRO MAX, BATTERY'), false, 'excelParser.js must not include SVC,IPHONE 14 PRO MAX, BATTERY');
assert.strictEqual(CONFIG_BATTERY_DESCS.includes('Battery, iPhone 14 Pro Max'), true, 'config.js must include Battery, iPhone 14 Pro Max');
assert.strictEqual(PARSER_BATTERY_DESCS.includes('Battery, iPhone 14 Pro Max'), true, 'excelParser.js must include Battery, iPhone 14 Pro Max');
assert.strictEqual(CONFIG_BATTERY_DESCS.length, 19, 'Canonical battery list has exactly 19 standard battery models');
console.log('  ✓ PASS: Canonical battery lists contain 19 standard models (SVC removed)');

// 2. normalizeCanonicalPartDescription maps all SVC variants of 661-30397 to standard description
assert.strictEqual(normalizeCanonicalPartDescription('SVC,IPHONE 14 PRO MAX, BATTERY', '661-30397'), 'Battery, iPhone 14 Pro Max');
assert.strictEqual(normalizeCanonicalPartDescription('SVC, IPHONE 14 PRO MAX, BATTERY', '661-30397'), 'Battery, iPhone 14 Pro Max');
assert.strictEqual(normalizeCanonicalPartDescription('SVC,BATTERY,IPHONE 14 PRO MAX', '661-30397'), 'Battery, iPhone 14 Pro Max');
assert.strictEqual(normalizeCanonicalPartDescription('Battery, iPhone 14 Pro Max', '661-30397'), 'Battery, iPhone 14 Pro Max');
assert.strictEqual(normalizeCanonicalPartDescription('Battery, iPhone 14 Pro', '661-30382'), 'Battery, iPhone 14 Pro');
console.log('  ✓ PASS: normalizeCanonicalPartDescription maps all SVC 14 Pro Max Battery variants cleanly');

// 3. processRawUsageSheet merges standard + SVC rows for 661-30397 into ONE Battery, iPhone 14 Pro Max with full allocations
const testSites = CANONICAL_SITE_LIST.map((s, idx) => ({
  id: `site-${idx + 1}`,
  code: s.code,
  name: s.name,
  is_dc: false,
  is_active: true
}));

const rawRows = [
  ['Location Name', 'Repair Number', 'Repair Closed Date', 'Product Code', 'Product Description', 'Quantity'],
  // Standard Battery, iPhone 14 Pro Max rows across Jan-Aug
  ['MOBILECARE - VERTIS NORTH', 'R1', '2026-01-10', '661-30397', 'Battery, iPhone 14 Pro Max', 10],
  ['MOBILECARE - GLORIETTA 5', 'R2', '2026-02-10', '661-30397', 'Battery, iPhone 14 Pro Max', 12],
  ['MOBILECARE - THE PODIUM', 'R3', '2026-03-10', '661-30397', 'Battery, iPhone 14 Pro Max', 14],
  ['MOBILECARE - APP FESTIVAL MALL', 'R4', '2026-04-10', '661-30397', 'Battery, iPhone 14 Pro Max', 16],
  ['MOBILECARE - VERTIS NORTH', 'R5', '2026-05-10', '661-30397', 'Battery, iPhone 14 Pro Max', 18],
  ['MOBILECARE - GLORIETTA 5', 'R6', '2026-06-10', '661-30397', 'Battery, iPhone 14 Pro Max', 20],
  ['MOBILECARE - S\'MAISON', 'R7', '2026-07-10', '661-30397', 'Battery, iPhone 14 Pro Max', 22],
  ['MOBILECARE - VERTIS NORTH', 'R8', '2026-08-10', '661-30397', 'Battery, iPhone 14 Pro Max', 24],
  // 1 stray SVC row in August (the exact real-world Fixably/GSX anomaly)
  ['MOBILECARE - CEBU', 'R9', '2026-08-15', '661-30397', 'SVC,IPHONE 14 PRO MAX, BATTERY', 1]
];

const processed = processRawUsageSheet(rawRows, testSites, [], {
  filterScope: 'IPHONE_13_PLUS_BATTERY_DISPLAY',
  fileName: 'September 2026.csv',
  allocationMode: 'OPTION_B',
  forecastingModel: 'linear'
});

const svcForecasts = processed.forecastItems.filter(f => /SVC/i.test(f.description));
assert.strictEqual(svcForecasts.length, 0, 'Zero SVC forecast rows should exist');

const batt14PmForecasts = processed.forecastItems.filter(f => f.part_number === '661-30397');
assert.strictEqual(batt14PmForecasts.length, 1, 'Exactly one 661-30397 forecast row should exist');
assert.strictEqual(batt14PmForecasts[0].description, 'Battery, iPhone 14 Pro Max');
assert.strictEqual(batt14PmForecasts[0].ytd_monthly_counts[7], 25, 'August count must merge 24 standard + 1 SVC = 25');
assert.ok(batt14PmForecasts[0].final_forecast > 0, `Forecast must be positive (got ${batt14PmForecasts[0].final_forecast})`);

const batt14PmAllocs = processed.allocations.filter(a => a.part_number === '661-30397');
assert.strictEqual(batt14PmAllocs.length, 1, 'Exactly one 661-30397 allocation row should exist');
assert.strictEqual(batt14PmAllocs[0].description, 'Battery, iPhone 14 Pro Max');
assert.strictEqual(batt14PmAllocs[0].total_allocated_qty, batt14PmForecasts[0].final_forecast, 'Total allocated qty must match forecast qty');
assert.ok(batt14PmAllocs[0].total_allocated_qty > 0, 'Allocation report for iPhone 14 Pro Max Battery must be non-zero');
console.log(`  ✓ PASS: processRawUsageSheet merged SVC into Battery, iPhone 14 Pro Max (Forecast: ${batt14PmForecasts[0].final_forecast}, Allocated: ${batt14PmAllocs[0].total_allocated_qty})`);

// 4. parseForecastingSheet merges duplicate 661-30397 rows instead of letting SVC overwrite standard
const forecastRows = [
  ['Part Number', 'Description', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
  ['661-30397', 'Battery, iPhone 14 Pro Max', 20, 22, 24, 26, 28, 30, 32, 34, 36],
  ['661-30397', 'SVC,IPHONE 14 PRO MAX, BATTERY', 0, 0, 0, 0, 0, 0, 0, 1, 1]
];
const parsedFc = parseForecastingSheet(forecastRows, 'IPHONE_13_PLUS_BATTERY_DISPLAY');
assert.strictEqual(parsedFc.forecastItems.length, 1, 'Duplicate 661-30397 rows must merge into 1 forecast item');
assert.strictEqual(parsedFc.forecastItems[0].description, 'Battery, iPhone 14 Pro Max');
assert.strictEqual(parsedFc.forecastItems[0].ytd_monthly_counts[7], 35, 'August counts must sum (34 + 1 = 35)');
assert.ok(parsedFc.forecastItems[0].final_forecast >= 35, `Merged forecast must be >= 35 (got ${parsedFc.forecastItems[0].final_forecast})`);
console.log(`  ✓ PASS: parseForecastingSheet merges duplicate 661-30397 rows cleanly (Forecast: ${parsedFc.forecastItems[0].final_forecast})`);

// 5. parseAllocationSheet normalizes SVC description to standard
const allocRows = [
  ['Commodity', 'P/N', 'Part Description', 'Forecasted Qty', 'Stocking Price', 'APP BHS', 'ASP VN'],
  ['BATTERY', '661-30397', 'SVC,IPHONE 14 PRO MAX, BATTERY', 10, 99, 4, 6]
];
const parsedAl = parseAllocationSheet(allocRows, testSites, 'IPHONE_13_PLUS_BATTERY_DISPLAY');
assert.strictEqual(parsedAl.allocations.length, 1);
assert.strictEqual(parsedAl.allocations[0].description, 'Battery, iPhone 14 Pro Max');
console.log('  ✓ PASS: parseAllocationSheet normalizes SVC 14 Pro Max Battery to standard description');

// 6. sanitizeForecastItems + sanitizeAllocations heal legacy cached/cloud snapshots
const legacyForecasts = [
  {
    part_id: 'part-661-30397',
    part_number: '661-30397',
    description: 'Battery, iPhone 14 Pro Max',
    category_id: 'cat-battery',
    stocking_price: 99,
    ytd_monthly_counts: [20, 22, 24, 26, 28, 30, 32, 34],
    computed_forecast: 36,
    final_forecast: 36
  },
  {
    part_id: 'part-661-30397',
    part_number: '661-30397',
    description: 'SVC,IPHONE 14 PRO MAX, BATTERY',
    category_id: 'cat-battery',
    stocking_price: 99,
    ytd_monthly_counts: [0, 0, 0, 0, 0, 0, 0, 1],
    computed_forecast: 0,
    final_forecast: 0
  }
];
const healedFc = sanitizeForecastItems(legacyForecasts, 'linear');
assert.strictEqual(healedFc.length, 1, 'sanitizeForecastItems merges duplicate 661-30397 items');
assert.strictEqual(healedFc[0].description, 'Battery, iPhone 14 Pro Max');
assert.strictEqual(healedFc[0].ytd_monthly_counts[7], 35);
assert.ok(healedFc[0].final_forecast > 0);

const brokenAllocs = [
  {
    part_id: 'part-661-30397',
    part_number: '661-30397',
    description: 'SVC,IPHONE 14 PRO MAX, BATTERY',
    category_id: 'cat-battery',
    stocking_price: 99,
    forecasted_qty: 0,
    total_allocated_qty: 0,
    site_quantities: {}
  }
];
const healedAllocs = sanitizeAllocations(brokenAllocs, testSites, healedFc, 'linear');
assert.strictEqual(healedAllocs.length, 1);
assert.strictEqual(healedAllocs[0].description, 'Battery, iPhone 14 Pro Max');
assert.strictEqual(healedAllocs[0].total_allocated_qty, healedFc[0].final_forecast, 'Repaired allocation must match healed forecast');
assert.ok(healedAllocs[0].total_allocated_qty > 0, 'Repaired allocation must distribute units across branches');
console.log(`  ✓ PASS: sanitizeForecastItems & sanitizeAllocations heal legacy SVC rows (Allocated: ${healedAllocs[0].total_allocated_qty})`);

console.log('\n====================================================================');
console.log('ALL IPHONE 14 PRO MAX BATTERY NORMALIZATION TESTS PASSED!');
console.log('====================================================================\n');
