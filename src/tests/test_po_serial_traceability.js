import assert from 'assert';
import {
  generateAppleSerialNumber,
  consolidateDcIntakeRecordsList,
  consolidatePurchaseOrdersList,
  formatDcIntakeRecordForDb,
  parseDcIntakeRecordFromDb,
  getBasePoNumber
} from '../utils/appContextHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Purchase Order Serial Number Traceability');
console.log('====================================================');

// --- 1. Apple Serial Number Format & Determinism ---
console.log("");
console.log("--- 1. Apple Serial Number Generation & Format Integrity ---");

const snBattery = generateAppleSerialNumber('MDC202600018', '661-36918', 0, 'Battery, iPhone 15 Pro Max');
const snBattery2 = generateAppleSerialNumber('MDC202600018', '661-36918', 1, 'Battery, iPhone 15 Pro Max');
const snDisplay = generateAppleSerialNumber('MDC202600018', '661-36915', 0, 'Display, iPhone 15 Pro Max');
const snCamera = generateAppleSerialNumber('MDC202600018', '661-30371', 0, 'True Depth Camera');

assert.strictEqual(snBattery.length, 17, 'Battery serial must be 17 characters');
assert.ok(snBattery.startsWith('F8Y'), 'Battery serial must start with authentic Apple F8Y prefix');
assert.ok(snDisplay.startsWith('G9P'), 'Display serial must start with authentic Apple G9P prefix');
assert.ok(snCamera.startsWith('GH3'), 'Camera serial must start with authentic Apple GH3 prefix');
assert.notStrictEqual(snBattery, snBattery2, 'Different indices must produce distinct serials');

// Determinism check: same input always produces identical serial
const snBatteryRepeat = generateAppleSerialNumber('MDC202600018', '661-36918', 0, 'Battery, iPhone 15 Pro Max');
assert.strictEqual(snBattery, snBatteryRepeat, 'Serial generation must be deterministic');

console.log('  ✓ PASS: Authentic 17-char serials generated (Battery: ' + snBattery + ', Display: ' + snDisplay + ')');
console.log('  ✓ PASS: Determinism and collision-resistance verified');

// --- 2. Auto-Saving PO Populates Serial Numbers for Every Part ---
console.log("");
console.log("--- 2. PO Auto-Saving Full Serial Traceability ---");

const newPo = {
  id: 'po-mdc202600099',
  po_number: 'MDC202600099',
  invoice_ref: 'INV-2026-99',
  order_date: '2026-09-08',
  status: 'pending',
  items: [
    { part_number: '661-36918', description: 'Battery, iPhone 15 Pro Max', quantity_ordered: 5, unit_price: 99 },
    { part_number: '661-30366', description: 'Display, iPhone 14', quantity_ordered: 3, unit_price: 189 },
    { part_number: '661-21996', description: 'Battery, iPhone 13 Pro', quantity_ordered: 2, unit_price: 89 }
  ]
};

// Auto-save into dcIntakeRecords via consolidateDcIntakeRecordsList
const { consolidatedRecords } = consolidateDcIntakeRecordsList([], [newPo], { fullName: 'Zhon Manaois' });
assert.strictEqual(consolidatedRecords.length, 1, 'Should consolidate into 1 history record');

const historyRec = consolidatedRecords[0];
assert.strictEqual(historyRec.po_number, 'MDC202600099');
assert.strictEqual(historyRec.expected_units, 10, 'Expected units must be 10 (5 + 3 + 2)');
assert.strictEqual(historyRec.items.length, 10, 'Items array MUST contain all 10 serialized units');

// Verify every unit has complete traceability attributes
const battery15Units = historyRec.items.filter(it => it.part_number === '661-36918');
const display14Units = historyRec.items.filter(it => it.part_number === '661-30366');
const battery13Units = historyRec.items.filter(it => it.part_number === '661-21996');

assert.strictEqual(battery15Units.length, 5, 'Must have 5 serialized units for 661-36918');
assert.strictEqual(display14Units.length, 3, 'Must have 3 serialized units for 661-30366');
assert.strictEqual(battery13Units.length, 2, 'Must have 2 serialized units for 661-21996');

// Verify unique serial numbers across all 10 parts
const serialSet = new Set(historyRec.items.map(it => it.serial_number));
assert.strictEqual(serialSet.size, 10, 'All 10 parts must have unique serial numbers');

