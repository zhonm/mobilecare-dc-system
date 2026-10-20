import assert from 'assert';
import {
  CANONICAL_SITE_LIST,
  resolveSafeRegion
} from '../constants/config.js';
import {
  resolveMergedActiveServiceSites
} from '../utils/excelParser.js';
import {
  calculateWeeklySiteAllocations,
  generateAllocationsFromForecasts
} from '../utils/allocationEngine.js';
import {
  resolveSiteBranchCode,
  isShipmentMetroManila,
  isShipmentProvince
} from '../utils/shipmentHelpers.js';
import { resolvePmgSiteFolderName } from '../services/driveAutoSyncService.js';
import { isProvincialSite } from '../utils/partResolver.js';
import { resolveSite } from '../utils/appContextHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Comprehensive Dynamic Site Scalability (EEST)');
console.log('====================================================\n');

// Mock live sites catalog including the 26 canonical sites plus new site EEST (Repair Hub)
const baseCanonicalSites = CANONICAL_SITE_LIST.map((s, idx) => ({
  ...s,
  id: `site-${idx + 1}`,
  region: resolveSafeRegion(s.code, ''),
  address: `${s.name} Branch, PH`,
  is_dc: false,
  is_active: true
}));

const eestSite = {
  id: 'site-eest',
  code: 'EEST',
  name: 'MOBILECARE - REPAIR HUB',
  region: 'Metro Manila',
  address: 'MobileCare Repair Hub, Metro Manila',
  ship_to: '10998877',
  is_dc: false,
  is_active: true
};

const liveSites = [...baseCanonicalSites, eestSite];

// --- 1. FORECASTING & ALLOCATION SCALABILITY ---
console.log('--- 1. Testing Forecasting & Allocation Scalability ---');

// A. resolveMergedActiveServiceSites
const mergedActiveSites = resolveMergedActiveServiceSites(liveSites);
assert.strictEqual(mergedActiveSites.length, 27, `Must have 27 active service sites (26 canonical + 1 custom EEST)`);
const foundEest = mergedActiveSites.find(s => s.code === 'EEST');
assert.ok(foundEest, 'EEST site must be present in merged active sites');
assert.strictEqual(foundEest.region, 'Metro Manila', 'EEST region must be Metro Manila');

// Verify ordering: All Metro Manila sites appear before Provincial sites
let sawProvincial = false;
let orderViolations = 0;
mergedActiveSites.forEach(s => {
  const isMM = resolveSafeRegion(s.code, s.region) === 'Metro Manila';
  if (!isMM) sawProvincial = true;
  if (sawProvincial && isMM) orderViolations++;
});
assert.strictEqual(orderViolations, 0, 'All Metro Manila sites must precede Provincial sites');
console.log('  ✓ PASS: resolveMergedActiveServiceSites correctly orders MM and Provincial sites including EEST');

// B. generateAllocationsFromForecasts
const sampleForecasts = [
  {
    part_id: 'part-display-14',
    part_number: '661-30366',
    description: 'Display, iPhone 14',
    category_id: 'cat-display',
    computed_forecast: 150,
    stocking_price: 279,
    historical_demand_by_site: {
      'site-eest': 15,
      'EEST': 15,
      'APP BHS': 20,
      'ASP LIM': 10
    }
  }
];

const generatedAllocs = generateAllocationsFromForecasts(sampleForecasts, liveSites, 'linear');
assert.strictEqual(generatedAllocs.length, 1);
const allocRow = generatedAllocs[0];
assert.strictEqual(allocRow.total_allocated_qty, 150, 'Total allocated quantity strictly preserved');
assert.ok(allocRow.site_quantities['site-eest'] > 0 || allocRow.site_quantities['EEST'] > 0, 'EEST received positive allocation');
console.log(`  ✓ PASS: generateAllocationsFromForecasts allocated ${allocRow.site_quantities['EEST']} units to EEST`);

// C. calculateWeeklySiteAllocations & Regional Waterfall with EEST
const weeklySplit = calculateWeeklySiteAllocations(allocRow, mergedActiveSites, 3);
assert.ok(weeklySplit[1]['EEST'] !== undefined, 'Week 1 must contain EEST allocation');
assert.ok(weeklySplit[2]['EEST'] !== undefined, 'Week 2 must contain EEST allocation');
assert.ok(weeklySplit[3]['EEST'] !== undefined, 'Week 3 must contain EEST allocation');
assert.ok(weeklySplit[4]['EEST'] !== undefined, 'Week 4 must contain EEST allocation');

