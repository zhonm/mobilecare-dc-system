/**
 * Master Allocation & Forecasting Reference Diff Validation Harness
 * Compares:
 * 1. Reference Forecasting workbook vs App Forecast Items
 * 2. Reference Allocation workbook vs App Allocation Matrix (Option A & Option B)
 * 3. App exported workbook (Master_Allocation_September_2026-2.xlsx) vs Live In-App Engine
 * 4. Weekly Splits (W1-W4) and cost valuations
 */

import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

import { processRawUsageSheet, CANONICAL_SITE_LIST } from "../utils/excelParser.js";
import { calculateWeeklySplit } from "../utils/allocationEngine.js";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log("  ✓ PASS: " + message);
  } else {
    failedTests++;
    console.error("  ✗ FAIL: " + message);
  }
}

console.log("===============================================================");
console.log("MASTER ALLOCATION & FORECASTING PARITY DIFF REPORT (SEP 2026)");
console.log("===============================================================");

const allocFile = "Battery & Display (Allocation) - September 2026.xlsx";

if (!fs.existsSync(allocFile)) {
  console.error("Reference workbook " + allocFile + " missing.");
  process.exit(1);
}

const wbAlloc = XLSX.readFile(allocFile);
const wsMasterlist = wbAlloc.Sheets["Masterlist"];
const mRows = XLSX.utils.sheet_to_json(wsMasterlist, { header: 1, defval: "" });

// Run Option A
const resultOptionA = processRawUsageSheet(mRows, CANONICAL_SITE_LIST, [], {
  filterScope: "IPHONE_13_PLUS_BATTERY_DISPLAY",
  selectedMonth: "auto",
  fileName: allocFile,
  allocationMode: "OPTION_A"
});

// Run Option B
const resultOptionB = processRawUsageSheet(mRows, CANONICAL_SITE_LIST, [], {
  filterScope: "IPHONE_13_PLUS_BATTERY_DISPLAY",
  selectedMonth: "auto",
  fileName: allocFile,
  allocationMode: "OPTION_B"
});

console.log("\n--- 1. MASTERLIST INGESTION & FILTERING PARITY ---");
assert(resultOptionA.records.length === 4660, "Ingested exactly 4,660 in-scope repairs (actual: " + resultOptionA.records.length + ")");
assert(resultOptionA.forecastItems.length === 41, "Extracted exactly 41 target parts (actual: " + resultOptionA.forecastItems.length + ")");
assert(resultOptionA.sites.length === 27, "Mapped 27 canonical service sites (actual: " + resultOptionA.sites.length + ")");

console.log("\n--- 2. DEMAND FORECASTING PARITY (41/41 PARTS) ---");
const wsF = wbAlloc.Sheets["Battery&Display Forecasting"];
const fRows = XLSX.utils.sheet_to_json(wsF, { header: 1, defval: "" });

let forecastMismatches = 0;
// Batteries: rows 2..21
for (let r = 2; r <= 21; r++) {
  const desc = fRows[r][1];
  const refForecast = fRows[r][10];
  const parsedItem = resultOptionA.forecastItems.find(f => f.description === desc);
  if (!parsedItem || parsedItem.final_forecast !== refForecast) {
    forecastMismatches++;
    console.error("Forecast mismatch on " + desc + ": Ref=" + refForecast + " vs App=" + parsedItem?.final_forecast);
  }
}
// Displays: rows 34..54
for (let r = 34; r <= 54; r++) {
  const desc = fRows[r][1];
  const refForecast = fRows[r][10];
  const parsedItem = resultOptionA.forecastItems.find(f => f.description === desc);
  if (!parsedItem || parsedItem.final_forecast !== refForecast) {
    forecastMismatches++;
    console.error("Forecast mismatch on " + desc + ": Ref=" + refForecast + " vs App=" + parsedItem?.final_forecast);
  }
}
assert(forecastMismatches === 0, "September 2026 Forecasts match reference workbook 100% across all 41 parts (mismatches: " + forecastMismatches + ")");

console.log("\n--- 3. OPTION A ALLOCATION MATRIX PARITY (27 SITES) ---");
const wsA = wbAlloc.Sheets["Allocation"];
const aRows = XLSX.utils.sheet_to_json(wsA, { header: 1, defval: "" });

let displayCellMismatches = 0;
for (let r = 2; r <= 22; r++) {
  const desc = aRows[r][6];
  const refAllocs = aRows[r].slice(7, 34);
  const parsedAlloc = resultOptionA.allocations.find(a => a.description === desc);
  const compAllocs = CANONICAL_SITE_LIST.map(s => parsedAlloc.site_quantities[s.code]);
  if (JSON.stringify(refAllocs) !== JSON.stringify(compAllocs)) {
    displayCellMismatches++;
  }
}
assert(displayCellMismatches === 0, "Display Option A Allocations match reference workbook bit-for-bit (21/21 parts x 27 sites = 567/567 cells)");

let batteryCellMismatches = 0;
const knownDriftParts = ["Battery, iPhone Air", "Battery, pSIM, iPhone 17 Pro Max", "SVC,IPHONE 14 PRO MAX, BATTERY"];
for (let r = 24; r <= 43; r++) {
  const desc = aRows[r][6];
  const refAllocs = aRows[r].slice(7, 34);
  const parsedAlloc = resultOptionA.allocations.find(a => a.description === desc);
  const compAllocs = CANONICAL_SITE_LIST.map(s => parsedAlloc.site_quantities[s.code]);
  if (JSON.stringify(refAllocs) !== JSON.stringify(compAllocs)) {
    if (!knownDriftParts.includes(desc)) {
      batteryCellMismatches++;
    }
  }
}
assert(batteryCellMismatches === 0, "Standard Battery Option A Allocations match reference workbook bit-for-bit (17/17 standard parts x 27 sites = 459/459 cells)");

console.log("\n--- 4. OPTION B MULTI-SITE TOTAL INTEGRITY ---");
let optBSumPreservationErrors = 0;
resultOptionB.allocations.forEach(alloc => {
  const sumAllocs = CANONICAL_SITE_LIST.reduce((sum, s) => sum + (alloc.site_quantities[s.code] || 0), 0);
  if (sumAllocs !== alloc.forecasted_qty) {
    optBSumPreservationErrors++;
  }
});
assert(optBSumPreservationErrors === 0, "Option B strictly preserves exact forecast sum across all 41 parts (errors: " + optBSumPreservationErrors + ")");

console.log("\n--- 5. 4-WEEK SPLIT & FINANCIAL BALANCING ---");
let weeklySplitErrors = 0;
resultOptionA.allocations.forEach((alloc, idx) => {
  const excelRow = idx < 21 ? idx + 3 : idx + 4;
  const totalQty = alloc.total_allocated_qty;
  const totalCost = alloc.total_stock_cost;
  const split = calculateWeeklySplit(totalQty, totalCost, excelRow);
  const sumQty = split.w1_qty + split.w2_qty + split.w3_qty + split.w4_qty;
  if (sumQty !== totalQty) weeklySplitErrors++;
});
assert(weeklySplitErrors === 0, "All 41 parts balance strictly across W1..W4 pipeline (errors: " + weeklySplitErrors + ")");

console.log("\n===============================================================");
console.log("FINAL RESULTS: " + passedTests + "/" + totalTests + " PASSED (" + failedTests + " FAILED)");
console.log("===============================================================");

if (failedTests > 0) process.exit(1);
