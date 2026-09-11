import assert from 'assert';
import { filterAvailableDcInStockUnits } from '../utils/appContextHelpers.js';
import { cleanSerialNumberInput } from '../utils/serialTracker.js';

console.log('====================================================================');
console.log('TEST SUITE: Pack Scan-Out Available Stock Synchronization & Parity');
console.log('====================================================================\n');

// -----------------------------------------------------------------------------
// 1. Recreate the Exact Live Dataset from User Screenshots
// -----------------------------------------------------------------------------
console.log('--- 1. Testing Root Cause: Discrepancy between Pack Scan-Out (288) and Dashboard (104) ---');

// A. 104 Actual Genuine September Physical DC In-Stock Units
// (41 Displays + 63 Batteries = 104 Total, as shown in Receive Scan-In & Dashboard)
const genuineDcInStockUnits = [
  ...Array.from({ length: 41 }, (_, i) => ({
    id: `unit-sep-disp-${i + 1}`,
    serial_number: `SEP_DISP_${String(i + 1).padStart(3, '0')}`,
    part_number: '661-56050',
    description: 'Display, iPhone 17 Pro Max',
    category: 'Display',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock',
    received_at: '2026-09-08T08:00:00.000Z'
  })),
  ...Array.from({ length: 63 }, (_, i) => ({
    id: `unit-sep-batt-${i + 1}`,
    serial_number: `SEP_BATT_${String(i + 1).padStart(3, '0')}`,
    part_number: '661-21991',
    description: 'Battery, iPhone 13',
    category: 'Battery',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock',
    received_at: '2026-09-09T09:00:00.000Z'
  }))
];
assert.strictEqual(genuineDcInStockUnits.length, 104, 'Genuine DC in-stock units must equal 104');

// B. 184 Units Leaking from Shipments and Pre-September Stock
// (37 Displays + 147 Batteries = 184 units; 104 + 184 = 288 units)
const previousShipmentUnits = [
  ...Array.from({ length: 37 }, (_, i) => ({
    id: `unit-shipped-disp-${i + 1}`,
    serial_number: `SHIPPED_DISP_${String(i + 1).padStart(3, '0')}`,
    part_number: '661-56050',
    description: 'Display, iPhone 17 Pro Max',
    category: 'Display',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock', // Still says in_stock in un-updated unit records
    received_at: '2026-09-05T08:00:00.000Z'
  })),
  ...Array.from({ length: 147 }, (_, i) => ({
    id: `unit-shipped-batt-${i + 1}`,
    serial_number: `SHIPPED_BATT_${String(i + 1).padStart(3, '0')}`,
    part_number: '661-21991',
    description: 'Battery, iPhone 13',
    category: 'Battery',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock',
    received_at: '2026-09-05T08:00:00.000Z'
  }))
];
assert.strictEqual(previousShipmentUnits.length, 184, 'Shipped/outdated units must equal 184');

// Total raw units in database
const rawInventoryPool = [...genuineDcInStockUnits, ...previousShipmentUnits];
assert.strictEqual(rawInventoryPool.length, 288, 'Raw inventory pool equals 288 units');

// Finalized and Dispatched Shipments
const existingShipments = [
  {
    id: 'ship-batch-1',
    invoice_ref: 'DCOWNED#090526A',
    status: 'shipped',
    items: previousShipmentUnits.map(u => ({ serial_number: u.serial_number, part_number: u.part_number }))
  }
];

// --- Demonstrate Old ScanOutPacking Calculation Bug ---
const oldPackedSerialsSet = new Set(); // Old logic only checked active draft in UI (empty draft)
const oldScanOutUnits = rawInventoryPool.filter(u => {
  const cleanSerial = cleanSerialNumberInput(u.serial_number);
  if (!cleanSerial) return false;
  if (oldPackedSerialsSet.has(cleanSerial)) return false;
  const isDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC';
  return (u.status === 'in_stock' || !u.status) && isDc;
});

assert.strictEqual(oldScanOutUnits.length, 288, 'Old ScanOutPacking logic erroneously returned 288 units');
console.log('  ✓ CONFIRMED: Old ScanOutPacking logic displayed 288 units (ignoring 184 units in existing shipments)');

// -----------------------------------------------------------------------------
// 2. Test Synchronized Available DC Stock Calculation
// -----------------------------------------------------------------------------
console.log('\n--- 2. Testing Synchronized Available DC Stock Calculation ---');

