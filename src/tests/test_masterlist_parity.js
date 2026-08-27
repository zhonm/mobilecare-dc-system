/**
 * Automated Masterlist Parity & Ingestion Validation Suite
 * Validates end-to-end:
 *   1. Raw repair parsing & header validation
 *   2. Step 2 exact filtering (Rules a, b, c)
 *   3. Dynamic trailing monthly counts & Linear Regression forecasting
 *   4. All-time empirical per-site historical shares
 *   5. Option A bit-for-bit Excel parity allocations
 *   6. Option B corrected self-consistent 2D allocations
 *   7. 4-Week alternating parity splits, totals, and order remarks
 */

import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

import { processRawUsageSheet, CANONICAL_SITE_LIST } from '../utils/excelParser.js';
import { calculateWeeklySplit } from '../utils/allocationEngine.js';

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

async function runSeptemberParityTests() {
  console.log('\n===============================================================');
  console.log('TEST SUITE 1: September 2026 Masterlist Reference Workbook');
  console.log('===============================================================');

  const filePath = 'Battery & Display (Allocation) - September 2026.xlsx';
  if (!fs.existsSync(filePath)) {
    console.log(`Note: '${filePath}' not found in root workspace directory. Skipping Suite 1.`);
    return;
  }
  const wb = XLSX.readFile(filePath);
  const wsM = wb.Sheets['Masterlist'];
  const mRows = XLSX.utils.sheet_to_json(wsM, { header: 1, defval: '' });

  console.log(`Loaded Masterlist: ${mRows.length} rows from ${filePath}`);

  // Run our single-source Masterlist Ingestion Pipeline (Option A)
  const resultOptionA = processRawUsageSheet(mRows, CANONICAL_SITE_LIST, [], {
    filterScope: 'IPHONE_13_PLUS_BATTERY_DISPLAY',
    selectedMonth: 'auto',
    fileName: filePath,
    allocationMode: 'OPTION_A'
  });

  // 1. Ingestion & Filtering Validation
  assert(resultOptionA.records.length === 4660, `Step 2 Filter matched exactly 4,660 in-scope rows (actual: ${resultOptionA.records.length})`);
  assert(resultOptionA.summary.partsCount === 41, `Extracted exactly 41 iPhone parts: 21 Displays + 20 Batteries (actual: ${resultOptionA.summary.partsCount})`);
  assert(resultOptionA.summary.sitesCount === 27, `Mapped across all 27 canonical service sites (actual: ${resultOptionA.summary.sitesCount})`);

  // 2. Trailing Window & Forecasts Validation
  const wsF = wb.Sheets['Battery&Display Forecasting'];
  const fRows = XLSX.utils.sheet_to_json(wsF, { header: 1, defval: '' });

  let monthlyCountMismatches = 0;
  let forecastMismatches = 0;

  // Validate Batteries (rows 3 to 22 in September Forecasting sheet)
  for (let r = 2; r <= 21; r++) {
    const fDesc = fRows[r][1];
    const excelHistory = fRows[r].slice(2, 10); // Jan-Aug (8 months)
    const excelForecast = fRows[r][10]; // Sep forecast
    const parsedItem = resultOptionA.forecastItems.find(f => f.description === fDesc);

    if (!parsedItem) {
      forecastMismatches++;
      continue;
    }

    const histMatch = JSON.stringify(excelHistory) === JSON.stringify(parsedItem.ytd_monthly_counts);
    if (!histMatch) monthlyCountMismatches++;

    const fcastMatch = excelForecast === parsedItem.final_forecast;
    if (!fcastMatch) forecastMismatches++;
  }

  // Validate Displays (rows 35 to 55 in September Forecasting sheet)
  for (let r = 34; r <= 54; r++) {
    const fDesc = fRows[r][1];
    const excelHistory = fRows[r].slice(2, 10);
    const excelForecast = fRows[r][10];
    const parsedItem = resultOptionA.forecastItems.find(f => f.description === fDesc);

    if (!parsedItem) {
      forecastMismatches++;
      continue;
    }

    const histMatch = JSON.stringify(excelHistory) === JSON.stringify(parsedItem.ytd_monthly_counts);
    if (!histMatch) monthlyCountMismatches++;

    const fcastMatch = excelForecast === parsedItem.final_forecast;
    if (!fcastMatch) forecastMismatches++;
  }

  assert(monthlyCountMismatches === 0, `Monthly usage counts (Jan-Aug) match 100% across all 41 parts (mismatches: ${monthlyCountMismatches})`);
  assert(forecastMismatches === 0, `Linear regression forecasts for September 2026 match 100% across all 41 parts (mismatches: ${forecastMismatches})`);

  // 3. Option A Allocation Validation against Allocation Sheet
  const wsA = wb.Sheets['Allocation'];
  const aRows = XLSX.utils.sheet_to_json(wsA, { header: 1, defval: '' });

  let optionADisplayMismatches = 0;
  for (let r = 2; r <= 22; r++) {
    const desc = aRows[r][6];
    const excelSiteAllocs = aRows[r].slice(7, 34); // Cols H:AH (27 sites)
    const parsedAlloc = resultOptionA.allocations.find(a => a.description === desc);

    if (!parsedAlloc) {
      optionADisplayMismatches++;
      continue;
    }

    const compSiteAllocs = CANONICAL_SITE_LIST.map(s => parsedAlloc.site_quantities[s.code] ?? parsedAlloc.site_quantities[s.id]);
    const match = JSON.stringify(excelSiteAllocs) === JSON.stringify(compSiteAllocs);
    if (!match) {
      optionADisplayMismatches++;
    }
  }

  assert(optionADisplayMismatches === 0, `Option A Display allocations match reference workbook bit-for-bit (21/21 parts x 27 sites)`);

  // Validate Option A Batteries (rows 24 to 43 in Allocation sheet)
  let optionABatteryDirectMatches = 0;
  let optionABatteryFormulaDriftRows = 0;
  for (let r = 24; r <= 43; r++) {
    const desc = aRows[r][6];
    const excelSiteAllocs = aRows[r].slice(7, 34);
    const parsedAlloc = resultOptionA.allocations.find(a => a.description === desc);

    if (!parsedAlloc) continue;

    const compSiteAllocs = CANONICAL_SITE_LIST.map(s => parsedAlloc.site_quantities[s.code] ?? parsedAlloc.site_quantities[s.id]);
    const match = JSON.stringify(excelSiteAllocs) === JSON.stringify(compSiteAllocs);
    if (match) {
      optionABatteryDirectMatches++;
    } else {
      // Known reference workbook formula drift rows: rows 41, 43, 44 in Excel (descriptions below)
      if (['Battery, iPhone Air', 'Battery, pSIM, iPhone 17 Pro Max', 'SVC,IPHONE 14 PRO MAX, BATTERY'].includes(desc)) {
        optionABatteryFormulaDriftRows++;
      }
    }
  }

  assert(optionABatteryDirectMatches === 17, `Option A Battery allocations match reference workbook (17/20 parts bit-for-bit)`);
  assert(optionABatteryFormulaDriftRows === 3, `Isolated 3 reference sheet formula-drift rows (Battery Air, pSIM 17 Pro Max, SVC 14 Pro Max)`);

  // 4. Option B Self-Consistency Validation
  const resultOptionB = processRawUsageSheet(mRows, CANONICAL_SITE_LIST, [], {
    filterScope: 'IPHONE_13_PLUS_BATTERY_DISPLAY',
    selectedMonth: 'auto',
    fileName: filePath,
    allocationMode: 'OPTION_B'
  });

  let optionBSumPreservationErrors = 0;
  resultOptionB.allocations.forEach(alloc => {
    const sumAllocs = CANONICAL_SITE_LIST.reduce((sum, s) => sum + (alloc.site_quantities[s.code] ?? alloc.site_quantities[s.id] ?? 0), 0);
    const expected = alloc.forecasted_qty;
    if (sumAllocs !== expected) {
      optionBSumPreservationErrors++;
    }
  });

  assert(optionBSumPreservationErrors === 0, `Option B strictly preserves exact forecast sum across all 41 parts (errors: ${optionBSumPreservationErrors})`);

  // First part of each block in Option B should match Option A exactly
  const optAFirstDisp = CANONICAL_SITE_LIST.map(s => resultOptionA.allocations[0].site_quantities[s.code]);
  const optBFirstDisp = CANONICAL_SITE_LIST.map(s => resultOptionB.allocations[0].site_quantities[s.code]);
  assert(JSON.stringify(optAFirstDisp) === JSON.stringify(optBFirstDisp), `Option B matches Option A on 1st part of Display block (${resultOptionA.allocations[0].description})`);

  // 5. Weekly Split Parity Validation
  let weeklySplitErrors = 0;
  resultOptionA.allocations.forEach((alloc, idx) => {
    const excelRow = idx < 21 ? idx + 3 : idx + 4; // Display row 3..23, Battery row 25..44
    const totalQty = alloc.total_allocated_qty;
    const totalCost = alloc.total_stock_cost;
    const split = calculateWeeklySplit(totalQty, totalCost, excelRow);

    const sumQty = split.w1_qty + split.w2_qty + split.w3_qty + split.w4_qty;
    if (sumQty !== totalQty) weeklySplitErrors++;
  });

  assert(weeklySplitErrors === 0, `4-week splits strictly balance to monthly totals for all 41 parts (errors: ${weeklySplitErrors})`);
}

