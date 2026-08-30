import fs from 'fs';
import * as XLSX from 'xlsx';

const buf1 = fs.readFileSync('Battery & Display (Allocation) - September 2026.xlsx');
const wb1 = XLSX.read(buf1, { type: 'buffer' });
const allocWs = wb1.Sheets['Allocation'];
const allocRows = XLSX.utils.sheet_to_json(allocWs, { header: 1, defval: '' });

console.log('=== EXACT ROWS IN EXCEL ALLOCATION SHEET ===\n');

let dispFcast = 0, dispAlloc = 0, dispVal = 0, dispMst = 0;
let battFcast = 0, battAlloc = 0, battVal = 0, battMst = 0;

console.log('--- DISPLAYS (Rows 2..22) ---');
for (let r = 2; r <= 22; r++) {
  const row = allocRows[r];
  const pn = row[5];
  const desc = row[6];
  const fcast = row[2];
  const price = row[3];
  let alloc = 0;
  for (let c = 7; c <= 33; c++) alloc += (Number(row[c]) || 0);
  
  dispFcast += fcast;
  dispAlloc += alloc;
  dispVal += fcast * price;
  dispMst += alloc * price;
  console.log(`r=${r} | ${pn} | ${desc.padEnd(28)} | Fcast: ${String(fcast).padStart(3)} | Alloc: ${String(alloc).padStart(3)} | Diff: ${String(alloc - fcast).padStart(2)} | Price: $${price} | FcastVal: $${fcast*price} | AllocVal: $${alloc*price}`);
}
console.log(`DISPLAY TOTALS -> Forecast: ${dispFcast} ($${dispVal}), Allocated: ${dispAlloc} ($${dispMst})\n`);

console.log('--- BATTERIES (Rows 25..44) ---');
for (let r = 25; r <= 44; r++) {
  const row = allocRows[r];
  const pn = row[5];
  const desc = row[6];
  const fcast = row[2];
  const price = row[3];
  let alloc = 0;
  for (let c = 7; c <= 33; c++) alloc += (Number(row[c]) || 0);
  
  battFcast += fcast;
  battAlloc += alloc;
  battVal += fcast * price;
  battMst += alloc * price;
  console.log(`r=${r} | ${pn} | ${desc.padEnd(35)} | Fcast: ${String(fcast).padStart(3)} | Alloc: ${String(alloc).padStart(3)} | Diff: ${String(alloc - fcast).padStart(2)} | Price: $${price} | FcastVal: $${fcast*price} | AllocVal: $${alloc*price}`);
}
console.log(`BATTERY TOTALS -> Forecast: ${battFcast} ($${battVal}), Allocated: ${battAlloc} ($${battMst})\n`);

console.log('=== GRAND TOTALS IN EXCEL ===');
console.log(`Forecast:  Units = ${dispFcast + battFcast}, Valuation = $${dispVal + battVal}`);
console.log(`Allocated: Units = ${dispAlloc + battAlloc}, Master Value = $${dispMst + battMst}`);
console.log(`Difference: Units = +${(dispAlloc + battAlloc) - (dispFcast + battFcast)}, Value = +$${(dispMst + battMst) - (dispVal + battVal)}`);