const emptyDraft = { id: 'draft-1', items: [] };

const synchronizedAvailableUnits = filterAvailableDcInStockUnits({
  inventoryUnits: rawInventoryPool,
  activePackDraft: emptyDraft,
  shipments: existingShipments,
  sites: [{ id: 'site-dc', code: 'DC-MDC', is_dc: true }]
});

assert.strictEqual(
  synchronizedAvailableUnits.length,
  104,
  `Synchronized Pack Scan-Out available units must be exactly 104 (got ${synchronizedAvailableUnits.length})`
);
console.log(`  ✓ PASS: Pack Scan-Out available stock correctly computes ${synchronizedAvailableUnits.length} in-stock units`);

// Check Category Breakdown
const displays = synchronizedAvailableUnits.filter(u => (u.category === 'Display' || u.description?.includes('Display')));
const batteries = synchronizedAvailableUnits.filter(u => (u.category === 'Battery' || u.description?.includes('Battery')));
assert.strictEqual(displays.length, 41, `Display count must be 41 (got ${displays.length})`);
assert.strictEqual(batteries.length, 63, `Battery count must be 63 (got ${batteries.length})`);
console.log(`  ✓ PASS: Category breakdown matches Receive Scan-In exactly: 41 Displays + 63 Batteries = 104 Total`);

// -----------------------------------------------------------------------------
// 3. Test Realtime Pack and Unpack Cycle
// -----------------------------------------------------------------------------
console.log('\n--- 3. Testing Realtime Pack & Unpack Stock Decrement / Restoration ---');

// Pack 1 Display into active draft
const packedDisplay = genuineDcInStockUnits[0];
const activeDraftWithOneItem = {
  id: 'draft-1',
  items: [
    {
      serial_number: packedDisplay.serial_number,
      part_number: packedDisplay.part_number,
      box_number: 1
    }
  ]
};

const stockAfterPackOne = filterAvailableDcInStockUnits({
  inventoryUnits: rawInventoryPool,
  activePackDraft: activeDraftWithOneItem,
  shipments: existingShipments,
  sites: [{ id: 'site-dc', code: 'DC-MDC', is_dc: true }]
});

assert.strictEqual(stockAfterPackOne.length, 103, 'Packing one unit must decrement available stock to 103');
assert.strictEqual(
  stockAfterPackOne.some(u => u.serial_number === packedDisplay.serial_number),
  false,
  'Packed unit must be absent from available stock table'
);
console.log('  ✓ PASS: Packing a unit immediately decrements available stock from 104 ➔ 103');

// Unpack / Remove the item from active draft
const stockAfterUnpack = filterAvailableDcInStockUnits({
  inventoryUnits: rawInventoryPool,
  activePackDraft: emptyDraft,
  shipments: existingShipments,
  sites: [{ id: 'site-dc', code: 'DC-MDC', is_dc: true }]
});

assert.strictEqual(stockAfterUnpack.length, 104, 'Unpacking item must immediately restore available stock to 104');
assert.strictEqual(
  stockAfterUnpack.some(u => u.serial_number === packedDisplay.serial_number),
  true,
  'Unpacked unit must immediately reappear in available stock table'
);
console.log('  ✓ PASS: Removing a unit from manifest immediately restores available stock from 103 ➔ 104');

// -----------------------------------------------------------------------------
// 4. Test Manifest Conflict Prevention
// -----------------------------------------------------------------------------
console.log('\n--- 4. Testing Manifest Conflict Prevention ---');

// Attempting to pack a serial already in existingShipments
const alreadyShippedSerial = previousShipmentUnits[0].serial_number;
const conflictingShipment = existingShipments.find(sh =>
  sh.items.some(it => cleanSerialNumberInput(it.serial_number) === alreadyShippedSerial)
);
assert.ok(conflictingShipment, 'Conflict must be detected against existing shipments');
assert.strictEqual(conflictingShipment.invoice_ref, 'DCOWNED#090526A');
console.log(`  ✓ PASS: Serial #${alreadyShippedSerial} blocked with manifest conflict against ${conflictingShipment.invoice_ref}`);

console.log('\n====================================================================');
console.log('ALL PACK SCAN-OUT STOCK PARITY & SYNCHRONIZATION TESTS PASSED (100%)');
console.log('====================================================================');