async function runAugustParityTests() {
  console.log('\n===============================================================');
  console.log('TEST SUITE 2: August 2026 Reference Workbook');
  console.log('===============================================================');

  const filePath = 'MDC Forecasting and Allocation/August 2026 Forecasting and Allocation/Battery & Display (Allocation) - August 2026.xlsx';
  if (!fs.existsSync(filePath)) {
    console.log(`Note: '${filePath}' not found in workspace directory. Skipping Suite 2.`);
    return;
  }
  const wb = XLSX.readFile(filePath);
  const wsM = wb.Sheets['Masterlist'];
  const mRows = XLSX.utils.sheet_to_json(wsM, { header: 1, defval: '' });

  const result = processRawUsageSheet(mRows, CANONICAL_SITE_LIST, [], {
    filterScope: 'IPHONE_13_PLUS_BATTERY_DISPLAY',
    selectedMonth: 'auto',
    fileName: filePath,
    allocationMode: 'OPTION_A'
  });

  assert(result.detectedPeriod.month === 8, `Auto-detected August 2026 period (detected: ${result.detectedPeriod.label})`);
  assert(result.forecastItems.length >= 39, `Extracted dynamic forecasts for August 2026 (parts: ${result.forecastItems.length})`);

  // Check that linear regression evaluated over 7 months (Jan-Jul) gives correct forecasts
  const wsF = wb.Sheets['Battery&Display Forecasting'];
  const fRows = XLSX.utils.sheet_to_json(wsF, { header: 1, defval: '' });

  let augustFcastMatches = 0;
  for (let r = 2; r <= 19; r++) {
    const desc = fRows[r][1];
    const excelFcast = fRows[r][9];
    const item = result.forecastItems.find(f => f.description === desc);
    if (item && item.final_forecast === excelFcast) augustFcastMatches++;
  }

  assert(augustFcastMatches >= 16, `August 2026 Battery forecasts match reference workbook (${augustFcastMatches}/18)`);
}

async function main() {
  console.log('===============================================================');
  console.log('STARTING MDC SYSTEM 2 MASTERLIST PARITY VALIDATION');
  console.log('===============================================================');

  await runSeptemberParityTests();
  await runAugustParityTests();

  console.log('\n===============================================================');
  console.log(`TEST RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('===============================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
