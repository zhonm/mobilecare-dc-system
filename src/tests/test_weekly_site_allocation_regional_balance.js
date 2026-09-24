import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

import {
  CANONICAL_SITE_LIST,
  resolveSafeRegion
} from '../constants/config.js';
import {
  calculateWeeklySiteAllocations
} from '../utils/allocationEngine.js';

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

console.log('====================================================================');
console.log('TEST SUITE: Regional Weekly Site Allocation & Freight Optimization');
console.log('====================================================================');

// --- 1. Regional Partitioning Verification ---
console.log('\n--- 1. REGIONAL SITE PARTITIONING (METRO MANILA VS PROVINCIAL) ---');
const mmSites = CANONICAL_SITE_LIST.filter(s => resolveSafeRegion(s.code, s.region) === 'Metro Manila');
const provSites = CANONICAL_SITE_LIST.filter(s => resolveSafeRegion(s.code, s.region) !== 'Metro Manila');

assert(mmSites.length === 15, `Identified exactly 15 Metro Manila service sites (actual: ${mmSites.length})`);
assert(provSites.length === 11, `Identified exactly 11 Provincial service sites (actual: ${provSites.length})`);
assert(mmSites.length + provSites.length === 26, `Total active service sites equals 26 (actual: ${mmSites.length + provSites.length})`);

const expectedMMCodes = [
  'APP BHS', 'APP GB3', 'APP PPM', 'ASP GL5', 'ASP SMS', 'APP MOA', 'ASP POD',
  'APP MEG', 'APP ANX', 'APP TRI', 'ASP VN', 'ASP NES', 'APP FES', 'ASP MRK', 'APP RM'
];
const allMMMatched = expectedMMCodes.every(code => mmSites.some(s => s.code === code));
assert(allMMMatched, 'All 15 designated Metro Manila site codes match canonical reference list');

// --- 2. Invariant Conservation: Row Sum & Column Sum ---
console.log('\n--- 2. INVARIANT CONSERVATION (SUM OF WEEKS === MONTHLY, SUM OF SITES === WEEKLY TARGET) ---');

const activeSites = CANONICAL_SITE_LIST.map(s => ({
  id: `site-${s.code.toLowerCase().replace(/[\s\W]+/g, '-')}`,
  code: s.code,
  name: s.name,
  region: resolveSafeRegion(s.code)
}));

// Test Item 1: High demand item with 26 sites
const sampleQuantities = [
  8, 12, 10, 25, 30, 11, 22, 10, 15, 18, 45, 12, 28, 16, 11, // 15 Metro Manila sites = 273
  2, 3, 1, 2, 3, 2, 1, 3, 1, 2, 1 // 11 Provincial sites = 21 (Total = 294)
];
const sampleItem1 = {
  description: 'Battery, iPhone 13',
  stocking_price: 99,
  total_allocated_qty: 294,
  w1_qty: 91, w2_qty: 91, w3_qty: 91, w4_qty: 21,
  site_quantities: {}
};
activeSites.forEach((s, idx) => {
  sampleItem1.site_quantities[s.id] = sampleQuantities[idx];
  sampleItem1.site_quantities[s.code] = sampleQuantities[idx];
});

const alloc1 = calculateWeeklySiteAllocations(sampleItem1, activeSites, 0);

// Check column sums for Week 1..4
const w1Sum1 = activeSites.reduce((sum, s) => sum + alloc1[1][s.id], 0);
const w2Sum1 = activeSites.reduce((sum, s) => sum + alloc1[2][s.id], 0);
const w3Sum1 = activeSites.reduce((sum, s) => sum + alloc1[3][s.id], 0);
const w4Sum1 = activeSites.reduce((sum, s) => sum + alloc1[4][s.id], 0);

assert(w1Sum1 === 91, `Week 1 site sum strictly matches target 91 (actual: ${w1Sum1})`);
assert(w2Sum1 === 91, `Week 2 site sum strictly matches target 91 (actual: ${w2Sum1})`);
assert(w3Sum1 === 91, `Week 3 site sum strictly matches target 91 (actual: ${w3Sum1})`);
assert(w4Sum1 === 21, `Week 4 site sum strictly matches target 21 (actual: ${w4Sum1})`);