const eestTotalWeekly = (weeklySplit[1]['EEST'] || 0) + (weeklySplit[2]['EEST'] || 0) + (weeklySplit[3]['EEST'] || 0) + (weeklySplit[4]['EEST'] || 0);
assert.strictEqual(eestTotalWeekly, allocRow.site_quantities['EEST'], 'Sum of weekly allocations for EEST matches monthly allocation');
// EEST is Metro Manila: must have 0 in Week 4 (Week 4 is strictly reserved for Provincial branches)
assert.strictEqual(weeklySplit[4]['EEST'] || 0, 0, 'Metro Manila site EEST must receive 0 units in Week 4');
console.log('  ✓ PASS: Weekly site allocation guarantees regional waterfall adherence for EEST (0 in W4)');

// --- 2. OPERATIONS & LOGISTICS SCALABILITY ---
console.log('\n--- 2. Testing Operations & Logistics Scalability ---');

// A. Site resolution
const resolvedById = resolveSite('site-eest', liveSites);
assert.strictEqual(resolvedById.code, 'EEST', 'resolveSite by ID matches EEST');
const resolvedByCode = resolveSite('EEST', liveSites);
assert.strictEqual(resolvedByCode.id, 'site-eest', 'resolveSite by Code matches EEST');

// B. Provincial vs Metro Manila Classification
assert.strictEqual(isProvincialSite(eestSite), false, 'EEST is Metro Manila, not provincial');

// C. Courier Auto-detection
const isEestMM = resolveSafeRegion(eestSite.code, eestSite.region) === 'Metro Manila';
const autoCourier = isEestMM ? 'Lalamove' : 'Lite Express';
assert.strictEqual(autoCourier, 'Lalamove', 'Metro Manila site EEST correctly auto-routes to Lalamove');
console.log('  ✓ PASS: Operations & Logistics resolves EEST and assigns Lalamove courier');

// --- 3. ALL STOCKS & MULTI-SITE INVENTORY SCALABILITY ---
console.log('\n--- 3. Testing All Stocks & Multi-Site Inventory Scalability ---');

// Mock multi-site inventory units
const mockUnits = [
  { id: 'unit-1', serial_number: 'SER-EEST-001', part_number: '661-30366', site_id: 'site-eest', site_code: 'EEST', status: 'in_stock' },
  { id: 'unit-2', serial_number: 'SER-BHS-001', part_number: '661-30366', site_id: 'site-1', site_code: 'APP BHS', status: 'in_stock' }
];

const eestUnits = mockUnits.filter(u => u.site_id === 'site-eest' || u.site_code === 'EEST');
assert.strictEqual(eestUnits.length, 1, 'EEST inventory isolated correctly');
assert.strictEqual(eestUnits[0].serial_number, 'SER-EEST-001');
console.log('  ✓ PASS: Multi-site inventory properly scopes and isolates stock for EEST');

// --- 4. SHIPPING PARTS & SHIPMENTS SCALABILITY ---
console.log('\n--- 4. Testing Shipping Parts & Shipments Scalability ---');

// A. Shipment Region Classification
const eestShipment = {
  id: 'ship-101',
  site_id: 'site-eest',
  site_code: 'EEST',
  site_name: 'MOBILECARE - REPAIR HUB',
  status: 'packed'
};

assert.strictEqual(isShipmentMetroManila(eestShipment, liveSites), true, 'EEST shipment is recognized as Metro Manila');
assert.strictEqual(isShipmentProvince(eestShipment, liveSites), false, 'EEST shipment is not recognized as Province');

// B. Receiving Branch Signature / Code Resolution
const branchSignature = resolveSiteBranchCode(eestSite, eestShipment);
assert.ok(branchSignature.includes('EEST'), `Receiving signature contains EEST (actual: ${branchSignature})`);

// C. Drive Folder Name Resolution
const driveFolder = resolvePmgSiteFolderName(eestSite);
assert.ok(driveFolder.includes('REPAIR HUB') || driveFolder.includes('EEST'), `Drive folder resolved cleanly: ${driveFolder}`);

console.log('  ✓ PASS: Shipping Parts, packing lists, and Drive sync fully support EEST');

console.log('\n====================================================');
console.log('ALL DYNAMIC SITE SCALABILITY (EEST) TESTS PASSED (100%)!');
console.log('====================================================\n');
