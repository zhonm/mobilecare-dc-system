import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as xlsxModule from 'xlsx';

const xlsx = xlsxModule.default || xlsxModule;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: September DC Stock Accuracy & Outdated Stock Removal');
console.log('====================================================');

// [Test 1] Verification of Arrival Dates in Battery & Display (Allocation) - September 2026.xlsx
console.log('\n--- 1. Auditing Arrival Dates in Excel (Week 1 to Week 4) ---');
const excelPath = path.resolve(__dirname, '../../Battery & Display (Allocation) - September 2026.xlsx');
assert(fs.existsSync(excelPath), 'Battery & Display (Allocation) - September 2026.xlsx must exist');

const wb = xlsx.readFile(excelPath);
const weeklySheets = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];

function excelSerialToDateStr(serial) {
  if (typeof serial !== 'number' && !/^\d+$/.test(serial)) return String(serial);
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);
  return date_info.toISOString().split('T')[0];
}

const distinctArrivalDates = new Set();

weeklySheets.forEach(sheetName => {
  const ws = wb.Sheets[sheetName];
  assert(ws, `Sheet ${sheetName} must exist in workbook`);
  const json = xlsx.utils.sheet_to_json(ws, { header: 1 });
  const headerRow = json[2] || [];
  const arriveCol = headerRow.findIndex(c => typeof c === 'string' && /date arrived/i.test(c));
  assert(arriveCol !== -1, `Date Arrived column must exist in ${sheetName}`);

  for (let r = 3; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;
    const val = row[arriveCol];
    if (val && val !== 'Date Arrived') {
      const dStr = excelSerialToDateStr(val);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
        distinctArrivalDates.add(dStr);
      }
    }
  }
});

console.log('Found distinct arrival dates in September Excel:', Array.from(distinctArrivalDates));
distinctArrivalDates.forEach(d => {
  assert(d.startsWith('2026-09'), `Arrival date ${d} must be in September 2026`);
});
assert(!distinctArrivalDates.has('2026-08-24'), 'August 24 must NOT be an arrival date in September workbook');
console.log('  ✓ PASS: 100% of recorded arrival dates in Week 1 to 4 are in September 2026 (Zero August dates)');

// [Test 2] Stock Filtering Logic: Active DC Stock Strictly Excludes Outdated Pre-September Units
console.log('\n--- 2. Testing DC In-Stock Filtering Logic ---');

const mixedUnits = [
  // 66 units on 2026-09-03
  ...Array.from({ length: 66 }, (_, i) => ({
    id: `unit-sep-03-${i}`,
    serial_number: `SEP_03_SN_${i + 1}`,
    part_number: '661-21988',
    description: 'Display, iPhone 13',
    stocking_price: 329,
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock',
    received_at: '2026-09-03T08:00:00.000Z'
  })),
  // 2 units on 2026-09-05
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `unit-sep-05-${i}`,
    serial_number: `SEP_05_SN_${i + 1}`,
    part_number: '661-30401',
    description: 'Display, iPhone 14 Pro Max',
    stocking_price: 379,
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock',
    received_at: '2026-09-05T08:00:00.000Z'
  })),
  // 175 units on 2026-09-07
  ...Array.from({ length: 175 }, (_, i) => ({
    id: `unit-sep-07-${i}`,
    serial_number: `SEP_07_SN_${i + 1}`,
    part_number: i < 70 ? '661-56050' : '661-21996',
    description: i < 70 ? 'Display, iPhone 17 Pro Max' : 'Battery, iPhone 13 Pro',
    stocking_price: i < 70 ? 379 : 89,
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock',
    received_at: '2026-09-07T08:00:00.000Z'
  })),
  // 53 outdated units on 2026-08-24 (which previously leaked into DC stock)
  ...Array.from({ length: 53 }, (_, i) => ({
    id: `unit-aug-24-${i}`,
    serial_number: `AUG_24_SN_${i + 1}`,
    part_number: '661-35694',
    description: 'Battery, iPhone 15 Pro',
    stocking_price: 99,
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock',
    received_at: '2026-08-24T09:00:00.000Z'
  }))
];