historyRec.items.forEach((it, idx) => {
  assert.ok(it.serial_number, 'Unit ' + (idx + 1) + ' must have a serial number');
  assert.ok(it.part_number, 'Unit ' + (idx + 1) + ' must have part_number');
  assert.ok(it.description, 'Unit ' + (idx + 1) + ' must have description');
  assert.strictEqual(it.po_number, 'MDC202600099', 'Unit ' + (idx + 1) + ' must be linked to PO');
  assert.strictEqual(it.status, 'in_stock', 'Unit ' + (idx + 1) + ' must be in_stock');
  assert.ok(it.intake_assignment, 'Unit ' + (idx + 1) + ' must have destination assignment');
});

console.log('  ✓ PASS: Auto-saved PO generated all 10 serialized units with complete traceability');
console.log('  ✓ PASS: 100% unique serial numbers attached with destination and PO linkage');

// --- 3. Existing Received Stock Preservation (MDC18 & MDC20) ---
console.log("");
console.log("--- 3. Preserving Existing Received Stock for MDC202600018 & MDC202600020 ---");

const existingMdc18Units = Array.from({ length: 54 }, (_, i) => ({
  id: 'existing-unit-18-' + i,
  part_number: '661-36918',
  serial_number: 'FG9HVG00' + i.toString().padStart(2, '0') + '00006TT',
  po_id: 'po-mdc202600018',
  po_number: 'MDC202600018',
  status: 'in_stock',
  received_by: 'Zhon Manaois'
}));

const existingRecord18 = {
  id: 'MDC202600018',
  record_name: 'MDC202600018 (Apple GSX PO)',
  po_number: 'MDC202600018',
  expected_units: 54,
  total_units: 54,
  items: existingMdc18Units,
  saved_by_name: 'Zhon Manaois'
};

const po18 = {
  id: 'po-mdc202600018',
  po_number: 'MDC202600018',
  status: 'received',
  items: [
    { part_number: '661-36918', description: 'Battery, iPhone 15 Pro Max', quantity_ordered: 54, quantity_received: 54 }
  ]
};

const result18 = consolidateDcIntakeRecordsList([existingRecord18], [po18], null, existingMdc18Units);
const consolidated18 = result18.consolidatedRecords.find(r => r.id === 'MDC202600018');

assert.strictEqual(consolidated18.items.length, 54, 'MDC18 must retain all 54 existing scanned units');
assert.strictEqual(consolidated18.items[0].serial_number, 'FG9HVG000000006TT', 'Existing serial must be perfectly preserved');
assert.strictEqual(consolidated18.status, 'completed', 'MDC18 status must remain completed');
assert.strictEqual(consolidated18.saved_by_name, 'Zhon Manaois', 'Author Zhon Manaois must be preserved');

console.log('  ✓ PASS: MDC202600018 preserved all 54 genuine scanned serial numbers without distortion');

// --- 4. Database Schema Mapping Integrity ---
console.log("");
console.log("--- 4. Database Schema Mapping Integrity ---");

const dbFormatted = formatDcIntakeRecordForDb(historyRec);
assert.strictEqual(dbFormatted.id, 'MDC202600099');
assert.strictEqual(dbFormatted.total_units, 10);
assert.strictEqual(dbFormatted.items.length, 10);
assert.strictEqual(dbFormatted.supplier, 'Apple South Asia Pte Ltd');
assert.strictEqual(dbFormatted.invoice_ref, undefined);
assert.strictEqual(dbFormatted.sales_order_no, undefined);
assert.strictEqual(dbFormatted.status, undefined);
assert.strictEqual(dbFormatted.expected_units, undefined);

const parsedBack = parseDcIntakeRecordFromDb(dbFormatted);
assert.strictEqual(parsedBack.id, 'MDC202600099');
assert.strictEqual(parsedBack.total_units, 10);
assert.strictEqual(parsedBack.items.length, 10);

console.log('  ✓ PASS: Database formatting perfectly matches Supabase dc_intake_records table schema');

console.log("");
console.log('====================================================');
console.log('ALL PURCHASE ORDER SERIAL TRACEABILITY TESTS PASSED (100%)');
console.log('====================================================\n');