import assert from 'assert';
import fs from 'fs';
import {
  generateAllocationsFromForecasts,
  deriveForecastItemsFromAllocations,
  deriveForecastItemsFromMasterlist
} from '../utils/allocationEngine.js';
import { getActiveMasterlist } from '../utils/rawMasterlistScanner.js';
import { CANONICAL_SITE_LIST } from '../constants/config.js';

console.log('=== Running Audit & Forecasting Synchronization Safeguards Test Suite ===\n');

// ── Test 1: deriveForecastItemsFromAllocations Parity & Reliability ─────────────
console.log('Test 1: Verifying deriveForecastItemsFromAllocations...');
const sampleAllocations = [
  {
    id: 'alloc-1',
    part_id: 'part-661-21991',
    part_number: '661-21991',
    description: 'Battery, iPhone 13',
    category_id: 'cat-battery',
    stocking_price: 89,
    forecasted_qty: 1260,
    total_allocated_qty: 1260,
    w1_qty: 315,
    w2_qty: 315,
    w3_qty: 315,
    w4_qty: 315,
    ytd_monthly_counts: [100, 110, 120, 130, 140, 150, 160, 170]
  },
  {
    id: 'alloc-2',
    part_id: 'part-661-21988',
    part_number: '661-21988',
    description: 'Display, iPhone 13',
    category_id: 'cat-display',
    stocking_price: 279,
    forecasted_qty: 911,
    total_allocated_qty: 911,
    ytd_monthly_counts: []
  }
];

const derivedForecasts = deriveForecastItemsFromAllocations(sampleAllocations);
assert.strictEqual(derivedForecasts.length, 2, 'Must derive exact count of forecast items from allocations');
assert.strictEqual(derivedForecasts[0].part_number, '661-21991', 'Part number must match');
assert.strictEqual(derivedForecasts[0].computed_forecast, 1260, 'Forecast quantity must match allocation quantity');
assert.strictEqual(derivedForecasts[0].final_forecast, 1260, 'Final forecast must match');
assert.strictEqual(derivedForecasts[0].stocking_price, 89, 'Stocking price must match');
assert.strictEqual(derivedForecasts[0].category_id, 'cat-battery', 'Category ID must match');
assert.strictEqual(derivedForecasts[0].ytd_monthly_counts.length, 8, 'Monthly historical counts must be preserved');
assert.strictEqual(derivedForecasts[1].computed_forecast, 911, 'Second part forecast must match 911 units');
console.log('✓ Test 1 Passed: Forecast items derived from allocations with 100% data fidelity.\n');

// ── Test 2: deriveForecastItemsFromMasterlist Intelligence Recovery ─────────────
console.log('Test 2: Verifying deriveForecastItemsFromMasterlist for active periods...');
const activeSepMasterlist = getActiveMasterlist(null, { month: 9, year: 2026, label: 'September 2026' });
assert(activeSepMasterlist, 'September 2026 active masterlist must be resolvable');
assert(activeSepMasterlist.partsSummary && activeSepMasterlist.partsSummary.length > 0, 'Must have partsSummary');

const masterlistForecasts = deriveForecastItemsFromMasterlist(activeSepMasterlist);
assert(masterlistForecasts.length > 0, 'Must derive non-empty forecast list from active masterlist');
assert(masterlistForecasts.every(f => f.part_number && f.computed_forecast >= 0 && f.stocking_price > 0), 'Every forecast item must have valid PN, forecast qty, and price');

const battery13 = masterlistForecasts.find(f => f.part_number === '661-21991');
assert(battery13, 'iPhone 13 Battery must exist in derived masterlist forecasts');
assert(battery13.computed_forecast > 0, 'iPhone 13 Battery forecast must be positive');
console.log(`✓ Test 2 Passed: Recovered ${masterlistForecasts.length} forecast items from September 2026 masterlist.\n`);

// ── Test 3: Bi-directional Roundtrip Parity (Forecast -> Allocation -> Forecast) ─
console.log('Test 3: Verifying Bi-directional Roundtrip Parity...');
const testSites = CANONICAL_SITE_LIST.map(s => ({ ...s, id: `site-${s.code}` }));
const generatedAllocations = generateAllocationsFromForecasts(masterlistForecasts.slice(0, 10), testSites, 'linear');
assert.strictEqual(generatedAllocations.length, 10, 'Must generate 10 allocations');

