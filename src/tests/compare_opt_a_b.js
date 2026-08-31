import fs from 'fs';
import * as XLSX from 'xlsx';
import { calculateOptionAAllocation, calculate2DCumulativeAllocation } from '../utils/allocationEngine.js';
import { displayShares, batteryShares } from '../data/canonicalShares.js';

const buf1 = fs.readFileSync('Battery & Display (Allocation) - September 2026.xlsx');
const wb1 = XLSX.read(buf1, { type: 'buffer' });
const allocWs = wb1.Sheets['Allocation'];
const allocRows = XLSX.utils.sheet_to_json(allocWs, { header: 1, defval: '' });

let optATotalQty = 0, optATotalCost = 0;
let optBTotalQty = 0, optBTotalCost = 0;
let fcastTotalQty = 0, fcastTotalCost = 0;

console.log('--- Checking Displays Option A vs Option B ---');
for (let r = 2; r <= 22; r++) {
  const row = allocRows[r];
  const _pn = row[5];
  const desc = row[6];
  const fcast = Number(row[2]) || 0;
  const price = Number(row[3]) || 0;
  const mIdx = r - 2;

  const optA = calculateOptionAAllocation(fcast, displayShares, mIdx);
  const sumA = optA.reduce((s, v) => s + v, 0);

  const optB = calculate2DCumulativeAllocation(fcast, displayShares, mIdx);
  const sumB = optB.reduce((s, v) => s + v, 0);

  fcastTotalQty += fcast;
  fcastTotalCost += fcast * price;
  optATotalQty += sumA;
  optATotalCost += sumA * price;
  optBTotalQty += sumB;
  optBTotalCost += sumB * price;

  if (sumA !== fcast || sumB !== fcast) {
    console.log(`Display r=${r} ${desc}: Forecast=${fcast}, OptA Sum=${sumA}, OptB Sum=${sumB}`);
  }
}

console.log('\n--- Checking Batteries Option A vs Option B ---');
for (let r = 24; r <= 43; r++) {
  const row = allocRows[r];
  const _pn = row[5];
  const desc = row[6];
  const fcast = Number(row[2]) || 0;
  const price = Number(row[3]) || 0;
  const mIdx = r - 24;

  const optA = calculateOptionAAllocation(fcast, batteryShares, mIdx);
  const sumA = optA.reduce((s, v) => s + v, 0);

  const optB = calculate2DCumulativeAllocation(fcast, batteryShares, mIdx);
  const sumB = optB.reduce((s, v) => s + v, 0);

  fcastTotalQty += fcast;
  fcastTotalCost += fcast * price;
  optATotalQty += sumA;
  optATotalCost += sumA * price;
  optBTotalQty += sumB;
  optBTotalCost += sumB * price;

  if (sumA !== fcast || sumB !== fcast) {
    console.log(`Battery r=${r} ${desc}: Forecast=${fcast}, OptA Sum=${sumA}, OptB Sum=${sumB}`);
  }
}

console.log('\n=== SUMMARY ===');
console.log('Forecast Demand:   Qty = ' + fcastTotalQty + ', Total Valuation    = $' + fcastTotalCost);
console.log('Option A (Excel):  Qty = ' + optATotalQty + ', Total Master Value = $' + optATotalCost);
console.log('Option B (Strict): Qty = ' + optBTotalQty + ', Total Master Value = $' + optBTotalCost);