// Check row sums across all 26 sites
let allRowsPreserved1 = true;
activeSites.forEach(s => {
  const rowSum = alloc1[1][s.id] + alloc1[2][s.id] + alloc1[3][s.id] + alloc1[4][s.id];
  const expected = sampleItem1.site_quantities[s.id];
  if (rowSum !== expected) allRowsPreserved1 = false;
});
assert(allRowsPreserved1, 'All 26 sites have exact monthly total preservation (sum(W1..W4) === monthlyQty)');

// --- 3. Regional Prioritization Verification ---
console.log('\n--- 3. REGIONAL PRIORITIZATION: W1/W2 METRO MANILA VS W3/W4 PROVINCIAL ---');

const mmW12Units = mmSites.reduce((sum, s) => sum + alloc1[1][s.code] + alloc1[2][s.code], 0);
const provW12Units = provSites.reduce((sum, s) => sum + alloc1[1][s.code] + alloc1[2][s.code], 0);
const provW34Units = provSites.reduce((sum, s) => sum + alloc1[3][s.code] + alloc1[4][s.code], 0);
const mmW4Units = mmSites.reduce((sum, s) => sum + alloc1[4][s.code], 0);

assert(provW12Units === 0, `Provincial sites receive 0 parts in Weeks 1 & 2 (actual: ${provW12Units})`);
assert(provW34Units === 21, `Provincial sites receive all their parts in Weeks 3 & 4 (actual: ${provW34Units}/21)`);
assert(mmW12Units === (91 + 91), `Metro Manila sites fulfill 100% of Weeks 1 & 2 quotas (actual: ${mmW12Units}/182)`);
assert(mmW4Units === 0, `Metro Manila parts do NOT appear in Week 4 (actual: ${mmW4Units} === 0)`);

// --- 4. Single-Part (1-Part) Shipment Minimization ---
console.log('\n--- 4. SINGLE-PART SHIPMENT REDUCTION & CONSOLIDATION ---');

// Test with 1-unit provincial demand
const singleProvItem = {
  description: 'Display, iPhone 14 Pro',
  total_allocated_qty: 4,
  w1_qty: 1, w2_qty: 1, w3_qty: 1, w4_qty: 1,
  site_quantities: {
    'APP BHS': 1,
    'ASP GL5': 1,
    'ASP VN': 1,
    'ASP NAG': 1 // Provincial site in Naga
  }
};
const singleProvAlloc = calculateWeeklySiteAllocations(singleProvItem, activeSites, 0);

assert(singleProvAlloc[1]['ASP NAG'] === 0, 'Provincial site ASP NAG receives 0 parts in Week 1');
assert(singleProvAlloc[2]['ASP NAG'] === 0, 'Provincial site ASP NAG receives 0 parts in Week 2');
assert(
  singleProvAlloc[3]['ASP NAG'] + singleProvAlloc[4]['ASP NAG'] === 1,
  'Provincial site ASP NAG receives its 1 unit consolidated into Week 3 or Week 4'
);

// --- 5. Full Validation on Live Master_Allocation_October_2026.xlsx ---
console.log('\n--- 5. LIVE VALIDATION ON MASTER_ALLOCATION_OCTOBER_2026.XLSX ---');

const wb = XLSX.readFile('Master_Allocation_October_2026.xlsx');
assert(wb.SheetNames.includes('Master Allocation'), 'Sheet "Master Allocation" exists in exported workbook');
assert(wb.SheetNames.includes('Week 1'), 'Sheet "Week 1" exists');
assert(wb.SheetNames.includes('Week 2'), 'Sheet "Week 2" exists');
assert(wb.SheetNames.includes('Week 3'), 'Sheet "Week 3" exists');
assert(wb.SheetNames.includes('Week 4'), 'Sheet "Week 4" exists');