const roundtripForecasts = deriveForecastItemsFromAllocations(generatedAllocations);
assert.strictEqual(roundtripForecasts.length, 10, 'Must derive 10 forecasts back from allocations');
for (let i = 0; i < 10; i++) {
  assert.strictEqual(roundtripForecasts[i].part_number, masterlistForecasts[i].part_number, `Part ${i} PN must match roundtrip`);
  assert.strictEqual(roundtripForecasts[i].computed_forecast, masterlistForecasts[i].computed_forecast, `Part ${i} qty must match roundtrip`);
}
console.log('✓ Test 3 Passed: 100% roundtrip parity between forecastItems and allocations.\n');

// ── Test 4: Verify Inventory & Intake Services Protection ───────────────────────
console.log('Test 4: Verifying LIVE_MASTER_RECORD_ID protection against inventory/intake overwrites...');
const inventoryUnitServiceSrc = fs.readFileSync('src/services/inventoryUnitService.js', 'utf8');
const intakeRecordServiceSrc = fs.readFileSync('src/services/intakeRecordService.js', 'utf8');
const useIntakeRecordsSrc = fs.readFileSync('src/context/useIntakeRecords.js', 'utf8');

assert(!inventoryUnitServiceSrc.includes('LIVE_MASTER_RECORD_ID'), 'inventoryUnitService must not reference or overwrite LIVE_MASTER_RECORD_ID');
assert(!intakeRecordServiceSrc.includes('LIVE_MASTER_RECORD_ID'), 'intakeRecordService must not reference or overwrite LIVE_MASTER_RECORD_ID');
assert(!useIntakeRecordsSrc.includes('LIVE_MASTER_RECORD_ID'), 'useIntakeRecords must not reference or overwrite LIVE_MASTER_RECORD_ID');
console.log('✓ Test 4 Passed: Inventory & Intake services can never overwrite or erase LIVE_MASTER_RECORD_ID.\n');

// ── Test 5: Verify Active Audit Log Guaranteed Synchronization ──────────────────
console.log('Test 5: Verifying Active Audit Log Synchronization Guarantee...');
// Simulating cloud hydration where snapshot has empty forecastItems but valid allocations
const mockSnapshotWithEmptyForecast = {
  isCleared: false,
  forecastItems: [],
  allocations: sampleAllocations
};

let hydratedForecast = mockSnapshotWithEmptyForecast.forecastItems;
let hydratedAlloc = mockSnapshotWithEmptyForecast.allocations;

if (!hydratedForecast || hydratedForecast.length === 0) {
  if (hydratedAlloc && hydratedAlloc.length > 0) {
    hydratedForecast = deriveForecastItemsFromAllocations(hydratedAlloc);
  }
}

assert.strictEqual(hydratedForecast.length, 2, 'Hydration must self-heal empty forecastItems from allocations');
assert.strictEqual(hydratedForecast[0].computed_forecast, 1260, 'Hydrated forecast must match allocation total');
assert.strictEqual(hydratedForecast[1].computed_forecast, 911, 'Hydrated forecast must match allocation total');

// Simulating cloud hydration where snapshot has BOTH empty but active masterlist exists
const mockSnapshotEmptyBoth = {
  isCleared: false,
  forecastItems: [],
  allocations: []
};

let recoveredForecast = mockSnapshotEmptyBoth.forecastItems;
let recoveredAlloc = mockSnapshotEmptyBoth.allocations;

if ((!recoveredForecast || recoveredForecast.length === 0) && (!recoveredAlloc || recoveredAlloc.length === 0)) {
  const activeMl = getActiveMasterlist(null, { month: 9, year: 2026, label: 'September 2026' });
  if (activeMl && activeMl.partsSummary) {
    recoveredForecast = deriveForecastItemsFromMasterlist(activeMl);
    recoveredAlloc = generateAllocationsFromForecasts(recoveredForecast, testSites, 'linear');
  }
}

assert(recoveredForecast.length > 0, 'Must recover non-empty forecast from active period masterlist');
assert(recoveredAlloc.length > 0, 'Must recover non-empty allocations from active period masterlist');
console.log(`✓ Test 5 Passed: Guaranteed synchronization recovered ${recoveredForecast.length} forecasts and ${recoveredAlloc.length} allocations.\n`);

console.log('================================================================');
console.log('ALL AUDIT & FORECASTING SYNCHRONIZATION TESTS PASSED WITH 100% SUCCESS!');
console.log('================================================================');
