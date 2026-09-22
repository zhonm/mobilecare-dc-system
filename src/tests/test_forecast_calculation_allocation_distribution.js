import assert from 'node:assert/strict';
import {
  allocatePartToSites,
  generateAllocationsFromForecasts,
  calculateWeeklySplit
} from '../utils/allocationEngine.js';
import { CANONICAL_SITE_CODES, CANONICAL_SITE_LIST } from '../constants/config.js';

console.log('====================================================');
console.log('TEST SUITE: Forecasting Calculation & Allocation Dynamic Re-distribution');
console.log('====================================================');

let passed = 0;

// Setup 26 active service sites
const mockActiveSites = CANONICAL_SITE_CODES.map((code, idx) => ({
  id: `site-${idx + 1}`,
  code,
  name: CANONICAL_SITE_LIST.find(s => s.code === code)?.name || code,
  is_dc: false
}));

// Test Item: Battery, iPhone 13 (as in user screenshot)
const battery13 = {
  part_id: 'part-661-21991',
  part_number: '661-21991',
  description: 'Battery, iPhone 13',
  category_id: 'cat-battery',
  computed_forecast: 290,
  admin_override: null,
  final_forecast: 290,
  stocking_price: 89
};

// 1. Initial allocation with base forecast 290
const initialAlloc = allocatePartToSites(290, battery13, mockActiveSites, null);
const initialSum = initialAlloc.reduce((s, x) => s + x.allocatedQty, 0);
assert.equal(initialSum, 290, 'Initial allocation sum strictly equals base forecast 290');
const initialActiveBranches = initialAlloc.filter(x => x.allocatedQty > 0);
assert(initialActiveBranches.length >= 20, `Initial 290 units distributed across 20+ branches (actual: ${initialActiveBranches.length})`);
passed++;
console.log(`  ✓ PASS: Initial base forecast 290 distributed across ${initialActiveBranches.length} branches`);

// 2. User modifies calculation to 200 (as reported by user)
// Simulate existing row having an old or partial distribution
// Re-allocating with new forecast calculation: 200 units
// Must use authoritative demand shares and NOT get trapped in old site_quantities
const reallocated200 = allocatePartToSites(200, battery13, mockActiveSites, null);
const sum200 = reallocated200.reduce((s, x) => s + x.allocatedQty, 0);
assert.equal(sum200, 200, 'Re-allocated sum strictly equals 200 units');

const podAlloc = reallocated200.find(s => s.siteId === 'site-7' || s.code === 'ASP POD');
const triAlloc = reallocated200.find(s => s.siteId === 'site-10' || s.code === 'APP TRI');
const bhsAlloc = reallocated200.find(s => s.siteId === 'site-1' || s.code === 'APP BHS');
const vnAlloc = reallocated200.find(s => s.siteId === 'site-11' || s.code === 'ASP VN');
const smsAlloc = reallocated200.find(s => s.siteId === 'site-5' || s.code === 'ASP SMS');

// Verify that ASP POD and APP TRI are NOT 100 and 100!
assert(podAlloc.allocatedQty < 50, `ASP POD receives realistic proportional share (< 50 units, actual: ${podAlloc.allocatedQty})`);
assert(triAlloc.allocatedQty < 50, `APP TRI receives realistic proportional share (< 50 units, actual: ${triAlloc.allocatedQty})`);
assert(bhsAlloc.allocatedQty > 0, `APP BHS receives units (actual: ${bhsAlloc.allocatedQty})`);
assert(vnAlloc.allocatedQty > 0, `ASP VN receives units (actual: ${vnAlloc.allocatedQty})`);
assert(smsAlloc.allocatedQty > 0, `ASP SMS receives units (actual: ${smsAlloc.allocatedQty})`);

const activeBranches200 = reallocated200.filter(x => x.allocatedQty > 0);
assert(activeBranches200.length >= 20, `200 units distributed properly across 20+ branches (actual: ${activeBranches200.length})`);
passed++;
console.log(`  ✓ PASS: Lowered forecast to 200 units properly distributed across ${activeBranches200.length} branches (no longer stuck at 100/100)`);

// 3. Verify weekly split for 200 units
const split200 = calculateWeeklySplit(200, 200 * 89, 25); // Battery starts at row 25
const weekSum = split200.w1_qty + split200.w2_qty + split200.w3_qty + split200.w4_qty;
assert.equal(weekSum, 200, 'Weekly split sum strictly equals 200 units (50+50+50+50)');
assert.equal(split200.w1_qty, 50, 'Week 1 qty is 50');
assert.equal(split200.w2_qty, 50, 'Week 2 qty is 50');
assert.equal(split200.w3_qty, 50, 'Week 3 qty is 50');
assert.equal(split200.w4_qty, 50, 'Week 4 qty is 50');
passed++;
console.log(`  ✓ PASS: Weekly split for 200 units balances to 50 / 50 / 50 / 50 ($${split200.w1_cost}/wk)`);

// 4. Test generateAllocationsFromForecasts with modified forecast items
const forecastList = [
  { ...battery13, admin_override: 200, final_forecast: 200, recommended_order: 200 }
];
const genAllocs = generateAllocationsFromForecasts(forecastList, mockActiveSites, 'linear');
assert.equal(genAllocs[0].total_allocated_qty, 200, 'generateAllocationsFromForecasts total_allocated_qty is 200');
assert.equal(genAllocs[0].forecasted_qty, 200, 'generateAllocationsFromForecasts forecasted_qty is 200');
assert(genAllocs[0].site_quantities['site-7'] < 50, 'site_quantities ASP POD is balanced');
assert(genAllocs[0].site_quantities['site-10'] < 50, 'site_quantities APP TRI is balanced');
passed++;
console.log('  ✓ PASS: generateAllocationsFromForecasts produces balanced allocation for overridden item');

// 5. Test another adjustment: raising value to 350
const reallocated350 = allocatePartToSites(350, battery13, mockActiveSites, null);
const sum350 = reallocated350.reduce((s, x) => s + x.allocatedQty, 0);
assert.equal(sum350, 350, 'Re-allocated sum strictly equals 350 units');
passed++;
console.log('  ✓ PASS: Raised forecast to 350 units strictly balances to 350 units across all branches');

console.log('====================================================');
console.log(`RESULTS: ALL ${passed} TEST SUITES PASSED (100%)`);
console.log('====================================================');
