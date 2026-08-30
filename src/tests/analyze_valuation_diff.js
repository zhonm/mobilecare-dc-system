import fs from 'fs';
import * as XLSX from 'xlsx';

const buf1 = fs.readFileSync('Battery & Display (Allocation) - September 2026.xlsx');
const wb1 = XLSX.read(buf1, { type: 'buffer' });
const allocWs = wb1.Sheets['Allocation'];
const allocRows = XLSX.utils.sheet_to_json(allocWs, { header: 1, defval: '' });

let totalForecastUnits = 0;
let totalAllocUnits = 0;
let totalValuationFromForecast = 0;
let totalMasterCostFromAlloc = 0;

let displayForecastUnits = 0, batteryForecastUnits = 0;
let displayAllocUnits = 0, batteryAllocUnits = 0;
let displayForecastCost = 0, batteryForecastCost = 0;
let displayAllocCost = 0, batteryAllocCost = 0;

let currentCommodity = '';
console.log('--- Scanning Allocation Rows ---');
for (let r = 2; r < allocRows.length; r++) {
  const row = allocRows[r];
  if (!row || row.length === 0) continue;

  const colCommodity = String(row[1] || '').trim().toUpperCase();
  if (colCommodity.includes('DISPLAY')) currentCommodity = 'DISPLAY';
  if (colCommodity.includes('BATTERY')) currentCommodity = 'BATTERY';

  const fcastQty = typeof row[2] === 'number' ? row[2] : (parseInt(row[2]) || 0);
  const stockPrice = typeof row[3] === 'number' ? row[3] : (parseFloat(row[3]) || 0);
  const pn = String(row[5] || '').trim();
  const desc = String(row[6] || '').trim();

  if (!pn && !desc) {
    continue;
  }

  // Branch allocations columns are col 7 to col 33 (27 sites)
  let rowAllocSum = 0;
  for (let c = 7; c <= 33; c++) {
    const val = typeof row[c] === 'number' ? row[c] : (parseInt(row[c]) || 0);
    rowAllocSum += val;
  }

  const rowCostFromForecast = fcastQty * stockPrice;
  const rowCostFromAlloc = rowAllocSum * stockPrice;

  totalForecastUnits += fcastQty;
  totalAllocUnits += rowAllocSum;
  totalValuationFromForecast += rowCostFromForecast;
  totalMasterCostFromAlloc += rowCostFromAlloc;

  if (currentCommodity === 'DISPLAY') {
    displayForecastUnits += fcastQty;
    displayAllocUnits += rowAllocSum;
    displayForecastCost += rowCostFromForecast;
    displayAllocCost += rowCostFromAlloc;
  } else if (currentCommodity === 'BATTERY') {
    batteryForecastUnits += fcastQty;
    batteryAllocUnits += rowAllocSum;
    batteryForecastCost += rowCostFromForecast;
    batteryAllocCost += rowCostFromAlloc;
  }

  if (fcastQty !== rowAllocSum) {
    console.log(`Diff on row ${r} (${pn} ${desc}): Forecast = ${fcastQty}, Allocated = ${rowAllocSum}, Diff = ${rowAllocSum - fcastQty}, Price = $${stockPrice}, CostDiff = $${rowCostFromAlloc - rowCostFromForecast}`);
  }
}

console.log('\n=== TOTALS FROM EXCEL ALLOCATION SHEET ===');
console.log('Forecast Units: Total =', totalForecastUnits, '(Displays =', displayForecastUnits, ', Batteries =', batteryForecastUnits, ')');
console.log('Allocated Units: Total =', totalAllocUnits, '(Displays =', displayAllocUnits, ', Batteries =', batteryAllocUnits, ')');
console.log('Units Difference (Allocated - Forecast) =', totalAllocUnits - totalForecastUnits);
console.log('Forecast Valuation (Forecast * Price): Total = $' + totalValuationFromForecast, '(Displays = $' + displayForecastCost + ', Batteries = $' + batteryForecastCost + ')');
console.log('Allocated Master Value (Allocated * Price): Total = $' + totalMasterCostFromAlloc, '(Displays = $' + displayAllocCost + ', Batteries = $' + batteryAllocCost + ')');
console.log('Cost Difference (Master Value - Valuation) = $' + (totalMasterCostFromAlloc - totalValuationFromForecast));