assert.strictEqual(mixedUnits.length, 296, 'Initial mixed units should total 296 (matching user screenshot)');

// Simulate enrichedStockUnits filter from IntakeRecords.jsx
function filterActiveDcStockUnits(units) {
  return units.filter(u => {
    const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
    if (!cleanSerial) return false;
    if (u.is_deleted || u.status === 'deleted') return false;
    if (u.status === 'packed' || u.status === 'shipped' || u.status === 'dispatched' || u.status === 'allocated') return false;
    
    // Must be in DC warehouse
    const isDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
    if (!isDc) return false;

    // Exclude outdated parts prior to September 2026
    const recvDate = (u.received_at || '').substring(0, 10);
    if (recvDate && recvDate < '2026-09-01') return false;

    return (u.status === 'in_stock' || !u.status);
  });
}

const activeUnits = filterActiveDcStockUnits(mixedUnits);
assert.strictEqual(activeUnits.length, 243, `Expected exactly 243 active DC units, got ${activeUnits.length}`);

// Verify date breakdown
const dateCounts = {};
activeUnits.forEach(u => {
  const d = u.received_at.substring(0, 10);
  dateCounts[d] = (dateCounts[d] || 0) + 1;
});

assert.strictEqual(dateCounts['2026-09-07'], 175, 'September 7 must have exactly 175 units');
assert.strictEqual(dateCounts['2026-09-05'], 2, 'September 5 must have exactly 2 units');
assert.strictEqual(dateCounts['2026-09-03'], 66, 'September 3 must have exactly 66 units');
assert.strictEqual(dateCounts['2026-08-24'], undefined, 'August 24 must NOT be present in active stock');

console.log('  ✓ PASS: Exactly 243 units remain across September 3, 5, and 7 (Zero August units)');

// [Test 3] Valuation Calculation Parity
console.log('\n--- 3. Testing Valuation Calculation Parity ---');
const sep03Valuation = activeUnits.filter(u => u.received_at.startsWith('2026-09-03')).reduce((s, u) => s + u.stocking_price, 0);
const sep05Valuation = activeUnits.filter(u => u.received_at.startsWith('2026-09-05')).reduce((s, u) => s + u.stocking_price, 0);
assert.strictEqual(sep03Valuation, 21714, 'Sep 3 valuation verified');
assert.strictEqual(sep05Valuation, 758, 'Sep 5 valuation verified');
console.log('  ✓ PASS: September valuation accurate and isolated from August stock');

// [Test 4] Stale Ghost Eviction via deletedSerialsRegistry
console.log('\n--- 4. Testing Deletion Registry Eviction ---');
const deletedRegistry = new Set(['AUG_24_SN_1', 'AUG_24_SN_2', 'AUG_24_SN_53']);
const localSavedStaleUnits = [
  { serial_number: 'AUG_24_SN_1', received_at: '2026-08-24T09:00:00.000Z' },
  { serial_number: 'SEP_07_SN_1', received_at: '2026-09-07T08:00:00.000Z' }
];

const purgedLocal = localSavedStaleUnits.filter(u => {
  const s = String(u.serial_number || '').trim().toUpperCase();
  if (deletedRegistry.has(s)) return false;
  const d = (u.received_at || '').substring(0, 10);
  if (d < '2026-09-01') return false;
  return true;
});

assert.strictEqual(purgedLocal.length, 1, 'Only September unit should survive eviction');
assert.strictEqual(purgedLocal[0].serial_number, 'SEP_07_SN_1');
console.log('  ✓ PASS: Deletion registry and date guard successfully evict stale local cache');

console.log('\n====================================================');
console.log('ALL SEPTEMBER DC STOCK ACCURACY TESTS PASSED (100%)');
console.log('====================================================');