const masterWs = wb.Sheets['Master Allocation'];
const masterData = XLSX.utils.sheet_to_json(masterWs, { header: 1 });
const masterHeaders = masterData[3];
const siteMonthlyDemands = {};
for (let c = 5; c <= 30; c++) {
  const code = masterHeaders[c];
  siteMonthlyDemands[code] = 0;
  for (let r = 4; r < masterData.length; r++) {
    const row = masterData[r];
    if (row && (row[0] === 'BATTERY' || row[0] === 'DISPLAY') && row[1] !== 'SUB-TOTAL' && row[4] !== 'SUB-TOTAL') {
      siteMonthlyDemands[code] += (Number(row[c]) || 0);
    }
  }
}

for (let w = 1; w <= 4; w++) {
  const ws = wb.Sheets[`Week ${w}`];
  const wData = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const wSites = wData[2].slice(6, 32);

  let plannedWTotal = 0;
  let branchWTotal = 0;
  let mmWTotal = 0;
  let provWTotal = 0;

  for (let r = 3; r < wData.length; r++) {
    const row = wData[r];
    if ((row[0] === 'BATTERY' || row[0] === 'DISPLAY') && row[4] && row[4] !== 'SUB-TOTAL') {
      plannedWTotal += Number(row[1]) || 0;
      wSites.forEach((code, idx) => {
        const val = Number(row[6 + idx]) || 0;
        branchWTotal += val;
        if (expectedMMCodes.includes(code)) {
          mmWTotal += val;
        } else {
          provWTotal += val;
        }
      });
    }
  }

  assert(
    plannedWTotal === branchWTotal,
    `Week ${w}: Branch column sum (${branchWTotal}) strictly matches Planned Forecast (${plannedWTotal})`
  );

  if (w <= 2) {
    const mmPct = (mmWTotal / branchWTotal) * 100;
    assert(
      mmPct === 100.0,
      `Week ${w}: Metro Manila accounts for 100% of parts (${mmPct.toFixed(1)}% === 100.0%)`
    );
    assert(
      provWTotal === 0,
      `Week ${w}: Provincial sites receive exactly 0 parts (actual: ${provWTotal})`
    );
  } else if (w === 3) {
    assert(
      mmWTotal > 0,
      `Week 3: Metro Manila remainder extends into Week 3 (${mmWTotal} parts)`
    );
    assert(
      provWTotal > 0,
      `Week 3: Provincial allocation begins in Week 3 (${provWTotal} parts)`
    );
  } else if (w === 4) {
    assert(
      mmWTotal === 0,
      `Week 4: Metro Manila parts do NOT appear in Week 4 (actual: ${mmWTotal} === 0)`
    );
    assert(
      provWTotal === branchWTotal,
      `Week 4: Provincial sites account for 100% of parts (${provWTotal}/${branchWTotal})`
    );
  }

  // Audit for single-part and 2-part parcels per site
  const siteParcels = {};
  wSites.forEach(code => {
    siteParcels[code] = 0;
  });
  for (let r = 3; r < wData.length; r++) {
    const row = wData[r];
    if ((row[0] === 'BATTERY' || row[0] === 'DISPLAY') && row[4] && row[4] !== 'SUB-TOTAL') {
      wSites.forEach((code, idx) => {
        siteParcels[code] += (Number(row[6 + idx]) || 0);
      });
    }
  }

  Object.entries(siteParcels).forEach(([code, qty]) => {
    if (qty > 0) {
      const siteTotalMonth = siteMonthlyDemands[code] || 0;
      if (siteTotalMonth >= 3) {
        assert(
          qty !== 1,
          `Week ${w}: Site ${code} does not receive a single-part shipment (qty: ${qty})`
        );
        assert(
          qty >= 3,
          `Week ${w}: Site ${code} shipment is at least 3 parts to minimize freight costs (qty: ${qty})`
        );
      } else {
        assert(
          qty === siteTotalMonth,
          `Week ${w}: Site ${code} receives its full monthly quota (${qty}/${siteTotalMonth}) in a single shipment`
        );
      }
    }
  });
}

console.log('\n====================================================================');
console.log(`FINAL RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log('====================================================================');

if (failedTests > 0) process.exit(1);
